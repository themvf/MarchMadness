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

    # ── Player stats (from Torvik getadvstats) ───────────────
    """
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
    """,

    # ── Team profiles (player-derived features) ─────────────
    """
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
    """,

    # ── Bracket matchups (model vs Vegas per matchup) ────────
    """
    CREATE TABLE IF NOT EXISTS bracket_matchups (
        id SERIAL PRIMARY KEY,
        season INTEGER NOT NULL,
        round TEXT NOT NULL,
        region TEXT,
        matchup_slot INTEGER NOT NULL,
        team_a_id INTEGER NOT NULL REFERENCES teams(team_id),
        team_b_id INTEGER NOT NULL REFERENCES teams(team_id),
        seed_a INTEGER NOT NULL,
        seed_b INTEGER NOT NULL,
        model_prob_a DOUBLE PRECISION,
        log5_prob_a DOUBLE PRECISION,
        vegas_spread_a DOUBLE PRECISION,
        vegas_ml_a INTEGER,
        vegas_ml_b INTEGER,
        vegas_total DOUBLE PRECISION,
        vegas_prob_a DOUBLE PRECISION,
        winner_id INTEGER REFERENCES teams(team_id),
        score_a INTEGER,
        score_b INTEGER,
        game_date DATE,
        computed_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(season, round, matchup_slot)
    )
    """,

    # ── Team news (Google News RSS) ──────────────────────────
    """
    CREATE TABLE IF NOT EXISTS team_news (
        id SERIAL PRIMARY KEY,
        team_id INTEGER NOT NULL REFERENCES teams(team_id),
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        source TEXT DEFAULT '',
        published_at TIMESTAMPTZ,
        impact_score INTEGER DEFAULT 0,
        matched_keywords TEXT DEFAULT '',
        fetched_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(team_id, url)
    )
    """,

    # ── Odds snapshots (line movement tracking) ─────────────
    """
    CREATE TABLE IF NOT EXISTS odds_snapshots (
        id SERIAL PRIMARY KEY,
        matchup_id INTEGER NOT NULL REFERENCES bracket_matchups(id),
        spread_a DOUBLE PRECISION,
        ml_a INTEGER,
        ml_b INTEGER,
        total DOUBLE PRECISION,
        prob_a DOUBLE PRECISION,
        fetched_at TIMESTAMPTZ DEFAULT NOW()
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
    "CREATE INDEX IF NOT EXISTS idx_player_stats_team ON player_stats(team_id, season)",
    "CREATE INDEX IF NOT EXISTS idx_player_stats_player ON player_stats(player_id, season)",
    "CREATE INDEX IF NOT EXISTS idx_team_profiles_season ON team_profiles(team_id, season)",
    "CREATE INDEX IF NOT EXISTS idx_bracket_matchups_season ON bracket_matchups(season, round)",
    "CREATE INDEX IF NOT EXISTS idx_odds_snapshots_matchup ON odds_snapshots(matchup_id, fetched_at)",
    "CREATE INDEX IF NOT EXISTS idx_team_news_team ON team_news(team_id, published_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_team_news_impact ON team_news(impact_score DESC, published_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_teams_torvik ON teams(torvik_name)",
    "CREATE INDEX IF NOT EXISTS idx_teams_ncaa ON teams(ncaa_name)",
    "CREATE INDEX IF NOT EXISTS idx_teams_odds ON teams(odds_api_name)",
]
