"""Ingest player-level stats from Barttorvik getadvstats.php.

Returns advanced stats for ~5,000 D1 players per season including:
  - Per-game: PPG, RPG, APG
  - Efficiency: ORtg, usage rate, eFG%, TS%
  - Advanced: ORB%, DRB%, AST%, TOV%, BLK%, STL%
  - Shooting: 2FG%, 3FG%, FT%, FTR
  - Impact: OBPM, DRtg
  - Bio: class (Fr/So/Jr/Sr), height, position, hometown

Column mapping for getadvstats.php CSV:
  [0]  name              [23] stl%
  [1]  team (Torvik)     [24] ftr
  [2]  conference        [25] class (Fr/So/Jr/Sr)
  [3]  games             [26] height
  [4]  min_pct           [27] number
  [5]  ortg              [28] obpm
  [6]  usage_rate        [29] drtg
  [7]  efg%              [30] ppg
  [8]  ts%               [31] season
  [9]  orb%              [32] player_id
  [10] drb%              [33] hometown
  [11] ast%              [34] (team strength)
  [12] tov%              [35] (team barthag)
  [13] ftm               [36-45] (shooting splits)
  [14] fta               [46-56] (advanced per-possession)
  [15] ft%               [57] orpg
  [16] 2fgm              [58] drpg
  [17] 2fga              [59] rpg
  [18] 2fg%              [60] apg
  [19] 3fgm              [61] stl_pg
  [20] 3fga              [62] blk_pg
  [21] 3fg%              [63] pts_pg
  [22] blk%              [64] position
                          [65] (unknown)
                          [66] birthdate
"""

from __future__ import annotations

import csv
import io
import logging
from typing import Any

import requests

from db.database import DatabaseManager
from ingest.torvik import build_team_id_cache, resolve_from_cache

logger = logging.getLogger(__name__)

ADVSTATS_URL = "https://barttorvik.com/getadvstats.php"


def fetch_player_stats(season: int) -> list[list[str]]:
    """Fetch all player stats for a season from Barttorvik."""
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
    }
    resp = requests.get(
        ADVSTATS_URL,
        headers=headers,
        params={"year": season, "csv": 1},
        timeout=30,
    )
    resp.raise_for_status()

    reader = csv.reader(io.StringIO(resp.text))
    rows = list(reader)
    logger.info(f"Fetched {len(rows)} player records for {season}")
    return rows


def safe_float(val: str) -> float | None:
    """Convert string to float, returning None for empty/invalid values."""
    if not val or val.strip() == "":
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def safe_int(val: str) -> int | None:
    """Convert string to int, returning None for empty/invalid values."""
    if not val or val.strip() == "":
        return None
    try:
        return int(float(val))
    except (ValueError, TypeError):
        return None


def ingest_players(db: DatabaseManager, season: int) -> int:
    """Fetch and store player stats for a season.

    Returns number of players ingested.
    """
    print(f"Fetching player stats for {season}...")
    rows = fetch_player_stats(season)
    print(f"  {len(rows)} players fetched")

    # Ensure table exists
    db.execute("""
        CREATE TABLE IF NOT EXISTS player_stats (
            id SERIAL PRIMARY KEY,
            player_id INTEGER NOT NULL,
            season INTEGER NOT NULL,
            team_id INTEGER NOT NULL REFERENCES teams(team_id),
            name TEXT NOT NULL,
            class TEXT,
            height TEXT,
            position TEXT,
            number INTEGER,
            games INTEGER,
            min_pct DOUBLE PRECISION,
            ortg DOUBLE PRECISION,
            usage_rate DOUBLE PRECISION,
            efg DOUBLE PRECISION,
            ts_pct DOUBLE PRECISION,
            orb_pct DOUBLE PRECISION,
            drb_pct DOUBLE PRECISION,
            ast_pct DOUBLE PRECISION,
            tov_pct DOUBLE PRECISION,
            ftm INTEGER,
            fta INTEGER,
            ft_pct DOUBLE PRECISION,
            twofgm INTEGER,
            twofga INTEGER,
            twofg_pct DOUBLE PRECISION,
            threefgm INTEGER,
            threefga INTEGER,
            threefg_pct DOUBLE PRECISION,
            blk_pct DOUBLE PRECISION,
            stl_pct DOUBLE PRECISION,
            ftr DOUBLE PRECISION,
            obpm DOUBLE PRECISION,
            drtg DOUBLE PRECISION,
            ppg DOUBLE PRECISION,
            rpg DOUBLE PRECISION,
            apg DOUBLE PRECISION,
            hometown TEXT,
            birthdate TEXT,
            fetched_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(player_id, season)
        )
    """)

    team_cache = build_team_id_cache(db)

    batch = []
    skipped = 0

    for row in rows:
        if len(row) < 67:
            skipped += 1
            continue

        team_name = row[1]
        team_id = resolve_from_cache(team_cache, team_name)
        if not team_id:
            skipped += 1
            continue

        player_id = safe_int(row[32])
        if not player_id:
            skipped += 1
            continue

        # Per-game stats from columns [57-63]
        rpg = safe_float(row[59])
        apg = safe_float(row[60])
        ppg_pergame = safe_float(row[63])  # actual per-game points

        batch.append((
            player_id, season, team_id,
            row[0],             # name
            row[25],            # class
            row[26],            # height
            row[64],            # position
            safe_int(row[27]),  # number
            safe_int(row[3]),   # games
            safe_float(row[4]), # min_pct
            safe_float(row[5]), # ortg
            safe_float(row[6]), # usage_rate
            safe_float(row[7]), # efg
            safe_float(row[8]), # ts_pct
            safe_float(row[9]), # orb_pct
            safe_float(row[10]),# drb_pct
            safe_float(row[11]),# ast_pct
            safe_float(row[12]),# tov_pct
            safe_int(row[13]),  # ftm
            safe_int(row[14]),  # fta
            safe_float(row[15]),# ft_pct
            safe_int(row[16]),  # twofgm
            safe_int(row[17]),  # twofga
            safe_float(row[18]),# twofg_pct
            safe_int(row[19]),  # threefgm
            safe_int(row[20]),  # threefga
            safe_float(row[21]),# threefg_pct
            safe_float(row[22]),# blk_pct
            safe_float(row[23]),# stl_pct
            safe_float(row[24]),# ftr
            safe_float(row[28]),# obpm
            safe_float(row[29]),# drtg
            ppg_pergame,        # ppg
            rpg,                # rpg
            apg,                # apg
            row[33],            # hometown
            row[66],            # birthdate
        ))

    # Batch insert
    db.execute_many(
        """
        INSERT INTO player_stats (
            player_id, season, team_id, name, class, height, position, number,
            games, min_pct, ortg, usage_rate, efg, ts_pct,
            orb_pct, drb_pct, ast_pct, tov_pct,
            ftm, fta, ft_pct, twofgm, twofga, twofg_pct,
            threefgm, threefga, threefg_pct,
            blk_pct, stl_pct, ftr, obpm, drtg,
            ppg, rpg, apg, hometown, birthdate
        ) VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s, %s,
            %s, %s, %s, %s,
            %s, %s, %s, %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s
        )
        ON CONFLICT (player_id, season) DO UPDATE SET
            team_id = EXCLUDED.team_id,
            name = EXCLUDED.name,
            class = EXCLUDED.class,
            height = EXCLUDED.height,
            position = EXCLUDED.position,
            number = EXCLUDED.number,
            games = EXCLUDED.games,
            min_pct = EXCLUDED.min_pct,
            ortg = EXCLUDED.ortg,
            usage_rate = EXCLUDED.usage_rate,
            efg = EXCLUDED.efg,
            ts_pct = EXCLUDED.ts_pct,
            orb_pct = EXCLUDED.orb_pct,
            drb_pct = EXCLUDED.drb_pct,
            ast_pct = EXCLUDED.ast_pct,
            tov_pct = EXCLUDED.tov_pct,
            ftm = EXCLUDED.ftm,
            fta = EXCLUDED.fta,
            ft_pct = EXCLUDED.ft_pct,
            twofgm = EXCLUDED.twofgm,
            twofga = EXCLUDED.twofga,
            twofg_pct = EXCLUDED.twofg_pct,
            threefgm = EXCLUDED.threefgm,
            threefga = EXCLUDED.threefga,
            threefg_pct = EXCLUDED.threefg_pct,
            blk_pct = EXCLUDED.blk_pct,
            stl_pct = EXCLUDED.stl_pct,
            ftr = EXCLUDED.ftr,
            obpm = EXCLUDED.obpm,
            drtg = EXCLUDED.drtg,
            ppg = EXCLUDED.ppg,
            rpg = EXCLUDED.rpg,
            apg = EXCLUDED.apg,
            hometown = EXCLUDED.hometown,
            birthdate = EXCLUDED.birthdate,
            fetched_at = NOW()
        """,
        batch,
    )

    print(f"  {len(batch)} players stored ({skipped} skipped)")
    return len(batch)


if __name__ == "__main__":
    from config import load_config

    config = load_config()
    db = DatabaseManager(config.database_url)

    count = ingest_players(db, config.model.current_season)

    # Show top 20 by PPG
    top = db.execute("""
        SELECT ps.name, t.name as team, ps.class, ps.position,
               ps.ppg, ps.rpg, ps.apg, ps.usage_rate, ps.efg, ps.ts_pct,
               ps.games, ps.min_pct
        FROM player_stats ps
        JOIN teams t ON t.team_id = ps.team_id
        WHERE ps.season = %s AND ps.min_pct > 50
        ORDER BY ps.ppg DESC
        LIMIT 20
    """, (config.model.current_season,))

    print(f"\nTop 20 Players by PPG ({config.model.current_season}, min 50% minutes):")
    print(f"{'Name':25s} {'Team':20s} {'Cls':3s} {'Pos':12s} {'PPG':>5} {'RPG':>5} {'APG':>5} {'USG':>5} {'TS%':>5}")
    print("-" * 90)
    for p in top:
        print(
            f"{p['name']:25s} {p['team']:20s} {p['class']:3s} {p['position']:12s} "
            f"{p['ppg']:5.1f} {p['rpg']:5.1f} {p['apg']:5.1f} "
            f"{p['usage_rate']:5.1f} {p['ts_pct']:5.1f}"
        )
