"""Feature engineering for game matchup prediction.

Generates feature vectors for any team A vs team B matchup by
computing differences in their efficiency metrics. These vectors
are the input to the XGBoost prediction model.

Features generated per matchup:
  - net_eff_diff:    AdjEM_A - AdjEM_B (overall efficiency gap)
  - adj_oe_diff:     AdjOE_A - AdjOE_B
  - adj_de_diff:     AdjDE_A - AdjDE_B
  - off_vs_def:      AdjOE_A - AdjDE_B (how well A scores vs B defends)
  - def_vs_off:      AdjDE_A - AdjOE_B (how well A defends vs B scores)
  - tempo_diff:      Tempo_A - Tempo_B
  - expected_tempo:  (Tempo_A + Tempo_B) / 2
  - barthag_diff:    Barthag_A - Barthag_B
  - efg_diff:        eFG%_A - eFG%_B
  - tov_diff:        TOV%_B - TOV%_A (lower is better, so we flip)
  - orb_diff:        ORB%_A - ORB%_B
  - ftr_diff:        FTR_A - FTR_B
  - efg_d_diff:      eFG%_D_A - eFG%_D_B (defensive eFG% — lower is better)
  - seed_diff:       Seed_A - Seed_B (only for tournament games)
  - spread:          Vegas spread (when available)
"""

from __future__ import annotations

import logging
from typing import Any

import pandas as pd

from db.database import DatabaseManager
from features.player_features import (
    NEUTRAL_DEFAULTS,
    PLAYER_FEATURE_NAMES,
    compute_all_team_player_features,
)

logger = logging.getLogger(__name__)


def get_team_features(db: DatabaseManager, team_id: int, season: int) -> dict | None:
    """Load a team's Torvik ratings + player-derived features as a feature dict."""
    row = db.execute_one(
        """
        SELECT tr.*, t.name, t.conference
        FROM torvik_ratings tr
        JOIN teams t ON t.team_id = tr.team_id
        WHERE tr.team_id = %s AND tr.season = %s
        """,
        (team_id, season),
    )
    if not row:
        return None

    result = dict(row)

    # Merge player-derived features
    player_feats = compute_all_team_player_features(db, season)
    pf = player_feats.get(team_id, NEUTRAL_DEFAULTS)
    result.update(pf)

    return result


def build_matchup_features(
    team_a: dict, team_b: dict,
    seed_a: int | None = None, seed_b: int | None = None,
    spread: float | None = None,
) -> dict[str, float]:
    """Build a feature vector for team_a vs team_b.

    Args:
        team_a: Torvik ratings dict for team A.
        team_b: Torvik ratings dict for team B.
        seed_a: Tournament seed for team A (optional).
        seed_b: Tournament seed for team B (optional).
        spread: Vegas spread from team A's perspective (optional).

    Returns:
        Dict of feature name -> value.
    """
    features = {
        # Core efficiency differentials
        "net_eff_diff": team_a["adj_em"] - team_b["adj_em"],
        "adj_oe_diff": team_a["adj_oe"] - team_b["adj_oe"],
        "adj_de_diff": team_a["adj_de"] - team_b["adj_de"],

        # Cross-matchup: how well each team's offense faces the other's defense
        "off_vs_def": team_a["adj_oe"] - team_b["adj_de"],
        "def_vs_off": team_a["adj_de"] - team_b["adj_oe"],

        # Style matchup
        "tempo_diff": team_a["adj_tempo"] - team_b["adj_tempo"],
        "expected_tempo": (team_a["adj_tempo"] + team_b["adj_tempo"]) / 2,

        # Power rating
        "barthag_diff": team_a["barthag"] - team_b["barthag"],

        # Four factors differentials
        "efg_diff": team_a["efg"] - team_b["efg"],
        "tov_diff": team_b["tov"] - team_a["tov"],  # Flipped: lower turnovers is better
        "orb_diff": team_a["orb"] - team_b["orb"],
        "ftr_diff": team_a["ftr"] - team_b["ftr"],

        # Defensive four factors
        "efg_d_diff": team_a["efg_d"] - team_b["efg_d"],  # Lower is better for defense
        "tov_d_diff": team_a["tov_d"] - team_b["tov_d"],  # Higher forced turnovers is better
        "drb_diff": team_a["drb"] - team_b["drb"],
        "ftr_d_diff": team_a["ftr_d"] - team_b["ftr_d"],  # Lower opponent FTR is better

        # Win-loss context
        "win_pct_diff": (
            (team_a["wins"] / max(team_a["wins"] + team_a["losses"], 1))
            - (team_b["wins"] / max(team_b["wins"] + team_b["losses"], 1))
        ),
    }

    # Tournament-specific features
    if seed_a is not None and seed_b is not None:
        features["seed_diff"] = seed_a - seed_b
    else:
        features["seed_diff"] = 0.0

    # Vegas spread (if available)
    features["spread"] = spread if spread is not None else 0.0
    features["has_spread"] = 1.0 if spread is not None else 0.0

    # Player-derived features (diffs)
    # These come pre-merged into the team dicts; fall back to neutral defaults
    for feat in PLAYER_FEATURE_NAMES:
        val_a = team_a.get(feat, NEUTRAL_DEFAULTS[feat])
        val_b = team_b.get(feat, NEUTRAL_DEFAULTS[feat])
        if feat == "tov_discipline":
            # Lower TOV% is better, so flip the diff
            features[f"{feat}_diff"] = val_b - val_a
        elif feat == "star_concentration" or feat == "freshman_minutes_pct" or feat == "rebound_concentration" or feat == "depth_gap":
            # These are risk factors: higher = more fragile
            # Positive diff means team A is LESS fragile (advantage)
            features[f"{feat}_diff"] = val_b - val_a
        else:
            # Higher is better: experience, FT, balance, guard quality
            features[f"{feat}_diff"] = val_a - val_b

    # Location-split features
    for feat in LOCATION_FEATURE_NAMES:
        val_a = team_a.get(feat, LOCATION_DEFAULTS[feat])
        val_b = team_b.get(feat, LOCATION_DEFAULTS[feat])
        if feat == "home_dependency":
            # Higher home dependency = more vulnerable in tournament (risk factor)
            # Positive diff = team A is LESS dependent (advantage)
            features[f"{feat}_diff"] = val_b - val_a
        else:
            # Higher away/neutral win pct = better (direct advantage)
            features[f"{feat}_diff"] = val_a - val_b

    return features


def compute_location_records(
    db: DatabaseManager, season: int
) -> dict[int, dict[str, float]]:
    """Compute home/away/neutral win records for each team.

    Returns dict[team_id, {home_win_pct, away_win_pct, neutral_win_pct,
                           home_dependency}]
    """
    games = db.execute(
        """
        SELECT home_team_id, away_team_id, home_score, away_score, is_neutral_site
        FROM games WHERE season = %s
        """,
        (season,),
    )

    # Accumulate records: team_id -> {home_w, home_l, away_w, away_l, neut_w, neut_l}
    records: dict[int, dict[str, int]] = {}

    def ensure(tid: int) -> dict[str, int]:
        if tid not in records:
            records[tid] = {
                "home_w": 0, "home_l": 0,
                "away_w": 0, "away_l": 0,
                "neut_w": 0, "neut_l": 0,
            }
        return records[tid]

    for g in games:
        hid, aid = g["home_team_id"], g["away_team_id"]
        home_won = g["home_score"] > g["away_score"]

        if g["is_neutral_site"]:
            # Neutral: both teams get neutral record
            if home_won:
                ensure(hid)["neut_w"] += 1
                ensure(aid)["neut_l"] += 1
            else:
                ensure(hid)["neut_l"] += 1
                ensure(aid)["neut_w"] += 1
        else:
            # Regular home/away
            if home_won:
                ensure(hid)["home_w"] += 1
                ensure(aid)["away_l"] += 1
            else:
                ensure(hid)["home_l"] += 1
                ensure(aid)["away_w"] += 1

    result = {}
    for tid, r in records.items():
        home_total = r["home_w"] + r["home_l"]
        away_total = r["away_w"] + r["away_l"]
        neut_total = r["neut_w"] + r["neut_l"]

        home_pct = r["home_w"] / home_total if home_total > 0 else 0.5
        away_pct = r["away_w"] / away_total if away_total > 0 else 0.5
        neut_pct = r["neut_w"] / neut_total if neut_total > 0 else 0.5

        result[tid] = {
            "away_win_pct": away_pct,
            "neutral_win_pct": neut_pct,
            # How much a team depends on home court (high = vulnerable on road)
            "home_dependency": home_pct - away_pct,
        }

    return result


LOCATION_FEATURE_NAMES = ["away_win_pct", "neutral_win_pct", "home_dependency"]
LOCATION_DEFAULTS = {"away_win_pct": 0.5, "neutral_win_pct": 0.5, "home_dependency": 0.0}


def build_training_dataset(db: DatabaseManager, season: int) -> pd.DataFrame:
    """Build a labeled training dataset from historical games.

    For each game, creates a feature row with label:
      1 = team_a (home team) won
      0 = team_a (home team) lost

    Only includes games where both teams have Torvik ratings.
    """
    # Load all ratings for this season into a dict for fast lookup
    ratings_rows = db.execute(
        "SELECT * FROM torvik_ratings WHERE season = %s", (season,)
    )
    ratings_by_team = {r["team_id"]: dict(r) for r in ratings_rows}

    # Load player-derived features and merge into team dicts
    player_features = compute_all_team_player_features(db, season)
    for tid, pf in player_features.items():
        if tid in ratings_by_team:
            ratings_by_team[tid].update(pf)

    # Load location-split records and merge
    location_records = compute_location_records(db, season)
    for tid, lr in location_records.items():
        if tid in ratings_by_team:
            ratings_by_team[tid].update(lr)

    # Load all games for this season
    games = db.execute(
        """
        SELECT g.*, vo.spread, vo.implied_home_prob
        FROM games g
        LEFT JOIN vegas_odds vo ON vo.game_id = g.game_id
        WHERE g.season = %s
        """,
        (season,),
    )

    # Load bracket seeds if available
    seeds = {}
    bracket = db.execute(
        "SELECT team_id, seed FROM tournament_bracket WHERE season = %s",
        (season,),
    )
    for row in bracket:
        seeds[row["team_id"]] = row["seed"]

    rows = []
    for game in games:
        home_id = game["home_team_id"]
        away_id = game["away_team_id"]

        team_a = ratings_by_team.get(home_id)
        team_b = ratings_by_team.get(away_id)
        if not team_a or not team_b:
            continue

        features = build_matchup_features(
            team_a, team_b,
            seed_a=seeds.get(home_id),
            seed_b=seeds.get(away_id),
            spread=game.get("spread"),
        )

        # Label: 1 if home team won
        label = 1 if game["home_score"] > game["away_score"] else 0

        features["label"] = label
        features["game_id"] = game["game_id"]
        features["season"] = season
        features["is_neutral"] = 1 if game["is_neutral_site"] else 0
        features["is_tournament"] = 1 if game["is_tournament"] else 0

        rows.append(features)

    df = pd.DataFrame(rows)
    logger.info(f"Built {len(df)} training samples for season {season}")
    return df


def build_multi_season_dataset(
    db: DatabaseManager, seasons: list[int]
) -> pd.DataFrame:
    """Build training data across multiple seasons."""
    frames = []
    for season in seasons:
        df = build_training_dataset(db, season)
        if not df.empty:
            frames.append(df)
            print(f"  Season {season}: {len(df)} samples")

    if not frames:
        return pd.DataFrame()

    combined = pd.concat(frames, ignore_index=True)
    print(f"  Total: {len(combined)} samples across {len(frames)} seasons")
    return combined


# Feature columns used by the model (excludes metadata)
FEATURE_COLS = [
    # Team efficiency differentials (original 20)
    "net_eff_diff", "adj_oe_diff", "adj_de_diff",
    "off_vs_def", "def_vs_off",
    "tempo_diff", "expected_tempo", "barthag_diff",
    "efg_diff", "tov_diff", "orb_diff", "ftr_diff",
    "efg_d_diff", "tov_d_diff", "drb_diff", "ftr_d_diff",
    "win_pct_diff", "seed_diff", "spread", "has_spread",
    # Player-derived features (new 10)
    "experience_idx_diff",
    "star_concentration_diff",
    "depth_gap_diff",
    "ft_reliability_diff",
    "three_pt_rate_diff",
    "tov_discipline_diff",
    "scoring_balance_diff",
    "guard_quality_diff",
    "freshman_minutes_pct_diff",
    "rebound_concentration_diff",
]

# Tournament model: base features + location-awareness (33 features)
TOURNAMENT_FEATURE_COLS = FEATURE_COLS + [
    "away_win_pct_diff",
    "neutral_win_pct_diff",
    "home_dependency_diff",
]


if __name__ == "__main__":
    from config import load_config

    config = load_config()
    db = DatabaseManager(config.database_url)

    print("Building training dataset for 2026...")
    df = build_training_dataset(db, 2026)

    if not df.empty:
        print(f"\nDataset shape: {df.shape}")
        print(f"Home win rate: {df['label'].mean():.3f}")
        print(f"\nFeature stats:")
        print(df[FEATURE_COLS].describe().round(2).to_string())
    else:
        print("No training data generated.")
