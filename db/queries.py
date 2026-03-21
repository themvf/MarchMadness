"""Database query functions for March Madness Strategy.

All functions take a DatabaseManager instance and use %s placeholders
for Neon PostgreSQL.
"""

from __future__ import annotations

from typing import Optional
from db.database import DatabaseManager


# ── Teams ────────────────────────────────────────────────────

def upsert_team(
    db: DatabaseManager,
    name: str,
    conference: str = "",
    torvik_name: str = "",
    ncaa_name: str = "",
    odds_api_name: str = "",
    short_name: str = "",
    logo_url: str = "",
) -> int:
    """Insert or update a team, returning team_id."""
    return db.execute_insert(
        """
        INSERT INTO teams (name, conference, torvik_name, ncaa_name,
                           odds_api_name, short_name, logo_url)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (name) DO UPDATE SET
            conference = COALESCE(NULLIF(EXCLUDED.conference, ''), teams.conference),
            torvik_name = COALESCE(NULLIF(EXCLUDED.torvik_name, ''), teams.torvik_name),
            ncaa_name = COALESCE(NULLIF(EXCLUDED.ncaa_name, ''), teams.ncaa_name),
            odds_api_name = COALESCE(NULLIF(EXCLUDED.odds_api_name, ''), teams.odds_api_name),
            short_name = COALESCE(NULLIF(EXCLUDED.short_name, ''), teams.short_name),
            logo_url = COALESCE(NULLIF(EXCLUDED.logo_url, ''), teams.logo_url)
        RETURNING team_id AS id
        """,
        (name, conference, torvik_name, ncaa_name, odds_api_name, short_name, logo_url),
    )


def get_team_by_name(db: DatabaseManager, name: str) -> Optional[dict]:
    """Look up a team by canonical name."""
    return db.execute_one("SELECT * FROM teams WHERE name = %s", (name,))


def get_team_by_source_name(
    db: DatabaseManager, source: str, source_name: str
) -> Optional[dict]:
    """Look up a team by source-specific name (torvik_name, ncaa_name, odds_api_name)."""
    col_map = {
        "torvik": "torvik_name",
        "ncaa": "ncaa_name",
        "odds": "odds_api_name",
    }
    col = col_map.get(source)
    if not col:
        return None
    return db.execute_one(f"SELECT * FROM teams WHERE {col} = %s", (source_name,))


def get_all_teams(db: DatabaseManager) -> list[dict]:
    """Return all teams ordered by name."""
    return db.execute("SELECT * FROM teams ORDER BY name")


def find_team_id(db: DatabaseManager, name: str) -> Optional[int]:
    """Find team_id by searching canonical name, then all source name columns."""
    row = db.execute_one(
        """
        SELECT team_id FROM teams
        WHERE name = %s OR torvik_name = %s OR ncaa_name = %s OR odds_api_name = %s
        LIMIT 1
        """,
        (name, name, name, name),
    )
    return row["team_id"] if row else None


# ── Torvik Ratings ───────────────────────────────────────────

def upsert_torvik_rating(db: DatabaseManager, team_id: int, season: int, **kwargs) -> int:
    """Insert or update a Torvik rating row."""
    cols = ["team_id", "season"] + list(kwargs.keys())
    placeholders = ", ".join(["%s"] * len(cols))
    updates = ", ".join(f"{k} = EXCLUDED.{k}" for k in kwargs.keys())
    values = [team_id, season] + list(kwargs.values())

    return db.execute_insert(
        f"""
        INSERT INTO torvik_ratings ({', '.join(cols)})
        VALUES ({placeholders})
        ON CONFLICT (team_id, season) DO UPDATE SET {updates}
        RETURNING id
        """,
        values,
    )


def get_torvik_ratings(db: DatabaseManager, season: int) -> list[dict]:
    """Get all Torvik ratings for a season, joined with team names."""
    return db.execute(
        """
        SELECT t.name, t.conference, tr.*
        FROM torvik_ratings tr
        JOIN teams t ON t.team_id = tr.team_id
        WHERE tr.season = %s
        ORDER BY tr.rank
        """,
        (season,),
    )


def get_team_rating(db: DatabaseManager, team_id: int, season: int) -> Optional[dict]:
    """Get a specific team's Torvik rating for a season."""
    return db.execute_one(
        "SELECT * FROM torvik_ratings WHERE team_id = %s AND season = %s",
        (team_id, season),
    )


# ── Games ────────────────────────────────────────────────────

def insert_game(db: DatabaseManager, game_id: str, season: int, game_date: str,
                home_team_id: int, away_team_id: int, home_score: int,
                away_score: int, is_neutral_site: bool = False,
                is_tournament: bool = False, tournament_round: str = "") -> None:
    """Insert a game (skip if game_id already exists)."""
    db.execute(
        """
        INSERT INTO games (game_id, season, game_date, home_team_id, away_team_id,
                           home_score, away_score, is_neutral_site, is_tournament,
                           tournament_round)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (game_id) DO NOTHING
        """,
        (game_id, season, game_date, home_team_id, away_team_id,
         home_score, away_score, is_neutral_site, is_tournament, tournament_round),
    )


def get_season_games(db: DatabaseManager, season: int) -> list[dict]:
    """Get all games for a season with team names."""
    return db.execute(
        """
        SELECT g.*,
               ht.name AS home_team, at.name AS away_team
        FROM games g
        JOIN teams ht ON ht.team_id = g.home_team_id
        JOIN teams at ON at.team_id = g.away_team_id
        WHERE g.season = %s
        ORDER BY g.game_date
        """,
        (season,),
    )


def get_tournament_games(db: DatabaseManager, season: int) -> list[dict]:
    """Get all tournament games for a season."""
    return db.execute(
        """
        SELECT g.*,
               ht.name AS home_team, at.name AS away_team
        FROM games g
        JOIN teams ht ON ht.team_id = g.home_team_id
        JOIN teams at ON at.team_id = g.away_team_id
        WHERE g.season = %s AND g.is_tournament = TRUE
        ORDER BY g.game_date
        """,
        (season,),
    )


# ── Vegas Odds ───────────────────────────────────────────────

def upsert_vegas_odds(db: DatabaseManager, game_id: str, spread: float,
                      total: float, home_ml: int, away_ml: int,
                      implied_home_prob: float, bookmaker: str = "consensus") -> int:
    """Insert or update Vegas odds for a game."""
    return db.execute_insert(
        """
        INSERT INTO vegas_odds (game_id, spread, total, home_ml, away_ml,
                                implied_home_prob, bookmaker)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (game_id, bookmaker) DO UPDATE SET
            spread = EXCLUDED.spread,
            total = EXCLUDED.total,
            home_ml = EXCLUDED.home_ml,
            away_ml = EXCLUDED.away_ml,
            implied_home_prob = EXCLUDED.implied_home_prob,
            fetched_at = NOW()
        RETURNING id
        """,
        (game_id, spread, total, home_ml, away_ml, implied_home_prob, bookmaker),
    )


# ── Tournament Bracket ──────────────────────────────────────

def upsert_bracket_entry(db: DatabaseManager, season: int, team_id: int,
                         seed: int, region: str, bracket_position: int = 0) -> int:
    """Insert or update a bracket entry."""
    return db.execute_insert(
        """
        INSERT INTO tournament_bracket (season, team_id, seed, region, bracket_position)
        VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT (season, team_id) DO UPDATE SET
            seed = EXCLUDED.seed,
            region = EXCLUDED.region,
            bracket_position = EXCLUDED.bracket_position
        RETURNING id
        """,
        (season, team_id, seed, region, bracket_position),
    )


def get_bracket(db: DatabaseManager, season: int) -> list[dict]:
    """Get the full tournament bracket with team info."""
    return db.execute(
        """
        SELECT tb.*, t.name, t.conference, t.logo_url
        FROM tournament_bracket tb
        JOIN teams t ON t.team_id = tb.team_id
        WHERE tb.season = %s
        ORDER BY tb.region, tb.seed
        """,
        (season,),
    )


# ── Bracket Matchups ──────────────────────────────────────

def upsert_bracket_matchup(
    db: DatabaseManager, season: int, round_name: str, matchup_slot: int,
    team_a_id: int, team_b_id: int, seed_a: int, seed_b: int,
    region: str = None, model_prob_a: float = None, log5_prob_a: float = None,
    vegas_spread_a: float = None, vegas_ml_a: int = None,
    vegas_ml_b: int = None, vegas_total: float = None,
    vegas_prob_a: float = None, winner_id: int = None,
    score_a: int = None, score_b: int = None, game_date: str = None,
) -> int:
    """Insert or update a bracket matchup."""
    return db.execute_insert(
        """
        INSERT INTO bracket_matchups (
            season, round, region, matchup_slot,
            team_a_id, team_b_id, seed_a, seed_b,
            model_prob_a, log5_prob_a,
            vegas_spread_a, vegas_ml_a, vegas_ml_b, vegas_total, vegas_prob_a,
            winner_id, score_a, score_b, game_date
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (season, round, matchup_slot) DO UPDATE SET
            team_a_id = EXCLUDED.team_a_id,
            team_b_id = EXCLUDED.team_b_id,
            seed_a = EXCLUDED.seed_a,
            seed_b = EXCLUDED.seed_b,
            region = EXCLUDED.region,
            model_prob_a = COALESCE(EXCLUDED.model_prob_a, bracket_matchups.model_prob_a),
            log5_prob_a = COALESCE(EXCLUDED.log5_prob_a, bracket_matchups.log5_prob_a),
            vegas_spread_a = COALESCE(EXCLUDED.vegas_spread_a, bracket_matchups.vegas_spread_a),
            vegas_ml_a = COALESCE(EXCLUDED.vegas_ml_a, bracket_matchups.vegas_ml_a),
            vegas_ml_b = COALESCE(EXCLUDED.vegas_ml_b, bracket_matchups.vegas_ml_b),
            vegas_total = COALESCE(EXCLUDED.vegas_total, bracket_matchups.vegas_total),
            vegas_prob_a = COALESCE(EXCLUDED.vegas_prob_a, bracket_matchups.vegas_prob_a),
            winner_id = COALESCE(EXCLUDED.winner_id, bracket_matchups.winner_id),
            score_a = COALESCE(EXCLUDED.score_a, bracket_matchups.score_a),
            score_b = COALESCE(EXCLUDED.score_b, bracket_matchups.score_b),
            game_date = COALESCE(EXCLUDED.game_date, bracket_matchups.game_date),
            computed_at = NOW()
        RETURNING id
        """,
        (season, round_name, region, matchup_slot,
         team_a_id, team_b_id, seed_a, seed_b,
         model_prob_a, log5_prob_a,
         vegas_spread_a, vegas_ml_a, vegas_ml_b, vegas_total, vegas_prob_a,
         winner_id, score_a, score_b, game_date),
    )


def get_bracket_matchups(db: DatabaseManager, season: int,
                         round_name: str = None) -> list[dict]:
    """Get bracket matchups with team info."""
    if round_name:
        return db.execute(
            """
            SELECT bm.*,
                   ta.name AS team_a_name, ta.logo_url AS team_a_logo,
                   ta.conference AS team_a_conf,
                   tb.name AS team_b_name, tb.logo_url AS team_b_logo,
                   tb.conference AS team_b_conf
            FROM bracket_matchups bm
            JOIN teams ta ON ta.team_id = bm.team_a_id
            JOIN teams tb ON tb.team_id = bm.team_b_id
            WHERE bm.season = %s AND bm.round = %s
            ORDER BY bm.matchup_slot
            """,
            (season, round_name),
        )
    return db.execute(
        """
        SELECT bm.*,
               ta.name AS team_a_name, ta.logo_url AS team_a_logo,
               ta.conference AS team_a_conf,
               tb.name AS team_b_name, tb.logo_url AS team_b_logo,
               tb.conference AS team_b_conf
        FROM bracket_matchups bm
        JOIN teams ta ON ta.team_id = bm.team_a_id
        JOIN teams tb ON tb.team_id = bm.team_b_id
        WHERE bm.season = %s
        ORDER BY bm.round, bm.matchup_slot
        """,
        (season,),
    )


def update_matchup_result(db: DatabaseManager, season: int, round_name: str,
                          matchup_slot: int, winner_id: int,
                          score_a: int, score_b: int) -> None:
    """Record the result of a bracket matchup."""
    db.execute(
        """
        UPDATE bracket_matchups
        SET winner_id = %s, score_a = %s, score_b = %s, computed_at = NOW()
        WHERE season = %s AND round = %s AND matchup_slot = %s
        """,
        (winner_id, score_a, score_b, season, round_name, matchup_slot),
    )


# ── Team News ──────────────────────────────────────────────

def insert_team_news(
    db: DatabaseManager, team_id: int, title: str, url: str,
    source: str = "", published_at: str = None,
    impact_score: int = 0, matched_keywords: str = "",
) -> bool:
    """Insert a news article. Returns True if inserted (not duplicate)."""
    result = db.execute(
        """
        INSERT INTO team_news (team_id, title, url, source, published_at,
                               impact_score, matched_keywords)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (team_id, url) DO NOTHING
        RETURNING id
        """,
        (team_id, title, url, source, published_at,
         impact_score, matched_keywords),
    )
    return len(result) > 0


# ── Odds Snapshots ─────────────────────────────────────────

def insert_odds_snapshot(
    db: DatabaseManager, matchup_id: int,
    spread_a: float = None, ml_a: int = None, ml_b: int = None,
    total: float = None, prob_a: float = None,
) -> int:
    """Insert a point-in-time odds snapshot for line movement tracking."""
    return db.execute_insert(
        """
        INSERT INTO odds_snapshots (matchup_id, spread_a, ml_a, ml_b, total, prob_a)
        VALUES (%s, %s, %s, %s, %s, %s)
        RETURNING id
        """,
        (matchup_id, spread_a, ml_a, ml_b, total, prob_a),
    )


def get_odds_snapshots(db: DatabaseManager, matchup_ids: list[int]) -> list[dict]:
    """Get all odds snapshots for given matchup IDs, ordered by time."""
    if not matchup_ids:
        return []
    placeholders = ",".join(["%s"] * len(matchup_ids))
    return db.execute(
        f"""
        SELECT id, matchup_id, spread_a, ml_a, ml_b, total, prob_a, fetched_at
        FROM odds_snapshots
        WHERE matchup_id IN ({placeholders})
        ORDER BY matchup_id, fetched_at
        """,
        tuple(matchup_ids),
    )


# ── Simulation Results ──────────────────────────────────────

def upsert_simulation_result(
    db: DatabaseManager, season: int, team_id: int, round_name: str,
    advancement_pct: float, n_simulations: int,
    model_version: str = "", leverage: float = None,
    path_difficulty: float = None,
) -> int:
    """Insert or update a simulation result."""
    return db.execute_insert(
        """
        INSERT INTO simulation_results (season, team_id, round, advancement_pct,
                                        n_simulations, model_version, leverage,
                                        path_difficulty)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (season, team_id, round, model_version) DO UPDATE SET
            advancement_pct = EXCLUDED.advancement_pct,
            n_simulations = EXCLUDED.n_simulations,
            leverage = EXCLUDED.leverage,
            path_difficulty = EXCLUDED.path_difficulty,
            simulated_at = NOW()
        RETURNING id
        """,
        (season, team_id, round_name, advancement_pct, n_simulations,
         model_version, leverage, path_difficulty),
    )


def get_simulation_results(db: DatabaseManager, season: int,
                           model_version: str = "") -> list[dict]:
    """Get simulation results with team info."""
    if model_version:
        return db.execute(
            """
            SELECT sr.*, t.name, t.conference, t.logo_url,
                   tb.seed, tb.region
            FROM simulation_results sr
            JOIN teams t ON t.team_id = sr.team_id
            LEFT JOIN tournament_bracket tb ON tb.team_id = sr.team_id AND tb.season = sr.season
            WHERE sr.season = %s AND sr.model_version = %s
            ORDER BY sr.advancement_pct DESC
            """,
            (season, model_version),
        )
    return db.execute(
        """
        SELECT sr.*, t.name, t.conference, t.logo_url,
               tb.seed, tb.region
        FROM simulation_results sr
        JOIN teams t ON t.team_id = sr.team_id
        LEFT JOIN tournament_bracket tb ON tb.team_id = sr.team_id AND tb.season = sr.season
        WHERE sr.season = %s
        ORDER BY sr.advancement_pct DESC
        """,
        (season,),
    )


# ── Public Picks ────────────────────────────────────────────

# ── DFS Slates ──────────────────────────────────────────────

def upsert_dk_slate(db: DatabaseManager, slate_date: str,
                    game_count: int = 0) -> int:
    """Insert or update a DFS slate, returning id."""
    return db.execute_insert(
        """
        INSERT INTO dk_slates (slate_date, game_count)
        VALUES (%s, %s)
        ON CONFLICT (slate_date) DO UPDATE SET
            game_count = GREATEST(dk_slates.game_count, EXCLUDED.game_count)
        RETURNING id
        """,
        (slate_date, game_count),
    )


def upsert_dk_player(
    db: DatabaseManager, slate_id: int, dk_player_id: int, name: str,
    team_abbrev: str, eligible_positions: str, salary: int,
    team_id: int = None, matchup_id: int = None, game_info: str = None,
    avg_fpts_dk: float = None, linestar_proj: float = None,
    proj_own_pct: float = None, our_proj: float = None,
    our_leverage: float = None,
) -> int:
    """Insert or update a DFS player row."""
    return db.execute_insert(
        """
        INSERT INTO dk_players (
            slate_id, dk_player_id, name, team_abbrev, eligible_positions,
            salary, team_id, matchup_id, game_info, avg_fpts_dk,
            linestar_proj, proj_own_pct, our_proj, our_leverage
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (slate_id, dk_player_id) DO UPDATE SET
            linestar_proj = COALESCE(EXCLUDED.linestar_proj, dk_players.linestar_proj),
            proj_own_pct = COALESCE(EXCLUDED.proj_own_pct, dk_players.proj_own_pct),
            our_proj = COALESCE(EXCLUDED.our_proj, dk_players.our_proj),
            our_leverage = COALESCE(EXCLUDED.our_leverage, dk_players.our_leverage),
            team_id = COALESCE(EXCLUDED.team_id, dk_players.team_id),
            matchup_id = COALESCE(EXCLUDED.matchup_id, dk_players.matchup_id)
        RETURNING id
        """,
        (slate_id, dk_player_id, name, team_abbrev, eligible_positions,
         salary, team_id, matchup_id, game_info, avg_fpts_dk,
         linestar_proj, proj_own_pct, our_proj, our_leverage),
    )


def get_dk_players(db: DatabaseManager, slate_id: int = None) -> list[dict]:
    """Get DFS player pool for a slate (most recent if not specified)."""
    if slate_id is None:
        slate_row = db.execute_one(
            "SELECT id FROM dk_slates ORDER BY slate_date DESC LIMIT 1"
        )
        if not slate_row:
            return []
        slate_id = slate_row["id"]
    return db.execute(
        """
        SELECT dp.*,
               t.name AS team_name, t.logo_url AS team_logo,
               bm.model_prob_a, bm.vegas_prob_a,
               bm.team_a_id AS matchup_team_a_id
        FROM dk_players dp
        LEFT JOIN teams t ON t.team_id = dp.team_id
        LEFT JOIN bracket_matchups bm ON bm.id = dp.matchup_id
        WHERE dp.slate_id = %s
        ORDER BY dp.our_leverage DESC NULLS LAST, dp.our_proj DESC NULLS LAST
        """,
        (slate_id,),
    )


# ── Public Picks ────────────────────────────────────────────

def upsert_public_pick(db: DatabaseManager, season: int, team_id: int,
                       round_name: str, pick_pct: float,
                       source: str = "espn") -> int:
    """Insert or update a public pick percentage."""
    return db.execute_insert(
        """
        INSERT INTO public_picks (season, team_id, round, pick_pct, source)
        VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT (season, team_id, round, source) DO UPDATE SET
            pick_pct = EXCLUDED.pick_pct,
            fetched_at = NOW()
        RETURNING id
        """,
        (season, team_id, round_name, pick_pct, source),
    )
