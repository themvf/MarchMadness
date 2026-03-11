import {
  pgTable,
  serial,
  text,
  integer,
  doublePrecision,
  boolean,
  date,
  timestamp,
  unique,
  index,
} from "drizzle-orm/pg-core";

export const teams = pgTable("teams", {
  teamId: serial("team_id").primaryKey(),
  name: text("name").notNull().unique(),
  conference: text("conference").default(""),
  torvikName: text("torvik_name").default(""),
  ncaaName: text("ncaa_name").default(""),
  oddsApiName: text("odds_api_name").default(""),
  shortName: text("short_name").default(""),
  logoUrl: text("logo_url").default(""),
  createdAt: timestamp("created_at").defaultNow(),
});

export const torvikRatings = pgTable(
  "torvik_ratings",
  {
    id: serial("id").primaryKey(),
    teamId: integer("team_id")
      .notNull()
      .references(() => teams.teamId),
    season: integer("season").notNull(),
    rank: integer("rank"),
    adjOe: doublePrecision("adj_oe"),
    adjDe: doublePrecision("adj_de"),
    adjEm: doublePrecision("adj_em"),
    barthag: doublePrecision("barthag"),
    adjTempo: doublePrecision("adj_tempo"),
    efg: doublePrecision("efg"),
    efgD: doublePrecision("efg_d"),
    tov: doublePrecision("tov"),
    tovD: doublePrecision("tov_d"),
    orb: doublePrecision("orb"),
    drb: doublePrecision("drb"),
    ftr: doublePrecision("ftr"),
    ftrD: doublePrecision("ftr_d"),
    twoPt: doublePrecision("two_pt"),
    twoPtD: doublePrecision("two_pt_d"),
    threePt: doublePrecision("three_pt"),
    threePtD: doublePrecision("three_pt_d"),
    wins: integer("wins").default(0),
    losses: integer("losses").default(0),
    fetchedAt: timestamp("fetched_at").defaultNow(),
  },
  (t) => [unique("torvik_ratings_team_id_season_key").on(t.teamId, t.season)]
);

export const games = pgTable("games", {
  gameId: text("game_id").primaryKey(),
  season: integer("season").notNull(),
  gameDate: date("game_date").notNull(),
  homeTeamId: integer("home_team_id").references(() => teams.teamId),
  awayTeamId: integer("away_team_id").references(() => teams.teamId),
  homeScore: integer("home_score"),
  awayScore: integer("away_score"),
  isNeutralSite: boolean("is_neutral_site").default(false),
  isTournament: boolean("is_tournament").default(false),
  tournamentRound: text("tournament_round"),
  fetchedAt: timestamp("fetched_at").defaultNow(),
});

export const vegasOdds = pgTable(
  "vegas_odds",
  {
    id: serial("id").primaryKey(),
    gameId: text("game_id")
      .notNull()
      .references(() => games.gameId),
    spread: doublePrecision("spread"),
    total: doublePrecision("total"),
    homeMl: integer("home_ml"),
    awayMl: integer("away_ml"),
    impliedHomeProb: doublePrecision("implied_home_prob"),
    bookmaker: text("bookmaker").default("consensus"),
    fetchedAt: timestamp("fetched_at").defaultNow(),
  },
  (t) => [unique("vegas_odds_game_id_bookmaker_key").on(t.gameId, t.bookmaker)]
);

export const tournamentBracket = pgTable(
  "tournament_bracket",
  {
    id: serial("id").primaryKey(),
    season: integer("season").notNull(),
    teamId: integer("team_id")
      .notNull()
      .references(() => teams.teamId),
    seed: integer("seed").notNull(),
    region: text("region").notNull(),
    bracketPosition: integer("bracket_position"),
  },
  (t) => [unique("tournament_bracket_season_team_id_key").on(t.season, t.teamId)]
);

export const simulationResults = pgTable(
  "simulation_results",
  {
    id: serial("id").primaryKey(),
    season: integer("season").notNull(),
    teamId: integer("team_id")
      .notNull()
      .references(() => teams.teamId),
    round: text("round").notNull(),
    advancementPct: doublePrecision("advancement_pct").notNull(),
    leverage: doublePrecision("leverage"),
    nSimulations: integer("n_simulations").notNull(),
    modelVersion: text("model_version").default(""),
    pathDifficulty: doublePrecision("path_difficulty"),
    simulatedAt: timestamp("simulated_at").defaultNow(),
  },
  (t) => [
    unique("simulation_results_season_team_round_ver_key").on(
      t.season,
      t.teamId,
      t.round,
      t.modelVersion
    ),
  ]
);

export const playerStats = pgTable(
  "player_stats",
  {
    id: serial("id").primaryKey(),
    playerId: integer("player_id").notNull(),
    season: integer("season").notNull(),
    teamId: integer("team_id")
      .notNull()
      .references(() => teams.teamId),
    name: text("name").notNull(),
    class: text("class"),
    height: text("height"),
    position: text("position"),
    number: integer("number"),
    games: integer("games"),
    minPct: doublePrecision("min_pct"),
    ortg: doublePrecision("ortg"),
    usageRate: doublePrecision("usage_rate"),
    efg: doublePrecision("efg"),
    tsPct: doublePrecision("ts_pct"),
    orbPct: doublePrecision("orb_pct"),
    drbPct: doublePrecision("drb_pct"),
    astPct: doublePrecision("ast_pct"),
    tovPct: doublePrecision("tov_pct"),
    ftm: integer("ftm"),
    fta: integer("fta"),
    ftPct: doublePrecision("ft_pct"),
    twofgm: integer("twofgm"),
    twofga: integer("twofga"),
    twofgPct: doublePrecision("twofg_pct"),
    threefgm: integer("threefgm"),
    threefga: integer("threefga"),
    threefgPct: doublePrecision("threefg_pct"),
    blkPct: doublePrecision("blk_pct"),
    stlPct: doublePrecision("stl_pct"),
    ftr: doublePrecision("ftr"),
    obpm: doublePrecision("obpm"),
    drtg: doublePrecision("drtg"),
    ppg: doublePrecision("ppg"),
    rpg: doublePrecision("rpg"),
    apg: doublePrecision("apg"),
    hometown: text("hometown"),
    birthdate: text("birthdate"),
    fetchedAt: timestamp("fetched_at").defaultNow(),
  },
  (t) => [unique("player_stats_player_id_season_key").on(t.playerId, t.season)]
);

export const teamProfiles = pgTable(
  "team_profiles",
  {
    id: serial("id").primaryKey(),
    teamId: integer("team_id")
      .notNull()
      .references(() => teams.teamId),
    season: integer("season").notNull(),
    experienceIdx: doublePrecision("experience_idx"),
    starConcentration: doublePrecision("star_concentration"),
    depthGap: doublePrecision("depth_gap"),
    ftReliability: doublePrecision("ft_reliability"),
    threePtRate: doublePrecision("three_pt_rate"),
    tovDiscipline: doublePrecision("tov_discipline"),
    scoringBalance: integer("scoring_balance"),
    guardQuality: doublePrecision("guard_quality"),
    freshmanMinutesPct: doublePrecision("freshman_minutes_pct"),
    reboundConcentration: doublePrecision("rebound_concentration"),
    computedAt: timestamp("computed_at").defaultNow(),
  },
  (t) => [unique("team_profiles_team_id_season_key").on(t.teamId, t.season)]
);

// Type inference
export type Team = typeof teams.$inferSelect;
export type TorvikRating = typeof torvikRatings.$inferSelect;
export type Game = typeof games.$inferSelect;
export type TournamentBracketEntry = typeof tournamentBracket.$inferSelect;
export type SimulationResult = typeof simulationResults.$inferSelect;
export type PlayerStat = typeof playerStats.$inferSelect;
export type TeamProfile = typeof teamProfiles.$inferSelect;
