"""PostgreSQL schema for March Madness Strategy.

All tables use Neon PostgreSQL. The `teams` table serves as the central
mapping matrix — each team has a unique team_id and separate name columns
for each data source (Torvik, NCAA API, Odds API) to handle cross-source
name normalization.
"""

TABLES = [
    # ── Teams mapping matrix ─────────────────────────────────
    """
    CREATE TABLE IF NOT EXISTS teams (
        team_id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        conference TEXT DEFAULT '',
        torvik_name TEXT DEFAULT '',
        ncaa_name TEXT DEFAULT '',
        odds_api_name TEXT DEFAULT '',
        short_name TEXT DEFAULT '',
        logo_url TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW()
    )
    """,

    # ── Torvik efficiency ratings ────────────────────────────
    """
    CREATE TABLE IF NOT EXISTS torvik_ratings (
        id SERIAL PRIMARY KEY,
        team_id INTEGER NOT NULL REFERENCES teams(team_id),
        season INTEGER NOT NULL,
        rank INTEGER,
        adj_oe DOUBLE PRECISION,
        adj_de DOUBLE PRECISION,
        adj_em DOUBLE PRECISION,
        barthag DOUBLE PRECISION,
        adj_tempo DOUBLE PRECISION,
        efg DOUBLE PRECISION,
        efg_d DOUBLE PRECISION,
        tov DOUBLE PRECISION,
        tov_d DOUBLE PRECISION,
        orb DOUBLE PRECISION,
        drb DOUBLE PRECISION,
        ftr DOUBLE PRECISION,
        ftr_d DOUBLE PRECISION,
        two_pt DOUBLE PRECISION,
        two_pt_d DOUBLE PRECISION,
        three_pt DOUBLE PRECISION,
        three_pt_d DOUBLE PRECISION,
        wins INTEGER DEFAULT 0,
        losses INTEGER DEFAULT 0,
        fetched_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(team_id, season)
    )
    """,

    # ── Historical games ─────────────────────────────────────
    """
    CREATE TABLE IF NOT EXISTS games (
        game_id TEXT PRIMARY KEY,
        season INTEGER NOT NULL,
        game_date DATE NOT NULL,
        home_team_id INTEGER REFERENCES teams(team_id),
        away_team_id INTEGER REFERENCES teams(team_id),
        home_score INTEGER,
        away_score INTEGER,
        is_neutral_site BOOLEAN DEFAULT FALSE,
        is_tournament BOOLEAN DEFAULT FALSE,
        tournament_round TEXT,
        fetched_at TIMESTAMPTZ DEFAULT NOW()
    )
    """,

    # ── Vegas odds ───────────────────────────────────────────
    """
    CREATE TABLE IF NOT EXISTS vegas_odds (
        id SERIAL PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(game_id),
        spread DOUBLE PRECISION,
        total DOUBLE PRECISION,
        home_ml INTEGER,
        away_ml INTEGER,
        implied_home_prob DOUBLE PRECISION,
        bookmaker TEXT DEFAULT 'consensus',
        fetched_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(game_id, bookmaker)
    )
    """,

    # ── Tournament bracket ───────────────────────────────────
    """
    CREATE TABLE IF NOT EXISTS tournament_bracket (
        id SERIAL PRIMARY KEY,
        season INTEGER NOT NULL,
        team_id INTEGER NOT NULL REFERENCES teams(team_id),
        seed INTEGER NOT NULL,
        region TEXT NOT NULL,
        bracket_position INTEGER,
        UNIQUE(season, team_id)
    )
    """,

    # ── ESPN / public pick rates ─────────────────────────────
    """
    CREATE TABLE IF NOT EXISTS public_picks (
        id SERIAL PRIMARY KEY,
        season INTEGER NOT NULL,
        team_id INTEGER NOT NULL REFERENCES teams(team_id),
        round TEXT NOT NULL,
        pick_pct DOUBLE PRECISION NOT NULL,
        source TEXT DEFAULT 'espn',
        fetched_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(season, team_id, round, source)
    )
    """,

    # ── Monte Carlo simulation results ───────────────────────
    """
    CREATE TABLE IF NOT EXISTS simulation_results (
        id SERIAL PRIMARY KEY,
        season INTEGER NOT NULL,
        team_id INTEGER NOT NULL REFERENCES teams(team_id),
        round TEXT NOT NULL,
        advancement_pct DOUBLE PRECISION NOT NULL,
        leverage DOUBLE PRECISION,
        n_simulations INTEGER NOT NULL,
        model_version TEXT DEFAULT '',
        path_difficulty DOUBLE PRECISION,
        simulated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(season, team_id, round, model_version)
    )
    """,
]

INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_torvik_team_season ON torvik_ratings(team_id, season)",
    "CREATE INDEX IF NOT EXISTS idx_games_date ON games(game_date)",
    "CREATE INDEX IF NOT EXISTS idx_games_season ON games(season)",
    "CREATE INDEX IF NOT EXISTS idx_games_home ON games(home_team_id)",
    "CREATE INDEX IF NOT EXISTS idx_games_away ON games(away_team_id)",
    "CREATE INDEX IF NOT EXISTS idx_games_tournament ON games(is_tournament, tournament_round)",
    "CREATE INDEX IF NOT EXISTS idx_vegas_game ON vegas_odds(game_id)",
    "CREATE INDEX IF NOT EXISTS idx_bracket_season ON tournament_bracket(season, region)",
    "CREATE INDEX IF NOT EXISTS idx_picks_season ON public_picks(season, team_id)",
    "CREATE INDEX IF NOT EXISTS idx_sim_season ON simulation_results(season, team_id)",
    "CREATE INDEX IF NOT EXISTS idx_teams_torvik ON teams(torvik_name)",
    "CREATE INDEX IF NOT EXISTS idx_teams_ncaa ON teams(ncaa_name)",
    "CREATE INDEX IF NOT EXISTS idx_teams_odds ON teams(odds_api_name)",
]
