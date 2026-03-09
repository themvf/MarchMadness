"""Ingest Torvik game stats and compute team ratings.

Uses barttorvik.com/getgamestats.php which returns per-game efficiency
metrics for all D1 teams. This endpoint bypasses Cloudflare protection
unlike the main trank.php page.

The data provides:
  - Per-game adjusted OE/DE
  - Four factors (eFG%, TOV%, ORB%, FTR) for offense and defense
  - Opponent strength (Barthag)
  - Boxscore data

We aggregate per-game stats into season-level team ratings that match
what Torvik shows on his T-Rank page.

Field mapping for getgamestats.php response arrays:
  [0]  game_date        [16] opp_tov_pct
  [1]  (flag)           [17] opp_orb_pct
  [2]  team_name        [18] opp_ftr
  [3]  team_conf        [19] team_barthag_pct
  [4]  opp_name         [20] opp_conf
  [5]  location (H/A/N) [21] outcome_code
  [6]  result_str       [22] season
  [7]  adj_oe           [23] possessions
  [8]  adj_de           [24] game_key
  [9]  raw_oe           [25] team_coach
  [10] efg_pct          [26] opp_coach
  [11] tov_pct          [27] adj_margin
  [12] orb_pct          [28] opp_barthag
  [13] ftr              [29] boxscore_array
  [14] raw_de           [30] (classification)
  [15] opp_efg_pct
"""

from __future__ import annotations

import json
import logging
import statistics
from collections import defaultdict
from datetime import datetime
from typing import Any

import requests

from config import AppConfig
from db.database import DatabaseManager
from db.queries import (
    find_team_id,
    get_torvik_ratings,
    insert_game,
    upsert_torvik_rating,
)
from ingest.team_mappings import resolve_canonical_name, resolve_team_id

logger = logging.getLogger(__name__)

GAMESTATS_URL = "https://barttorvik.com/getgamestats.php"


def fetch_game_stats(season: int, top: int = 353) -> list[list[Any]]:
    """Fetch per-game stats from barttorvik.com for a season.

    Returns a list of game record arrays. Each game appears twice
    (once per team perspective).
    """
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
    }
    params = {"year": season, "top": top}
    resp = requests.get(GAMESTATS_URL, headers=headers, params=params, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    logger.info(f"Fetched {len(data)} game records for {season}")
    return data


def parse_result(result_str: str) -> tuple[int, int, bool]:
    """Parse 'W, 96-62' into (team_score, opp_score, won)."""
    parts = result_str.split(", ")
    won = parts[0] == "W"
    scores = parts[1].split("-")
    if won:
        return int(scores[0]), int(scores[1]), True
    else:
        return int(scores[1]), int(scores[0]), False


def parse_game_date(date_str: str) -> str:
    """Convert '12/16/25' to '2025-12-16' (ISO format).

    Handles academic year correctly: months 8-12 are in the first
    calendar year, months 1-7 are in the second.
    """
    parts = date_str.split("/")
    month = int(parts[0])
    day = int(parts[1])
    short_year = int(parts[2])
    # College basketball: Aug-Dec = 20XX, Jan-Jul = 20(XX+1)
    if month >= 8:
        year = 2000 + short_year
    else:
        year = 2000 + short_year
    return f"{year:04d}-{month:02d}-{day:02d}"


def make_game_id(record: list) -> str:
    """Generate a unique game ID from the game_key field."""
    # Field [24] is a composite like 'Abilene ChristianArizona12-16'
    # Use it directly as the base, adding season for uniqueness
    return f"{record[22]}_{record[24]}"


def build_team_id_cache(db: DatabaseManager) -> dict[str, int]:
    """Load all teams into a name->team_id cache with a single query.

    Indexes by all name variants (canonical, torvik, ncaa, odds_api)
    so any source name resolves instantly without hitting the DB.
    """
    cache: dict[str, int] = {}
    rows = db.execute("SELECT team_id, name, torvik_name, ncaa_name, odds_api_name FROM teams")
    for row in rows:
        tid = row["team_id"]
        for col in ("name", "torvik_name", "ncaa_name", "odds_api_name"):
            val = row.get(col, "")
            if val:
                cache[val.lower()] = tid
    return cache


def resolve_from_cache(cache: dict[str, int], name: str) -> int | None:
    """Resolve a team name to team_id using the pre-loaded cache."""
    return cache.get(name.lower())


def ingest_games(db: DatabaseManager, season: int, game_records: list[list]) -> int:
    """Insert game records into the database using batch operations.

    Each game appears twice in the raw data (once per team). We only
    insert once by processing the 'home team' perspective and skipping
    the duplicate. Uses a single DB connection for all inserts.
    """
    # Pre-load all team IDs in a single query
    team_cache = build_team_id_cache(db)

    # Build batch of game rows
    seen_keys = set()
    batch = []

    for rec in game_records:
        game_key = rec[24]
        if game_key in seen_keys:
            continue
        seen_keys.add(game_key)

        team_name = rec[2]
        opp_name = rec[4]
        location = rec[5]

        team_id = resolve_from_cache(team_cache, team_name)
        opp_id = resolve_from_cache(team_cache, opp_name)
        if not team_id or not opp_id:
            continue

        team_score, opp_score, won = parse_result(rec[6])
        is_neutral = location == "N"
        if location == "H":
            home_id, away_id = team_id, opp_id
            home_score, away_score = team_score, opp_score
        elif location == "A":
            home_id, away_id = opp_id, team_id
            home_score, away_score = opp_score, team_score
        else:
            home_id, away_id = team_id, opp_id
            home_score, away_score = team_score, opp_score

        game_date = parse_game_date(rec[0])
        game_id = make_game_id(rec)

        batch.append((
            game_id, season, game_date, home_id, away_id,
            home_score, away_score, is_neutral, False, "",
        ))

    # Batch insert in single transaction
    db.execute_many(
        """
        INSERT INTO games (game_id, season, game_date, home_team_id, away_team_id,
                           home_score, away_score, is_neutral_site, is_tournament,
                           tournament_round)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (game_id) DO NOTHING
        """,
        batch,
    )
    logger.info(f"Inserted {len(batch)} games for {season}")
    return len(batch)


def compute_team_ratings(
    game_records: list[list],
) -> dict[str, dict[str, float]]:
    """Aggregate per-game stats into season-level team ratings.

    Returns a dict keyed by Torvik team name with computed metrics:
      adj_oe, adj_de, adj_em, adj_tempo, efg, tov, orb, ftr,
      efg_d, tov_d, orb_d, ftr_d, wins, losses, barthag
    """
    team_games: dict[str, list[list]] = defaultdict(list)
    for g in game_records:
        team_games[g[2]].append(g)

    ratings = {}
    for team, games in team_games.items():
        n = len(games)
        if n == 0:
            continue

        adj_oe = statistics.mean(g[7] for g in games)
        adj_de = statistics.mean(g[8] for g in games)
        adj_em = adj_oe - adj_de

        ratings[team] = {
            "adj_oe": round(adj_oe, 2),
            "adj_de": round(adj_de, 2),
            "adj_em": round(adj_em, 2),
            "adj_tempo": round(statistics.mean(g[23] for g in games), 1),
            "efg": round(statistics.mean(g[10] for g in games), 1),
            "efg_d": round(statistics.mean(g[15] for g in games), 1),
            "tov": round(statistics.mean(g[11] for g in games), 1),
            "tov_d": round(statistics.mean(g[16] for g in games), 1),
            "orb": round(statistics.mean(g[12] for g in games), 1),
            "drb": round(100 - statistics.mean(g[17] for g in games), 1),
            "ftr": round(statistics.mean(g[13] for g in games), 1),
            "ftr_d": round(statistics.mean(g[18] for g in games), 1),
            "wins": sum(1 for g in games if g[6].startswith("W")),
            "losses": sum(1 for g in games if g[6].startswith("L")),
            "conference": games[0][3],
        }

    # Compute Barthag-like metric from AdjEM
    # Barthag = expected win% vs average D1 team
    # Using logistic: barthag = 1 / (1 + exp(-adjEM / k))
    # k ~ 10 fits empirical data well
    import math
    for team, r in ratings.items():
        r["barthag"] = round(1 / (1 + math.exp(-r["adj_em"] / 10)), 4)

    return ratings


def ingest_torvik_ratings(
    db: DatabaseManager, season: int, ratings: dict[str, dict]
) -> int:
    """Store computed team ratings into the torvik_ratings table (batch)."""
    sorted_teams = sorted(ratings.items(), key=lambda x: -x[1]["adj_em"])

    team_cache = build_team_id_cache(db)
    batch = []
    for rank, (team_name, r) in enumerate(sorted_teams, 1):
        team_id = resolve_from_cache(team_cache, team_name)
        if not team_id:
            logger.warning(f"Could not resolve team for ratings: {team_name}")
            continue

        batch.append((
            team_id, season, rank,
            r["adj_oe"], r["adj_de"], r["adj_em"], r["barthag"],
            r["adj_tempo"], r["efg"], r["efg_d"],
            r["tov"], r["tov_d"], r["orb"], r["drb"],
            r["ftr"], r["ftr_d"], r["wins"], r["losses"],
        ))

    db.execute_many(
        """
        INSERT INTO torvik_ratings (
            team_id, season, rank, adj_oe, adj_de, adj_em, barthag,
            adj_tempo, efg, efg_d, tov, tov_d, orb, drb, ftr, ftr_d,
            wins, losses
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (team_id, season) DO UPDATE SET
            rank = EXCLUDED.rank, adj_oe = EXCLUDED.adj_oe, adj_de = EXCLUDED.adj_de,
            adj_em = EXCLUDED.adj_em, barthag = EXCLUDED.barthag, adj_tempo = EXCLUDED.adj_tempo,
            efg = EXCLUDED.efg, efg_d = EXCLUDED.efg_d, tov = EXCLUDED.tov, tov_d = EXCLUDED.tov_d,
            orb = EXCLUDED.orb, drb = EXCLUDED.drb, ftr = EXCLUDED.ftr, ftr_d = EXCLUDED.ftr_d,
            wins = EXCLUDED.wins, losses = EXCLUDED.losses, fetched_at = NOW()
        """,
        batch,
    )

    logger.info(f"Stored ratings for {len(batch)} teams (season {season})")
    return len(batch)


def ingest_season(db: DatabaseManager, season: int) -> dict[str, int]:
    """Full ingestion pipeline for a season.

    1. Fetch game stats from barttorvik.com
    2. Insert games into the database
    3. Compute and store team ratings

    Returns counts of games and ratings inserted.
    """
    print(f"Fetching game stats for {season}...")
    records = fetch_game_stats(season)
    print(f"  {len(records)} game records ({len(records) // 2} unique games)")

    print("Inserting games...")
    games_count = ingest_games(db, season, records)
    print(f"  {games_count} games inserted")

    print("Computing team ratings...")
    ratings = compute_team_ratings(records)
    print(f"  {len(ratings)} teams rated")

    print("Storing ratings...")
    ratings_count = ingest_torvik_ratings(db, season, ratings)
    print(f"  {ratings_count} ratings stored")

    return {"games": games_count, "ratings": ratings_count}


if __name__ == "__main__":
    from config import load_config

    config = load_config()
    if not config.database_url:
        print("ERROR: DATABASE_URL not set")
        exit(1)

    db = DatabaseManager(config.database_url)

    # Ingest current season
    result = ingest_season(db, config.model.current_season)
    print(f"\nDone: {result['games']} games, {result['ratings']} ratings")

    # Show top 10
    top = get_torvik_ratings(db, config.model.current_season)[:10]
    print(f"\nTop 10 teams ({config.model.current_season}):")
    print(f"{'Rk':>3} {'Team':25s} {'Conf':5s} {'AdjOE':>6} {'AdjDE':>6} {'AdjEM':>6}")
    print("-" * 52)
    for r in top:
        print(
            f"{r['rank']:3d} {r['name']:25s} {r['conference']:5s} "
            f"{r['adj_oe']:6.1f} {r['adj_de']:6.1f} {r['adj_em']:6.1f}"
        )
