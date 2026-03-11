"""Compute and store team profiles from player stats.

Aggregates individual player advanced stats into team-level features
that capture roster composition, depth, experience, and vulnerability.
These profiles power the archetype indicators displayed on the web dashboard.
"""

from __future__ import annotations

import logging

from config import load_config
from db.database import DatabaseManager
from features.player_features import compute_all_team_player_features

logger = logging.getLogger(__name__)


def ingest_profiles(db: DatabaseManager, season: int) -> int:
    """Compute player-derived team profiles and upsert into team_profiles table."""
    # Ensure table exists
    db.execute("""
        CREATE TABLE IF NOT EXISTS team_profiles (
            id SERIAL PRIMARY KEY,
            team_id INTEGER NOT NULL REFERENCES teams(team_id),
            season INTEGER NOT NULL,
            experience_idx DOUBLE PRECISION,
            star_concentration DOUBLE PRECISION,
            depth_gap DOUBLE PRECISION,
            ft_reliability DOUBLE PRECISION,
            three_pt_rate DOUBLE PRECISION,
            tov_discipline DOUBLE PRECISION,
            scoring_balance INTEGER,
            guard_quality DOUBLE PRECISION,
            freshman_minutes_pct DOUBLE PRECISION,
            rebound_concentration DOUBLE PRECISION,
            computed_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(team_id, season)
        )
    """)
    db.execute(
        "CREATE INDEX IF NOT EXISTS idx_team_profiles_season ON team_profiles(team_id, season)"
    )

    features = compute_all_team_player_features(db, season)

    rows = []
    for team_id, f in features.items():
        rows.append((
            team_id, season,
            f["experience_idx"],
            f["star_concentration"],
            f["depth_gap"],
            f["ft_reliability"],
            f["three_pt_rate"],
            f["tov_discipline"],
            f["scoring_balance"],
            f["guard_quality"],
            f["freshman_minutes_pct"],
            f["rebound_concentration"],
        ))

    db.execute_many(
        """
        INSERT INTO team_profiles (
            team_id, season,
            experience_idx, star_concentration, depth_gap,
            ft_reliability, three_pt_rate, tov_discipline,
            scoring_balance, guard_quality, freshman_minutes_pct,
            rebound_concentration
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (team_id, season) DO UPDATE SET
            experience_idx = EXCLUDED.experience_idx,
            star_concentration = EXCLUDED.star_concentration,
            depth_gap = EXCLUDED.depth_gap,
            ft_reliability = EXCLUDED.ft_reliability,
            three_pt_rate = EXCLUDED.three_pt_rate,
            tov_discipline = EXCLUDED.tov_discipline,
            scoring_balance = EXCLUDED.scoring_balance,
            guard_quality = EXCLUDED.guard_quality,
            freshman_minutes_pct = EXCLUDED.freshman_minutes_pct,
            rebound_concentration = EXCLUDED.rebound_concentration,
            computed_at = NOW()
        """,
        rows,
    )

    print(f"Stored profiles for {len(rows)} teams (season {season})")
    return len(rows)


if __name__ == "__main__":
    config = load_config()
    db = DatabaseManager(config.database_url)
    ingest_profiles(db, config.model.current_season)
