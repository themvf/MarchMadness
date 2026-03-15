import { db } from ".";
import { teams, torvikRatings, tournamentBracket, simulationResults, games, vegasOdds, playerStats, teamProfiles, bracketMatchups } from "./schema";
import { eq, desc, asc, sql, and, or, gte } from "drizzle-orm";

const CURRENT_SEASON = 2026;

// ── Team Ratings ────────────────────────────────────────────

export async function getTeamRatings(season = CURRENT_SEASON) {
  return db
    .select({
      teamId: teams.teamId,
      name: teams.name,
      conference: teams.conference,
      logoUrl: teams.logoUrl,
      rank: torvikRatings.rank,
      adjOe: torvikRatings.adjOe,
      adjDe: torvikRatings.adjDe,
      adjEm: torvikRatings.adjEm,
      barthag: torvikRatings.barthag,
      adjTempo: torvikRatings.adjTempo,
      efg: torvikRatings.efg,
      efgD: torvikRatings.efgD,
      tov: torvikRatings.tov,
      orb: torvikRatings.orb,
      ftr: torvikRatings.ftr,
      wins: torvikRatings.wins,
      losses: torvikRatings.losses,
    })
    .from(torvikRatings)
    .innerJoin(teams, eq(teams.teamId, torvikRatings.teamId))
    .where(eq(torvikRatings.season, season))
    .orderBy(asc(torvikRatings.rank));
}

// ── Bracket ─────────────────────────────────────────────────

export async function getBracket(season = CURRENT_SEASON) {
  return db
    .select({
      teamId: teams.teamId,
      name: teams.name,
      conference: teams.conference,
      logoUrl: teams.logoUrl,
      seed: tournamentBracket.seed,
      region: tournamentBracket.region,
    })
    .from(tournamentBracket)
    .innerJoin(teams, eq(teams.teamId, tournamentBracket.teamId))
    .where(eq(tournamentBracket.season, season))
    .orderBy(asc(tournamentBracket.region), asc(tournamentBracket.seed));
}

// ── Simulation Results ──────────────────────────────────────

export type SimRow = {
  teamId: number;
  name: string;
  conference: string | null;
  seed: number | null;
  region: string | null;
  round: string;
  advancementPct: number;
};

export async function getSimulationResults(season = CURRENT_SEASON): Promise<SimRow[]> {
  return db
    .select({
      teamId: teams.teamId,
      name: teams.name,
      conference: teams.conference,
      seed: tournamentBracket.seed,
      region: tournamentBracket.region,
      round: simulationResults.round,
      advancementPct: simulationResults.advancementPct,
    })
    .from(simulationResults)
    .innerJoin(teams, eq(teams.teamId, simulationResults.teamId))
    .leftJoin(
      tournamentBracket,
      and(
        eq(tournamentBracket.teamId, simulationResults.teamId),
        eq(tournamentBracket.season, simulationResults.season)
      )
    )
    .where(eq(simulationResults.season, season))
    .orderBy(desc(simulationResults.advancementPct));
}

// ── Team Ratings with Profile Ranks ─────────────────────────

export type RatedTeam = {
  teamId: number;
  name: string;
  conference: string | null;
  logoUrl: string | null;
  rank: number | null;
  adjOe: number | null;
  adjDe: number | null;
  adjEm: number | null;
  barthag: number | null;
  adjTempo: number | null;
  efg: number | null;
  efgD: number | null;
  tov: number | null;
  orb: number | null;
  ftr: number | null;
  wins: number | null;
  losses: number | null;
  offRank: number;
  defRank: number;
  emRank: number;
  isChampionProfile: boolean;
};

export async function getTeamRatingsWithProfile(season = CURRENT_SEASON): Promise<RatedTeam[]> {
  const raw = await getTeamRatings(season);

  // Compute per-metric ranks
  const byOe = [...raw].sort((a, b) => (b.adjOe ?? 0) - (a.adjOe ?? 0));
  const byDe = [...raw].sort((a, b) => (a.adjDe ?? 999) - (b.adjDe ?? 999)); // lower is better
  const byEm = [...raw].sort((a, b) => (b.adjEm ?? 0) - (a.adjEm ?? 0));

  const oeRank = new Map(byOe.map((t, i) => [t.teamId, i + 1]));
  const deRank = new Map(byDe.map((t, i) => [t.teamId, i + 1]));
  const emRank = new Map(byEm.map((t, i) => [t.teamId, i + 1]));

  return raw.map((t) => {
    const offRank = oeRank.get(t.teamId)!;
    const defRank = deRank.get(t.teamId)!;
    const emR = emRank.get(t.teamId)!;
    return {
      ...t,
      offRank,
      defRank,
      emRank: emR,
      isChampionProfile: offRank <= 20 && defRank <= 20 && emR <= 15,
    };
  });
}

// ── Matchup Data ────────────────────────────────────────────

export type MatchupTeam = {
  teamId: number;
  name: string;
  conference: string | null;
  logoUrl: string | null;
  adjOe: number | null;
  adjDe: number | null;
  adjEm: number | null;
  barthag: number | null;
  adjTempo: number | null;
  rank: number | null;
};

export async function getMatchupTeams(season = CURRENT_SEASON): Promise<MatchupTeam[]> {
  return db
    .select({
      teamId: teams.teamId,
      name: teams.name,
      conference: teams.conference,
      logoUrl: teams.logoUrl,
      adjOe: torvikRatings.adjOe,
      adjDe: torvikRatings.adjDe,
      adjEm: torvikRatings.adjEm,
      barthag: torvikRatings.barthag,
      adjTempo: torvikRatings.adjTempo,
      rank: torvikRatings.rank,
    })
    .from(torvikRatings)
    .innerJoin(teams, eq(teams.teamId, torvikRatings.teamId))
    .where(eq(torvikRatings.season, season))
    .orderBy(asc(torvikRatings.rank));
}

// ── Dashboard Stats ─────────────────────────────────────────

export async function getDashboardStats(season = CURRENT_SEASON) {
  const [teamCount, gameCount, bracketCount, simCount] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(torvikRatings).where(eq(torvikRatings.season, season)),
    db.select({ count: sql<number>`count(*)` }).from(games).where(eq(games.season, season)),
    db.select({ count: sql<number>`count(*)` }).from(tournamentBracket).where(eq(tournamentBracket.season, season)),
    db.select({ count: sql<number>`count(distinct ${simulationResults.teamId})` }).from(simulationResults).where(eq(simulationResults.season, season)),
  ]);

  return {
    teams: teamCount[0].count,
    games: gameCount[0].count,
    bracketTeams: bracketCount[0].count,
    simulatedTeams: simCount[0].count,
  };
}

// ── Season Games (for Power Rankings) ───────────────────────

export type SeasonGameRow = {
  gameId: string;
  homeTeamId: number | null;
  awayTeamId: number | null;
  homeScore: number | null;
  awayScore: number | null;
  isNeutralSite: boolean | null;
};

export async function getSeasonGames(season = CURRENT_SEASON): Promise<SeasonGameRow[]> {
  return db
    .select({
      gameId: games.gameId,
      homeTeamId: games.homeTeamId,
      awayTeamId: games.awayTeamId,
      homeScore: games.homeScore,
      awayScore: games.awayScore,
      isNeutralSite: games.isNeutralSite,
    })
    .from(games)
    .where(eq(games.season, season));
}

// ── Head-to-Head Games ──────────────────────────────────────

export type HeadToHeadGameRow = {
  gameId: string;
  season: number;
  gameDate: string;
  homeTeamId: number | null;
  awayTeamId: number | null;
  homeScore: number | null;
  awayScore: number | null;
  isNeutralSite: boolean | null;
  isTournament: boolean | null;
  tournamentRound: string | null;
  spread: number | null;
  total: number | null;
  homeMl: number | null;
  awayMl: number | null;
  impliedHomeProb: number | null;
};

export async function getHeadToHeadGames(
  teamAId: number,
  teamBId: number,
  season?: number
): Promise<HeadToHeadGameRow[]> {
  const matchCondition = or(
    and(eq(games.homeTeamId, teamAId), eq(games.awayTeamId, teamBId)),
    and(eq(games.homeTeamId, teamBId), eq(games.awayTeamId, teamAId))
  )!;

  const whereClause = season
    ? and(matchCondition, eq(games.season, season))
    : matchCondition;

  return db
    .select({
      gameId: games.gameId,
      season: games.season,
      gameDate: games.gameDate,
      homeTeamId: games.homeTeamId,
      awayTeamId: games.awayTeamId,
      homeScore: games.homeScore,
      awayScore: games.awayScore,
      isNeutralSite: games.isNeutralSite,
      isTournament: games.isTournament,
      tournamentRound: games.tournamentRound,
      spread: vegasOdds.spread,
      total: vegasOdds.total,
      homeMl: vegasOdds.homeMl,
      awayMl: vegasOdds.awayMl,
      impliedHomeProb: vegasOdds.impliedHomeProb,
    })
    .from(games)
    .leftJoin(
      vegasOdds,
      and(
        eq(vegasOdds.gameId, games.gameId),
        eq(vegasOdds.bookmaker, "consensus")
      )
    )
    .where(whereClause)
    .orderBy(desc(games.gameDate));
}

// ── Player Stats ──────────────────────────────────────────

export type PlayerStatRow = {
  playerId: number;
  name: string;
  teamId: number;
  teamName: string;
  conference: string | null;
  logoUrl: string | null;
  class: string | null;
  height: string | null;
  position: string | null;
  games: number | null;
  minPct: number | null;
  ppg: number | null;
  rpg: number | null;
  apg: number | null;
  ortg: number | null;
  usageRate: number | null;
  efg: number | null;
  tsPct: number | null;
  orbPct: number | null;
  drbPct: number | null;
  astPct: number | null;
  tovPct: number | null;
  blkPct: number | null;
  stlPct: number | null;
  ftPct: number | null;
  threefgPct: number | null;
  twofgPct: number | null;
  ftr: number | null;
  obpm: number | null;
  drtg: number | null;
};

export async function getPlayerStats(
  season = CURRENT_SEASON,
  minMinPct = 0
): Promise<PlayerStatRow[]> {
  const conditions = [eq(playerStats.season, season)];
  if (minMinPct > 0) {
    conditions.push(gte(playerStats.minPct, minMinPct));
  }

  return db
    .select({
      playerId: playerStats.playerId,
      name: playerStats.name,
      teamId: playerStats.teamId,
      teamName: teams.name,
      conference: teams.conference,
      logoUrl: teams.logoUrl,
      class: playerStats.class,
      height: playerStats.height,
      position: playerStats.position,
      games: playerStats.games,
      minPct: playerStats.minPct,
      ppg: playerStats.ppg,
      rpg: playerStats.rpg,
      apg: playerStats.apg,
      ortg: playerStats.ortg,
      usageRate: playerStats.usageRate,
      efg: playerStats.efg,
      tsPct: playerStats.tsPct,
      orbPct: playerStats.orbPct,
      drbPct: playerStats.drbPct,
      astPct: playerStats.astPct,
      tovPct: playerStats.tovPct,
      blkPct: playerStats.blkPct,
      stlPct: playerStats.stlPct,
      ftPct: playerStats.ftPct,
      threefgPct: playerStats.threefgPct,
      twofgPct: playerStats.twofgPct,
      ftr: playerStats.ftr,
      obpm: playerStats.obpm,
      drtg: playerStats.drtg,
    })
    .from(playerStats)
    .innerJoin(teams, eq(teams.teamId, playerStats.teamId))
    .where(and(...conditions))
    .orderBy(desc(playerStats.ppg));
}

export async function getTeamPlayerStats(
  teamId: number,
  season = CURRENT_SEASON
): Promise<PlayerStatRow[]> {
  return db
    .select({
      playerId: playerStats.playerId,
      name: playerStats.name,
      teamId: playerStats.teamId,
      teamName: teams.name,
      conference: teams.conference,
      logoUrl: teams.logoUrl,
      class: playerStats.class,
      height: playerStats.height,
      position: playerStats.position,
      games: playerStats.games,
      minPct: playerStats.minPct,
      ppg: playerStats.ppg,
      rpg: playerStats.rpg,
      apg: playerStats.apg,
      ortg: playerStats.ortg,
      usageRate: playerStats.usageRate,
      efg: playerStats.efg,
      tsPct: playerStats.tsPct,
      orbPct: playerStats.orbPct,
      drbPct: playerStats.drbPct,
      astPct: playerStats.astPct,
      tovPct: playerStats.tovPct,
      blkPct: playerStats.blkPct,
      stlPct: playerStats.stlPct,
      ftPct: playerStats.ftPct,
      threefgPct: playerStats.threefgPct,
      twofgPct: playerStats.twofgPct,
      ftr: playerStats.ftr,
      obpm: playerStats.obpm,
      drtg: playerStats.drtg,
    })
    .from(playerStats)
    .innerJoin(teams, eq(teams.teamId, playerStats.teamId))
    .where(and(eq(playerStats.teamId, teamId), eq(playerStats.season, season)))
    .orderBy(desc(playerStats.minPct));
}

// ── Team Profiles (player-derived features) ───────────────

export type TeamProfileRow = {
  teamId: number;
  experienceIdx: number | null;
  starConcentration: number | null;
  depthGap: number | null;
  ftReliability: number | null;
  threePtRate: number | null;
  tovDiscipline: number | null;
  scoringBalance: number | null;
  guardQuality: number | null;
  freshmanMinutesPct: number | null;
  reboundConcentration: number | null;
};

export async function getTeamProfiles(
  season = CURRENT_SEASON
): Promise<Map<number, TeamProfileRow>> {
  const rows = await db
    .select({
      teamId: teamProfiles.teamId,
      experienceIdx: teamProfiles.experienceIdx,
      starConcentration: teamProfiles.starConcentration,
      depthGap: teamProfiles.depthGap,
      ftReliability: teamProfiles.ftReliability,
      threePtRate: teamProfiles.threePtRate,
      tovDiscipline: teamProfiles.tovDiscipline,
      scoringBalance: teamProfiles.scoringBalance,
      guardQuality: teamProfiles.guardQuality,
      freshmanMinutesPct: teamProfiles.freshmanMinutesPct,
      reboundConcentration: teamProfiles.reboundConcentration,
    })
    .from(teamProfiles)
    .where(eq(teamProfiles.season, season));

  const map = new Map<number, TeamProfileRow>();
  for (const row of rows) {
    map.set(row.teamId, row);
  }
  return map;
}

// ── Divergence (Model vs Vegas) ─────────────────────────────

export type DivergenceRow = {
  gameId: string;
  gameDate: string;
  homeTeamId: number | null;
  awayTeamId: number | null;
  homeName: string | null;
  awayName: string | null;
  homeLogoUrl: string | null;
  awayLogoUrl: string | null;
  homeScore: number | null;
  awayScore: number | null;
  homeRank: number | null;
  awayRank: number | null;
  homeBarthag: number | null;
  awayBarthag: number | null;
  isNeutralSite: boolean | null;
  spread: number | null;
  vegasProb: number | null;
};

export async function getGamesWithOdds(season = CURRENT_SEASON): Promise<DivergenceRow[]> {
  const result = await db.execute<DivergenceRow>(sql`
    SELECT
      g.game_id as "gameId",
      g.game_date as "gameDate",
      g.home_team_id as "homeTeamId",
      g.away_team_id as "awayTeamId",
      t1.name as "homeName",
      t2.name as "awayName",
      t1.logo_url as "homeLogoUrl",
      t2.logo_url as "awayLogoUrl",
      g.home_score as "homeScore",
      g.away_score as "awayScore",
      tr1.rank as "homeRank",
      tr2.rank as "awayRank",
      tr1.barthag as "homeBarthag",
      tr2.barthag as "awayBarthag",
      g.is_neutral_site as "isNeutralSite",
      vo.spread,
      vo.implied_home_prob as "vegasProb"
    FROM games g
    INNER JOIN vegas_odds vo ON vo.game_id = g.game_id AND vo.bookmaker = 'consensus'
    INNER JOIN torvik_ratings tr1 ON tr1.team_id = g.home_team_id AND tr1.season = g.season
    INNER JOIN torvik_ratings tr2 ON tr2.team_id = g.away_team_id AND tr2.season = g.season
    INNER JOIN teams t1 ON t1.team_id = g.home_team_id
    INNER JOIN teams t2 ON t2.team_id = g.away_team_id
    WHERE g.season = ${season}
    ORDER BY g.game_date DESC
  `);
  return result.rows;
}

// ── Bracket Matchups (Model vs Vegas) ─────────────────────

export type BracketMatchupRow = {
  id: number;
  round: string;
  region: string | null;
  matchupSlot: number;
  teamAId: number;
  teamAName: string;
  teamALogo: string | null;
  teamAConf: string | null;
  seedA: number;
  teamBId: number;
  teamBName: string;
  teamBLogo: string | null;
  teamBConf: string | null;
  seedB: number;
  modelProbA: number | null;
  log5ProbA: number | null;
  vegasSpreadA: number | null;
  vegasProbA: number | null;
  vegasMlA: number | null;
  vegasMlB: number | null;
  vegasTotal: number | null;
  winnerId: number | null;
  scoreA: number | null;
  scoreB: number | null;
  gameDate: string | null;
};

export async function getBracketMatchups(
  season = CURRENT_SEASON,
  round?: string
): Promise<BracketMatchupRow[]> {
  const roundFilter = round
    ? sql`AND bm.round = ${round}`
    : sql``;

  const result = await db.execute<BracketMatchupRow>(sql`
    SELECT
      bm.id,
      bm.round,
      bm.region,
      bm.matchup_slot as "matchupSlot",
      bm.team_a_id as "teamAId",
      ta.name as "teamAName",
      ta.logo_url as "teamALogo",
      ta.conference as "teamAConf",
      bm.seed_a as "seedA",
      bm.team_b_id as "teamBId",
      tb.name as "teamBName",
      tb.logo_url as "teamBLogo",
      tb.conference as "teamBConf",
      bm.seed_b as "seedB",
      bm.model_prob_a as "modelProbA",
      bm.log5_prob_a as "log5ProbA",
      bm.vegas_spread_a as "vegasSpreadA",
      bm.vegas_prob_a as "vegasProbA",
      bm.vegas_ml_a as "vegasMlA",
      bm.vegas_ml_b as "vegasMlB",
      bm.vegas_total as "vegasTotal",
      bm.winner_id as "winnerId",
      bm.score_a as "scoreA",
      bm.score_b as "scoreB",
      bm.game_date as "gameDate"
    FROM bracket_matchups bm
    INNER JOIN teams ta ON ta.team_id = bm.team_a_id
    INNER JOIN teams tb ON tb.team_id = bm.team_b_id
    WHERE bm.season = ${season}
    ${roundFilter}
    ORDER BY bm.round, bm.matchup_slot
  `);
  return result.rows;
}

// ── War Room (Efficiency Scatter) ─────────────────────────

export type WarRoomTeam = {
  teamId: number;
  name: string;
  conference: string | null;
  logoUrl: string | null;
  rank: number | null;
  adjOe: number | null;
  adjDe: number | null;
  adjEm: number | null;
  barthag: number | null;
  adjTempo: number | null;
  wins: number | null;
  losses: number | null;
  seed: number | null;
  region: string | null;
};

export async function getWarRoomData(season = CURRENT_SEASON): Promise<WarRoomTeam[]> {
  const result = await db.execute<WarRoomTeam>(sql`
    SELECT
      t.team_id as "teamId",
      t.name,
      t.conference,
      t.logo_url as "logoUrl",
      tr.rank,
      tr.adj_oe as "adjOe",
      tr.adj_de as "adjDe",
      tr.adj_em as "adjEm",
      tr.barthag,
      tr.adj_tempo as "adjTempo",
      tr.wins,
      tr.losses,
      tb.seed,
      tb.region
    FROM torvik_ratings tr
    INNER JOIN teams t ON t.team_id = tr.team_id
    LEFT JOIN tournament_bracket tb
      ON tb.team_id = tr.team_id AND tb.season = tr.season
    WHERE tr.season = ${season}
    ORDER BY tr.rank
  `);
  return result.rows;
}
