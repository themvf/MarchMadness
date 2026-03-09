import { db } from ".";
import { teams, torvikRatings, tournamentBracket, simulationResults, games } from "./schema";
import { eq, desc, asc, sql, and } from "drizzle-orm";

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
