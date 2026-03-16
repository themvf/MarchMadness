"""Monte Carlo tournament simulator.

Simulates the NCAA tournament bracket N times (default 10,000) using
the trained XGBoost model to predict each game. Pre-computes a pairwise
win probability matrix for all 64 teams, then uses fast numpy random
draws during simulation.

The bracket is structured as a binary tree:
  - 4 regions x 16 teams = 64 teams
  - 6 rounds: R64, R32, S16, E8, F4, NCG
  - Seeds paired: 1v16, 8v9, 5v12, 4v13, 6v11, 3v14, 7v10, 2v15

Outputs:
  - Per-team advancement probabilities to each round
  - Championship probabilities
  - Path difficulty scores
"""

from __future__ import annotations

import logging
from collections import defaultdict
from pathlib import Path

import numpy as np

from config import MODELS_DIR
from db.database import DatabaseManager
from db.queries import get_bracket, get_torvik_ratings, upsert_simulation_result
from features.matchup_builder import build_matchup_features
from features.player_features import compute_all_team_player_features
from model.train import load_model, predict_matchup

logger = logging.getLogger(__name__)

ROUNDS = ["R64", "R32", "S16", "E8", "F4", "NCG"]

# Standard bracket seed matchups in each region (position order)
# Position 0 vs Position 15 = 1-seed vs 16-seed, etc.
SEED_ORDER = [1, 16, 8, 9, 5, 12, 4, 13, 6, 11, 3, 14, 7, 10, 2, 15]


class TournamentSimulator:
    """Monte Carlo bracket simulator using pre-computed win probabilities."""

    def __init__(
        self,
        db: DatabaseManager,
        season: int,
        model_path: Path | None = None,
    ):
        self.db = db
        self.season = season
        self.model, self.feature_cols = load_model(model_path)
        self._load_data()

    def _load_data(self):
        """Load bracket and ratings from database."""
        # Load bracket
        bracket_rows = get_bracket(self.db, self.season)
        if not bracket_rows:
            raise ValueError(f"No bracket found for season {self.season}")

        self.teams = {}  # team_id -> {name, seed, region, ...}
        for row in bracket_rows:
            self.teams[row["team_id"]] = {
                "team_id": row["team_id"],
                "name": row["name"],
                "seed": row["seed"],
                "region": row["region"],
                "conference": row["conference"],
                "logo_url": row.get("logo_url", ""),
            }

        # Load ratings
        ratings_rows = get_torvik_ratings(self.db, self.season)
        self.ratings = {}
        for row in ratings_rows:
            # Find the team_id from the ratings row
            tid = row.get("team_id")
            if tid:
                self.ratings[tid] = dict(row)

        # Merge player-derived features into ratings
        player_features = compute_all_team_player_features(self.db, self.season)
        for tid, pf in player_features.items():
            if tid in self.ratings:
                self.ratings[tid].update(pf)

        print(f"Loaded {len(self.teams)} bracket teams, {len(self.ratings)} ratings (+ player features)")

    def _build_win_prob_matrix(self) -> dict[tuple[int, int], float]:
        """Pre-compute pairwise win probabilities for all bracket teams.

        Returns dict of (team_a_id, team_b_id) -> P(team_a wins).
        """
        team_ids = list(self.teams.keys())
        n = len(team_ids)
        probs = {}

        for i in range(n):
            for j in range(i + 1, n):
                tid_a = team_ids[i]
                tid_b = team_ids[j]

                rating_a = self.ratings.get(tid_a)
                rating_b = self.ratings.get(tid_b)

                if rating_a and rating_b:
                    seed_a = self.teams[tid_a]["seed"]
                    seed_b = self.teams[tid_b]["seed"]

                    features = build_matchup_features(
                        rating_a, rating_b,
                        seed_a=seed_a, seed_b=seed_b,
                    )
                    prob = predict_matchup(self.model, self.feature_cols, features)
                else:
                    # Fallback: use seed-based probability
                    seed_a = self.teams[tid_a]["seed"]
                    seed_b = self.teams[tid_b]["seed"]
                    prob = seed_b / (seed_a + seed_b)

                probs[(tid_a, tid_b)] = prob
                probs[(tid_b, tid_a)] = 1 - prob

        print(f"Pre-computed {len(probs)} pairwise probabilities")
        return probs

    def _build_region_bracket(self, region: str) -> list[int | None]:
        """Get team IDs in bracket seed order for a region.

        Returns a list of 16 entries ordered by bracket position:
        [1-seed, 16-seed, 8-seed, 9-seed, 5-seed, 12-seed, ...]
        Missing seeds (e.g. First Four pending) are None (opponent gets a bye).
        """
        region_teams = {
            t["seed"]: tid
            for tid, t in self.teams.items()
            if t["region"] == region
        }

        bracket: list[int | None] = []
        for seed in SEED_ORDER:
            tid = region_teams.get(seed)
            if tid:
                bracket.append(tid)
            else:
                logger.warning(f"Missing {seed}-seed in {region} (bye)")
                bracket.append(None)

        return bracket

    def simulate(
        self,
        n_simulations: int = 10_000,
        seed: int = 42,
    ) -> dict[str, dict]:
        """Run Monte Carlo tournament simulation.

        Returns:
            Dict with:
              'advancement': {team_id: {round: count}} — how many times each team advanced
              'champions': {team_id: count} — championship wins
              'n_simulations': number of sims run
        """
        rng = np.random.default_rng(seed)
        probs = self._build_win_prob_matrix()

        regions = sorted(set(t["region"] for t in self.teams.values()))
        if len(regions) != 4:
            raise ValueError(f"Expected 4 regions, got {len(regions)}: {regions}")

        # Track advancement counts
        advancement = defaultdict(lambda: defaultdict(int))
        champion_count = defaultdict(int)

        # Pre-build region brackets
        region_brackets = {r: self._build_region_bracket(r) for r in regions}

        for sim in range(n_simulations):
            # Simulate each region through Elite 8
            final_four = []

            for region in regions:
                bracket = list(region_brackets[region])

                for round_idx, round_name in enumerate(["R64", "R32", "S16", "E8"]):
                    winners = []
                    for i in range(0, len(bracket), 2):
                        if i + 1 >= len(bracket):
                            if bracket[i] is not None:
                                winners.append(bracket[i])
                            continue

                        team_a = bracket[i]
                        team_b = bracket[i + 1]

                        # Handle byes (None = First Four pending)
                        if team_a is None and team_b is None:
                            winners.append(None)
                            continue
                        if team_a is None:
                            winners.append(team_b)
                            advancement[team_b][round_name] += 1
                            continue
                        if team_b is None:
                            winners.append(team_a)
                            advancement[team_a][round_name] += 1
                            continue

                        p = probs.get((team_a, team_b), 0.5)

                        winner = team_a if rng.random() < p else team_b
                        winners.append(winner)
                        advancement[winner][round_name] += 1

                    bracket = winners

                # Region winner goes to Final Four
                if bracket and bracket[0] is not None:
                    final_four.append(bracket[0])
                    advancement[bracket[0]]["F4"] += 1

            # Final Four: region 0 vs region 1, region 2 vs region 3
            if len(final_four) == 4:
                # Semifinal 1
                p1 = probs.get((final_four[0], final_four[1]), 0.5)
                finalist1 = final_four[0] if rng.random() < p1 else final_four[1]

                # Semifinal 2
                p2 = probs.get((final_four[2], final_four[3]), 0.5)
                finalist2 = final_four[2] if rng.random() < p2 else final_four[3]

                # Championship
                p_champ = probs.get((finalist1, finalist2), 0.5)
                champion = finalist1 if rng.random() < p_champ else finalist2

                advancement[finalist1]["NCG"] += 1
                advancement[finalist2]["NCG"] += 1
                champion_count[champion] += 1

        return {
            "advancement": dict(advancement),
            "champions": dict(champion_count),
            "n_simulations": n_simulations,
        }

    def store_results(
        self, results: dict, model_version: str = "v1"
    ) -> int:
        """Store simulation results in the database."""
        n = results["n_simulations"]
        stored = 0

        for tid, rounds in results["advancement"].items():
            for round_name, count in rounds.items():
                pct = count / n
                upsert_simulation_result(
                    self.db,
                    season=self.season,
                    team_id=tid,
                    round_name=round_name,
                    advancement_pct=pct,
                    n_simulations=n,
                    model_version=model_version,
                )
                stored += 1

        # Store championship probability separately
        for tid, count in results["champions"].items():
            upsert_simulation_result(
                self.db,
                season=self.season,
                team_id=tid,
                round_name="Champion",
                advancement_pct=count / n,
                n_simulations=n,
                model_version=model_version,
            )
            stored += 1

        return stored

    def print_results(self, results: dict, top_n: int = 25):
        """Print simulation results as a ranked table."""
        n = results["n_simulations"]

        # Build summary rows
        rows = []
        for tid, rounds in results["advancement"].items():
            team = self.teams[tid]
            champ = results["champions"].get(tid, 0)
            rows.append({
                "name": team["name"],
                "seed": team["seed"],
                "region": team["region"],
                "R32": rounds.get("R64", 0) / n * 100,
                "S16": rounds.get("R32", 0) / n * 100,
                "E8": rounds.get("S16", 0) / n * 100,
                "F4": rounds.get("E8", 0) / n * 100,
                "FF": rounds.get("F4", 0) / n * 100,
                "Champ": champ / n * 100,
            })

        # Sort by championship probability
        rows.sort(key=lambda x: -x["Champ"])

        print(f"\nTournament Simulation Results ({n:,} simulations)")
        print(f"{'':3s} {'Team':22s} {'Sd':>2} {'Rgn':4s} {'R32':>5} {'S16':>5} {'E8':>5} {'F4':>5} {'FF':>5} {'Champ':>6}")
        print("-" * 70)
        for i, r in enumerate(rows[:top_n], 1):
            print(
                f"{i:3d} {r['name']:22s} {r['seed']:2d} {r['region']:4s} "
                f"{r['R32']:5.1f} {r['S16']:5.1f} {r['E8']:5.1f} "
                f"{r['F4']:5.1f} {r['FF']:5.1f} {r['Champ']:6.2f}"
            )


if __name__ == "__main__":
    from config import load_config

    config = load_config()
    db = DatabaseManager(config.database_url)

    print("NOTE: Simulation requires tournament bracket data.")
    print("Use `python -m ingest.bracket` to import the bracket after Selection Sunday.")
    print("For testing, you can insert sample bracket data manually.")

    # Check if bracket exists
    bracket = get_bracket(db, config.model.current_season)
    if not bracket:
        print(f"\nNo bracket data for {config.model.current_season}.")
        print("The tournament bracket will be available after Selection Sunday (March 15).")
    else:
        sim = TournamentSimulator(db, config.model.current_season)
        results = sim.simulate(n_simulations=config.model.n_simulations)
        sim.print_results(results)

        # Store results to database
        stored = sim.store_results(results, model_version="v1")
        print(f"\nStored {stored} simulation results to database.")
