"""Generate and manage tournament bracket matchups with model predictions and Vegas odds.

Reads the bracket from tournament_bracket, pairs teams by seed position,
computes XGBoost model predictions and Barthag log5 probabilities, fetches
live odds from The Odds API, and stores everything in bracket_matchups.

Usage:
    python -m ingest.bracket_matchups --generate R64
    python -m ingest.bracket_matchups --odds 2026-03-20
    python -m ingest.bracket_matchups --update-all
    python -m ingest.bracket_matchups --advance R64
    python -m ingest.bracket_matchups --result R64 1 WINNER_ID 75 62
"""

from __future__ import annotations

import logging
import math
import sys
from datetime import date
from pathlib import Path

from config import AppConfig, load_config
from db.database import DatabaseManager
from db.queries import (
    get_bracket,
    get_bracket_matchups,
    get_torvik_ratings,
    update_matchup_result,
    upsert_bracket_matchup,
)
from features.matchup_builder import build_matchup_features
from features.player_features import compute_all_team_player_features
from ingest.odds import OddsApiClient, parse_consensus_odds, spread_to_probability
from ingest.team_mappings import resolve_team_id
from model.train import load_model, predict_matchup

logger = logging.getLogger(__name__)

# Standard bracket seed matchups — adjacent pairs play each other
SEED_ORDER = [1, 16, 8, 9, 5, 12, 4, 13, 6, 11, 3, 14, 7, 10, 2, 15]

ROUNDS = ["R64", "R32", "S16", "E8", "F4", "NCG"]


def log5(barthag_a: float, barthag_b: float) -> float:
    """Compute log5 win probability for team A given Barthag ratings."""
    num = barthag_a * (1 - barthag_b)
    den = num + barthag_b * (1 - barthag_a)
    if den == 0:
        return 0.5
    return num / den


def _load_ratings_with_features(db: DatabaseManager, season: int) -> dict[int, dict]:
    """Load Torvik ratings merged with player-derived features.

    Returns dict[team_id -> rating_dict].
    Same pattern as TournamentSimulator._load_data().
    """
    ratings_rows = get_torvik_ratings(db, season)
    ratings = {}
    for row in ratings_rows:
        tid = row.get("team_id")
        if tid:
            ratings[tid] = dict(row)

    player_features = compute_all_team_player_features(db, season)
    for tid, pf in player_features.items():
        if tid in ratings:
            ratings[tid].update(pf)

    return ratings


def generate_matchups(
    db: DatabaseManager,
    season: int,
    round_name: str = "R64",
    model_path: Path | None = None,
) -> int:
    """Generate bracket matchups for a round and compute model predictions.

    For R64: pairs teams from the bracket by seed position.
    For later rounds: pairs winners from the previous round.
    """
    bracket = get_bracket(db, season)
    if not bracket:
        print(f"No bracket found for season {season}")
        return 0

    # Load model and ratings
    model, feature_cols = load_model(model_path)
    ratings = _load_ratings_with_features(db, season)
    print(f"Loaded {len(ratings)} team ratings with player features")

    if round_name == "R64":
        return _generate_r64(db, season, bracket, model, feature_cols, ratings)
    else:
        return _generate_later_round(db, season, round_name, model, feature_cols, ratings)


def _generate_r64(
    db: DatabaseManager,
    season: int,
    bracket: list[dict],
    model,
    feature_cols: list[str],
    ratings: dict[int, dict],
) -> int:
    """Generate R64 matchups from bracket seed positions."""
    # Group bracket by region
    regions = {}
    for row in bracket:
        region = row["region"]
        if region not in regions:
            regions[region] = {}
        regions[region][row["seed"]] = row

    count = 0
    slot = 0
    region_order = sorted(regions.keys())

    for region in region_order:
        seed_map = regions[region]
        print(f"\n  {region}:")

        # Pair by SEED_ORDER: adjacent pairs are matchups
        for i in range(0, len(SEED_ORDER), 2):
            seed_a = SEED_ORDER[i]   # higher seed (lower number)
            seed_b = SEED_ORDER[i + 1]  # lower seed (higher number)

            team_a = seed_map.get(seed_a)
            team_b = seed_map.get(seed_b)

            if not team_a or not team_b:
                print(f"    Missing seed {seed_a} or {seed_b} in {region}")
                continue

            slot += 1
            tid_a = team_a["team_id"]
            tid_b = team_b["team_id"]

            # Compute model prediction
            rating_a = ratings.get(tid_a)
            rating_b = ratings.get(tid_b)

            model_prob = None
            log5_prob = None

            if rating_a and rating_b:
                features = build_matchup_features(
                    rating_a, rating_b,
                    seed_a=seed_a, seed_b=seed_b,
                )
                model_prob = predict_matchup(model, feature_cols, features)

                # Barthag log5
                ba = rating_a.get("barthag", 0.5)
                bb = rating_b.get("barthag", 0.5)
                log5_prob = log5(ba, bb)

            print(f"    #{seed_a} {team_a['name']} vs #{seed_b} {team_b['name']}"
                  f"  Model: {model_prob:.1%}" if model_prob else "")

            upsert_bracket_matchup(
                db, season=season, round_name="R64", matchup_slot=slot,
                team_a_id=tid_a, team_b_id=tid_b,
                seed_a=seed_a, seed_b=seed_b,
                region=region,
                model_prob_a=model_prob, log5_prob_a=log5_prob,
            )
            count += 1

    print(f"\nGenerated {count} R64 matchups")
    return count


def _generate_later_round(
    db: DatabaseManager,
    season: int,
    round_name: str,
    model,
    feature_cols: list[str],
    ratings: dict[int, dict],
) -> int:
    """Generate matchups for R32+ by pairing winners from the previous round."""
    round_idx = ROUNDS.index(round_name)
    prev_round = ROUNDS[round_idx - 1]

    prev_matchups = get_bracket_matchups(db, season, prev_round)
    if not prev_matchups:
        print(f"No {prev_round} matchups found — run --advance {prev_round} after recording results")
        return 0

    # Check all have winners
    incomplete = [m for m in prev_matchups if not m.get("winner_id")]
    if incomplete:
        print(f"{len(incomplete)} {prev_round} matchups still need results")
        for m in incomplete:
            print(f"  Slot {m['matchup_slot']}: {m['team_a_name']} vs {m['team_b_name']}")
        return 0

    # Pair winners: slots 1+2 → new slot 1, slots 3+4 → new slot 2, etc.
    sorted_prev = sorted(prev_matchups, key=lambda m: m["matchup_slot"])
    count = 0

    for i in range(0, len(sorted_prev), 2):
        if i + 1 >= len(sorted_prev):
            break

        m1 = sorted_prev[i]
        m2 = sorted_prev[i + 1]
        new_slot = (i // 2) + 1

        tid_a = m1["winner_id"]
        tid_b = m2["winner_id"]

        # Determine seeds — winner keeps their original seed
        seed_a = m1["seed_a"] if m1["winner_id"] == m1["team_a_id"] else m1["seed_b"]
        seed_b = m2["seed_a"] if m2["winner_id"] == m2["team_a_id"] else m2["seed_b"]

        # Ensure team_a is always the higher seed (lower number)
        if seed_a > seed_b:
            tid_a, tid_b = tid_b, tid_a
            seed_a, seed_b = seed_b, seed_a

        # Region (NULL for F4/NCG)
        region = m1.get("region") if round_name not in ("F4", "NCG") else None

        # Compute predictions
        rating_a = ratings.get(tid_a)
        rating_b = ratings.get(tid_b)
        model_prob = None
        log5_prob = None

        if rating_a and rating_b:
            features = build_matchup_features(
                rating_a, rating_b,
                seed_a=seed_a, seed_b=seed_b,
            )
            model_prob = predict_matchup(model, feature_cols, features)
            ba = rating_a.get("barthag", 0.5)
            bb = rating_b.get("barthag", 0.5)
            log5_prob = log5(ba, bb)

        # Look up names for display
        name_a = rating_a.get("name", f"Team {tid_a}") if rating_a else f"Team {tid_a}"
        name_b = rating_b.get("name", f"Team {tid_b}") if rating_b else f"Team {tid_b}"
        print(f"  #{seed_a} {name_a} vs #{seed_b} {name_b}"
              + (f"  Model: {model_prob:.1%}" if model_prob else ""))

        upsert_bracket_matchup(
            db, season=season, round_name=round_name, matchup_slot=new_slot,
            team_a_id=tid_a, team_b_id=tid_b,
            seed_a=seed_a, seed_b=seed_b,
            region=region,
            model_prob_a=model_prob, log5_prob_a=log5_prob,
        )
        count += 1

    print(f"\nGenerated {count} {round_name} matchups")
    return count


def fetch_tournament_odds(
    db: DatabaseManager,
    client: OddsApiClient,
    season: int,
    game_date: date,
) -> int:
    """Fetch live odds and match them to bracket matchups.

    Uses the live Odds API endpoint (1 credit per call).
    """
    events = client.fetch_game_odds(game_date)
    if not events:
        print(f"No odds events for {game_date}")
        return 0

    # Load current matchups to match against
    matchups = get_bracket_matchups(db, season)
    if not matchups:
        print("No bracket matchups found — run --generate first")
        return 0

    # Build lookup by team_id pair (as frozenset for order-independent matching)
    matchup_lookup = {}
    for m in matchups:
        key = frozenset([m["team_a_id"], m["team_b_id"]])
        matchup_lookup[key] = m

    updated = 0
    for event in events:
        odds = parse_consensus_odds(event)
        if not odds:
            continue

        # Resolve team IDs
        home_id = resolve_team_id(db, odds["home_team"], "odds")
        away_id = resolve_team_id(db, odds["away_team"], "odds")
        if not home_id or not away_id:
            continue

        # Find matching bracket matchup
        key = frozenset([home_id, away_id])
        m = matchup_lookup.get(key)
        if not m:
            continue

        # Orient odds from team_a's perspective
        spread = odds["spread"] or 0
        home_ml = odds["home_ml"] or 0
        away_ml = odds["away_ml"] or 0
        implied_prob = odds["implied_home_prob"] or 0.5

        # The Odds API home_team may not match our team_a
        # team_a is always the higher seed; orient accordingly
        if home_id == m["team_a_id"]:
            # Odds API home = our team_a, no flip needed
            vegas_spread_a = spread
            vegas_ml_a = home_ml
            vegas_ml_b = away_ml
            vegas_prob_a = implied_prob
        else:
            # Odds API home = our team_b, flip everything
            vegas_spread_a = -spread
            vegas_ml_a = away_ml
            vegas_ml_b = home_ml
            vegas_prob_a = 1.0 - implied_prob

        upsert_bracket_matchup(
            db, season=season, round_name=m["round"],
            matchup_slot=m["matchup_slot"],
            team_a_id=m["team_a_id"], team_b_id=m["team_b_id"],
            seed_a=m["seed_a"], seed_b=m["seed_b"],
            region=m.get("region"),
            vegas_spread_a=vegas_spread_a,
            vegas_ml_a=vegas_ml_a, vegas_ml_b=vegas_ml_b,
            vegas_total=odds["total"],
            vegas_prob_a=vegas_prob_a,
            game_date=game_date.isoformat(),
        )

        name_a = m.get("team_a_name", f"Team {m['team_a_id']}")
        name_b = m.get("team_b_name", f"Team {m['team_b_id']}")
        print(f"  {name_a} vs {name_b}: spread {vegas_spread_a:+.1f}, "
              f"implied {vegas_prob_a:.1%}")
        updated += 1

    print(f"\nUpdated odds for {updated}/{len(matchups)} matchups")
    return updated


def update_all(
    db: DatabaseManager,
    season: int,
    client: OddsApiClient | None = None,
    model_path: Path | None = None,
) -> None:
    """Recompute model predictions for all existing matchups and optionally refresh odds."""
    matchups = get_bracket_matchups(db, season)
    if not matchups:
        print("No matchups found")
        return

    model, feature_cols = load_model(model_path)
    ratings = _load_ratings_with_features(db, season)

    for m in matchups:
        tid_a = m["team_a_id"]
        tid_b = m["team_b_id"]
        rating_a = ratings.get(tid_a)
        rating_b = ratings.get(tid_b)

        if rating_a and rating_b:
            # Recompute with any existing spread
            spread = m.get("vegas_spread_a")
            features = build_matchup_features(
                rating_a, rating_b,
                seed_a=m["seed_a"], seed_b=m["seed_b"],
                spread=spread,
            )
            model_prob = predict_matchup(model, feature_cols, features)
            ba = rating_a.get("barthag", 0.5)
            bb = rating_b.get("barthag", 0.5)
            log5_prob = log5(ba, bb)

            upsert_bracket_matchup(
                db, season=season, round_name=m["round"],
                matchup_slot=m["matchup_slot"],
                team_a_id=tid_a, team_b_id=tid_b,
                seed_a=m["seed_a"], seed_b=m["seed_b"],
                region=m.get("region"),
                model_prob_a=model_prob, log5_prob_a=log5_prob,
            )

    print(f"Updated model predictions for {len(matchups)} matchups")


if __name__ == "__main__":
    config = load_config()
    db = DatabaseManager(config.database_url)
    season = config.model.current_season

    args = sys.argv[1:]

    if not args:
        print("Usage:")
        print("  python -m ingest.bracket_matchups --generate R64")
        print("  python -m ingest.bracket_matchups --odds 2026-03-20")
        print("  python -m ingest.bracket_matchups --update-all")
        print("  python -m ingest.bracket_matchups --advance R64")
        print("  python -m ingest.bracket_matchups --result R64 SLOT WINNER_ID SCORE_A SCORE_B")
        print("  python -m ingest.bracket_matchups --show")
        sys.exit(0)

    if args[0] == "--generate":
        round_name = args[1] if len(args) > 1 else "R64"
        print(f"Generating {round_name} matchups for season {season}...")
        count = generate_matchups(db, season, round_name)
        print(f"Done: {count} matchups")

    elif args[0] == "--odds":
        if len(args) < 2:
            print("Usage: --odds YYYY-MM-DD")
            sys.exit(1)
        game_date = date.fromisoformat(args[1])
        client = OddsApiClient(
            api_key=config.odds_api.api_key,
            sport_key=config.odds_api.sport_key,
        )
        print(f"Fetching tournament odds for {game_date}...")
        count = fetch_tournament_odds(db, client, season, game_date)
        client.close()

    elif args[0] == "--update-all":
        print(f"Recomputing all model predictions for season {season}...")
        update_all(db, season)

    elif args[0] == "--advance":
        if len(args) < 2:
            print("Usage: --advance PREV_ROUND  (e.g., --advance R64 generates R32)")
            sys.exit(1)
        prev_round = args[1]
        prev_idx = ROUNDS.index(prev_round)
        next_round = ROUNDS[prev_idx + 1]
        print(f"Advancing {prev_round} winners to generate {next_round} matchups...")
        count = generate_matchups(db, season, next_round)
        print(f"Done: {count} matchups")

    elif args[0] == "--result":
        if len(args) < 6:
            print("Usage: --result ROUND SLOT WINNER_ID SCORE_A SCORE_B")
            sys.exit(1)
        round_name = args[1]
        slot = int(args[2])
        winner_id = int(args[3])
        score_a = int(args[4])
        score_b = int(args[5])
        update_matchup_result(db, season, round_name, slot, winner_id, score_a, score_b)
        print(f"Recorded result: {round_name} slot {slot}, winner={winner_id}, score={score_a}-{score_b}")

    elif args[0] == "--show":
        matchups = get_bracket_matchups(db, season)
        if not matchups:
            print("No matchups found")
        else:
            current_round = None
            current_region = None
            for m in matchups:
                if m["round"] != current_round:
                    current_round = m["round"]
                    print(f"\n{'=' * 60}")
                    print(f"  {current_round}")
                    print(f"{'=' * 60}")
                    current_region = None
                if m.get("region") != current_region:
                    current_region = m.get("region")
                    if current_region:
                        print(f"\n  {current_region}:")

                name_a = m.get("team_a_name", f"Team {m['team_a_id']}")
                name_b = m.get("team_b_name", f"Team {m['team_b_id']}")
                model_str = f"{m['model_prob_a']:.1%}" if m.get("model_prob_a") else "---"
                vegas_str = f"{m['vegas_prob_a']:.1%}" if m.get("vegas_prob_a") else "---"
                spread_str = f"{m['vegas_spread_a']:+.1f}" if m.get("vegas_spread_a") else "---"

                winner = ""
                if m.get("winner_id"):
                    w = name_a if m["winner_id"] == m["team_a_id"] else name_b
                    winner = f"  W: {w} {m.get('score_a', '')}-{m.get('score_b', '')}"

                print(f"    #{m['seed_a']:2d} {name_a:<22s} vs #{m['seed_b']:2d} {name_b:<22s}"
                      f"  Model: {model_str}  Vegas: {vegas_str}  Spread: {spread_str}{winner}")

    else:
        print(f"Unknown command: {args[0]}")
        sys.exit(1)
