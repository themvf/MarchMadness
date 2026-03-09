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

// Type inference
export type Team = typeof teams.$inferSelect;
export type TorvikRating = typeof torvikRatings.$inferSelect;
export type Game = typeof games.$inferSelect;
export type TournamentBracketEntry = typeof tournamentBracket.$inferSelect;
export type SimulationResult = typeof simulationResults.$inferSelect;
