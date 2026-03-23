import { db } from ".";
import { teams, torvikRatings, tournamentBracket, simulationResults, games, vegasOdds, playerStats, teamProfiles, bracketMatchups, publicPicks, oddsSnapshots, dkSlates, dkPlayers, dkLineups } from "./schema";
import { eq, desc, asc, sql, and, or, gte, isNull } from "drizzle-orm";

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

// ── Team News (Google News RSS) ─────────────────────────────

export type TeamNewsRow = {
  id: number;
  teamId: number;
  title: string;
  url: string;
  source: string | null;
  publishedAt: Date | null;
  impactScore: number | null;
  matchedKeywords: string | null;
};

export async function getTeamNews(
  teamIds: number[],
  minScore = 10,
  hoursBack = 48
): Promise<Map<number, TeamNewsRow[]>> {
  if (teamIds.length === 0) return new Map();

  const result = await db.execute<TeamNewsRow>(sql`
    SELECT
      id,
      team_id as "teamId",
      title,
      url,
      source,
      published_at as "publishedAt",
      impact_score as "impactScore",
      matched_keywords as "matchedKeywords"
    FROM team_news
    WHERE team_id IN ${sql`(${sql.join(teamIds.map(id => sql`${id}`), sql`, `)})`}
      AND impact_score >= ${minScore}
      AND published_at >= NOW() - INTERVAL '${sql.raw(String(hoursBack))} hours'
    ORDER BY impact_score DESC, published_at DESC
  `);

  const map = new Map<number, TeamNewsRow[]>();
  for (const row of result.rows) {
    const existing = map.get(row.teamId) ?? [];
    existing.push(row);
    map.set(row.teamId, existing);
  }
  return map;
}

// ── Odds Snapshots (Line Movement) ──────────────────────────

export type OddsSnapshotRow = {
  matchupId: number;
  spreadA: number | null;
  mlA: number | null;
  mlB: number | null;
  total: number | null;
  probA: number | null;
  fetchedAt: Date | null;
};

export async function getOddsSnapshots(
  matchupIds: number[]
): Promise<Map<number, OddsSnapshotRow[]>> {
  if (matchupIds.length === 0) return new Map();

  const result = await db.execute<OddsSnapshotRow>(sql`
    SELECT
      matchup_id as "matchupId",
      spread_a as "spreadA",
      ml_a as "mlA",
      ml_b as "mlB",
      total,
      prob_a as "probA",
      fetched_at as "fetchedAt"
    FROM odds_snapshots
    WHERE matchup_id IN ${sql`(${sql.join(matchupIds.map(id => sql`${id}`), sql`, `)})`}
    ORDER BY matchup_id, fetched_at
  `);

  const map = new Map<number, OddsSnapshotRow[]>();
  for (const row of result.rows) {
    const existing = map.get(row.matchupId) ?? [];
    existing.push(row);
    map.set(row.matchupId, existing);
  }
  return map;
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

// ── Chalk vs Chaos (Public Picks vs Model) ────────────────

export type ChalkChaosRow = {
  teamId: number;
  name: string;
  conference: string | null;
  logoUrl: string | null;
  seed: number;
  region: string;
  round: string;
  pickPct: number;
  modelPct: number;
  divergence: number;
};

export async function getChalkChaosData(season = CURRENT_SEASON): Promise<ChalkChaosRow[]> {
  const result = await db.execute<ChalkChaosRow>(sql`
    SELECT
      t.team_id as "teamId",
      t.name,
      t.conference,
      t.logo_url as "logoUrl",
      tb.seed,
      tb.region,
      pp.round,
      pp.pick_pct as "pickPct",
      sr.advancement_pct as "modelPct",
      (sr.advancement_pct - pp.pick_pct) as "divergence"
    FROM public_picks pp
    INNER JOIN teams t ON t.team_id = pp.team_id
    INNER JOIN tournament_bracket tb
      ON tb.team_id = pp.team_id AND tb.season = pp.season
    INNER JOIN simulation_results sr
      ON sr.team_id = pp.team_id
      AND sr.season = pp.season
      AND sr.round = pp.round
      AND sr.model_version = (
        SELECT model_version FROM simulation_results
        WHERE season = pp.season
        ORDER BY simulated_at DESC
        LIMIT 1
      )
    WHERE pp.season = ${season}
      AND pp.source = 'espn'
    ORDER BY abs(sr.advancement_pct - pp.pick_pct) DESC
  `);
  return result.rows;
}

// ── Bracket Builder (composite) ──────────────────────────────

export type BracketBuilderTeam = {
  teamId: number;
  name: string;
  seed: number;
  region: string;
  conference: string | null;
  logoUrl: string | null;
  barthag: number | null;
  adjOe: number | null;
  adjDe: number | null;
  adjEm: number | null;
  adjTempo: number | null;
  rank: number | null;
  wins: number | null;
  losses: number | null;
};

export type SimAdvancement = {
  teamId: number;
  round: string;
  advancementPct: number;
};

export type TopPlayer = {
  teamId: number;
  name: string;
  position: string | null;
  ppg: number | null;
  rpg: number | null;
  apg: number | null;
  efg: number | null;
  usageRate: number | null;
};

export async function getBracketBuilderData(season = CURRENT_SEASON) {
  // Tournament teams with ratings
  const teamsResult = await db.execute<BracketBuilderTeam>(sql`
    SELECT
      t.team_id as "teamId", t.name, tb.seed, tb.region,
      t.conference, t.logo_url as "logoUrl",
      tr.barthag, tr.adj_oe as "adjOe", tr.adj_de as "adjDe",
      tr.adj_em as "adjEm", tr.adj_tempo as "adjTempo",
      tr.rank, tr.wins, tr.losses
    FROM tournament_bracket tb
    INNER JOIN teams t ON t.team_id = tb.team_id
    LEFT JOIN torvik_ratings tr ON tr.team_id = tb.team_id AND tr.season = tb.season
    WHERE tb.season = ${season}
    ORDER BY tb.region, tb.seed
  `);

  // R64 matchups with model predictions (if generated)
  const matchups = await getBracketMatchups(season);

  // Simulation advancement probabilities
  const simResult = await db.execute<SimAdvancement>(sql`
    SELECT team_id as "teamId", round, advancement_pct as "advancementPct"
    FROM simulation_results
    WHERE season = ${season}
    ORDER BY team_id, round
  `);

  // Top players per tournament team (by minutes)
  const playersResult = await db.execute<TopPlayer>(sql`
    SELECT
      ps.team_id as "teamId", ps.name, ps.position,
      ps.ppg, ps.rpg, ps.apg, ps.efg, ps.usage_rate as "usageRate"
    FROM player_stats ps
    INNER JOIN tournament_bracket tb ON tb.team_id = ps.team_id AND tb.season = ps.season
    WHERE ps.season = ${season} AND ps.min_pct >= 20
    ORDER BY ps.team_id, ps.min_pct DESC
  `);

  // Team profiles (for archetypes)
  const profiles = await getTeamProfiles(season);

  return {
    teams: teamsResult.rows,
    matchups,
    simResults: simResult.rows,
    players: playersResult.rows,
    profiles,
  };
}

// ── DFS Player Pool ────────────────────────────────────────

export type DkPlayerRow = {
  id: number;
  slateId: number;
  dkPlayerId: number;
  name: string;
  teamAbbrev: string;
  teamId: number | null;
  matchupId: number | null;
  eligiblePositions: string;
  salary: number;
  gameInfo: string | null;
  avgFptsDk: number | null;
  linestarProj: number | null;
  projOwnPct: number | null;
  ourProj: number | null;
  ourLeverage: number | null;
  actualFpts: number | null;
  actualOwnPct: number | null;
  // Joined fields
  teamName: string | null;
  teamLogo: string | null;
  modelProbA: number | null;
  vegasProbA: number | null;
  matchupTeamAId: number | null;
  slateDate: string | null;
};

export async function getDkPlayers(
  season = CURRENT_SEASON
): Promise<DkPlayerRow[]> {
  const result = await db.execute<DkPlayerRow>(sql`
    SELECT
      dp.id,
      dp.slate_id as "slateId",
      dp.dk_player_id as "dkPlayerId",
      dp.name,
      dp.team_abbrev as "teamAbbrev",
      dp.team_id as "teamId",
      dp.matchup_id as "matchupId",
      dp.eligible_positions as "eligiblePositions",
      dp.salary,
      dp.game_info as "gameInfo",
      dp.avg_fpts_dk as "avgFptsDk",
      dp.linestar_proj as "linestarProj",
      dp.proj_own_pct as "projOwnPct",
      dp.our_proj as "ourProj",
      dp.our_leverage as "ourLeverage",
      dp.actual_fpts as "actualFpts",
      dp.actual_own_pct as "actualOwnPct",
      t.name as "teamName",
      t.logo_url as "teamLogo",
      bm.model_prob_a as "modelProbA",
      bm.vegas_prob_a as "vegasProbA",
      bm.team_a_id as "matchupTeamAId",
      ds.slate_date as "slateDate"
    FROM dk_players dp
    INNER JOIN dk_slates ds ON ds.id = dp.slate_id
    LEFT JOIN teams t ON t.team_id = dp.team_id
    LEFT JOIN bracket_matchups bm ON bm.id = dp.matchup_id
    WHERE ds.id = (
      SELECT id FROM dk_slates ORDER BY slate_date DESC LIMIT 1
    )
    ORDER BY dp.our_leverage DESC NULLS LAST, dp.our_proj DESC NULLS LAST
  `);
  return result.rows;
}

// ── DFS Accuracy (projection vs actuals) ──────────────────

export type DfsAccuracyMetrics = {
  ourMAE: number | null;
  ourBias: number | null;
  linestarMAE: number | null;
  linestarBias: number | null;
  nOur: number;
  nLinestar: number;
  slateDate: string | null;
};

export type DfsAccuracyRow = {
  id: number;
  name: string;
  teamAbbrev: string;
  salary: number;
  eligiblePositions: string;
  ourProj: number | null;
  linestarProj: number | null;
  actualFpts: number | null;
  teamLogo: string | null;
};

export async function getDfsAccuracy(): Promise<{
  metrics: DfsAccuracyMetrics;
  players: DfsAccuracyRow[];
} | null> {
  // Only return data if actuals exist on the most recent slate
  const metricResult = await db.execute<{
    ourMAE: number | null; ourBias: number | null;
    linestarMAE: number | null; linestarBias: number | null;
    nOur: number; nLinestar: number; slateDate: string | null;
  }>(sql`
    SELECT
      AVG(ABS(dp.our_proj - dp.actual_fpts))
        FILTER (WHERE dp.actual_fpts IS NOT NULL AND dp.our_proj IS NOT NULL) as "ourMAE",
      AVG(dp.our_proj - dp.actual_fpts)
        FILTER (WHERE dp.actual_fpts IS NOT NULL AND dp.our_proj IS NOT NULL) as "ourBias",
      AVG(ABS(dp.linestar_proj - dp.actual_fpts))
        FILTER (WHERE dp.actual_fpts IS NOT NULL AND dp.linestar_proj IS NOT NULL) as "linestarMAE",
      AVG(dp.linestar_proj - dp.actual_fpts)
        FILTER (WHERE dp.actual_fpts IS NOT NULL AND dp.linestar_proj IS NOT NULL) as "linestarBias",
      COUNT(*) FILTER (WHERE dp.actual_fpts IS NOT NULL AND dp.our_proj IS NOT NULL) as "nOur",
      COUNT(*) FILTER (WHERE dp.actual_fpts IS NOT NULL AND dp.linestar_proj IS NOT NULL) as "nLinestar",
      ds.slate_date as "slateDate"
    FROM dk_players dp
    INNER JOIN dk_slates ds ON ds.id = dp.slate_id
    WHERE ds.id = (SELECT id FROM dk_slates ORDER BY slate_date DESC LIMIT 1)
    GROUP BY ds.slate_date
  `);

  const metrics = metricResult.rows[0];
  if (!metrics || metrics.nOur === 0) return null;

  const playerResult = await db.execute<DfsAccuracyRow>(sql`
    SELECT
      dp.id, dp.name, dp.team_abbrev as "teamAbbrev", dp.salary,
      dp.eligible_positions as "eligiblePositions",
      dp.our_proj as "ourProj", dp.linestar_proj as "linestarProj",
      dp.actual_fpts as "actualFpts", t.logo_url as "teamLogo"
    FROM dk_players dp
    LEFT JOIN teams t ON t.team_id = dp.team_id
    WHERE dp.slate_id = (SELECT id FROM dk_slates ORDER BY slate_date DESC LIMIT 1)
      AND dp.actual_fpts IS NOT NULL
    ORDER BY ABS(COALESCE(dp.our_proj, 0) - dp.actual_fpts) DESC NULLS LAST
  `);

  return { metrics, players: playerResult.rows };
}

// ── DFS Lineup Strategy Comparison ────────────────────────

export type LineupStrategyRow = {
  strategy: string;
  nLineups: number;
  avgProjFpts: number | null;
  avgActualFpts: number | null;
  avgLeverage: number | null;
  topStack: string | null;
};

/** Single-slate comparison (latest slate by default). */
export async function getDkLineupComparison(): Promise<LineupStrategyRow[]> {
  const result = await db.execute<LineupStrategyRow>(sql`
    SELECT
      dl.strategy,
      COUNT(*)::int AS "nLineups",
      AVG(dl.proj_fpts) AS "avgProjFpts",
      AVG(dl.actual_fpts) AS "avgActualFpts",
      AVG(dl.leverage) AS "avgLeverage",
      mode() WITHIN GROUP (ORDER BY dl.stack_team) AS "topStack"
    FROM dk_lineups dl
    WHERE dl.slate_id = (SELECT id FROM dk_slates ORDER BY slate_date DESC LIMIT 1)
    GROUP BY dl.strategy
    ORDER BY AVG(dl.actual_fpts) DESC NULLS LAST, dl.strategy
  `);
  return result.rows;
}

// ── Cross-Slate Strategy Tracker ───────────────────────────

export type CrossSlateRow = {
  strategy: string;
  slateDate: string;
  nLineups: number;
  avgProjFpts: number | null;
  avgActualFpts: number | null;
  nCashed: number;        // lineups >= cash_threshold (232 for NCAA R32)
  bestLineup: number | null;
  avgLeverage: number | null;
};

/**
 * Returns per-strategy, per-slate performance across all slates that have
 * actual_fpts data. Used to track which strategy wins over time.
 *
 * cash_threshold: minimum actual FPTS to count as "cashed" (default 232 for
 * NCAA R32 slates; adjust per sport/contest size in the web UI).
 */
export async function getDkCrossSlateComparison(
  cashThreshold = 232
): Promise<CrossSlateRow[]> {
  const result = await db.execute<CrossSlateRow>(sql`
    SELECT
      dl.strategy,
      ds.slate_date AS "slateDate",
      COUNT(*)::int AS "nLineups",
      AVG(dl.proj_fpts) AS "avgProjFpts",
      AVG(dl.actual_fpts) AS "avgActualFpts",
      COUNT(*) FILTER (WHERE dl.actual_fpts >= ${cashThreshold})::int AS "nCashed",
      MAX(dl.actual_fpts) AS "bestLineup",
      AVG(dl.leverage) AS "avgLeverage"
    FROM dk_lineups dl
    JOIN dk_slates ds ON ds.id = dl.slate_id
    WHERE dl.actual_fpts IS NOT NULL
    GROUP BY dl.strategy, ds.slate_date
    ORDER BY ds.slate_date DESC, dl.strategy
  `);
  return result.rows;
}

export type StrategySummaryRow = {
  strategy: string;
  nSlates: number;
  totalLineups: number;
  avgActualFpts: number | null;
  totalCashed: number;
  cashRate: number | null;
  bestSingleLineup: number | null;
  avgLeverage: number | null;
};

/**
 * Rolls up cross-slate data into a single summary row per strategy.
 * Use this for the "leaderboard" view showing which strategy is winning
 * across the full tournament.
 */
export async function getDkStrategySummary(
  cashThreshold = 232
): Promise<StrategySummaryRow[]> {
  const result = await db.execute<StrategySummaryRow>(sql`
    SELECT
      dl.strategy,
      COUNT(DISTINCT dl.slate_id)::int AS "nSlates",
      COUNT(*)::int AS "totalLineups",
      AVG(dl.actual_fpts) AS "avgActualFpts",
      COUNT(*) FILTER (WHERE dl.actual_fpts >= ${cashThreshold})::int AS "totalCashed",
      ROUND(
        100.0 * COUNT(*) FILTER (WHERE dl.actual_fpts >= ${cashThreshold}) / COUNT(*),
        1
      ) AS "cashRate",
      MAX(dl.actual_fpts) AS "bestSingleLineup",
      AVG(dl.leverage) AS "avgLeverage"
    FROM dk_lineups dl
    WHERE dl.actual_fpts IS NOT NULL
    GROUP BY dl.strategy
    ORDER BY AVG(dl.actual_fpts) DESC NULLS LAST
  `);
  return result.rows;
}

export async function getLatestSlateInfo(): Promise<{ slateDate: string; gameCount: number | null } | null> {
  const result = await db
    .select({ slateDate: dkSlates.slateDate, gameCount: dkSlates.gameCount })
    .from(dkSlates)
    .orderBy(desc(dkSlates.slateDate))
    .limit(1);
  return result[0] ?? null;
}
