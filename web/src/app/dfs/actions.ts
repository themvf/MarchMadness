"use server";

/**
 * Server actions for the DFS optimizer page.
 *
 * processDkSlate  — parse DK CSV + LineStar CSV, compute projections, save to DB
 * runOptimizer    — run ILP optimizer with given settings, return lineups
 * exportLineups   — build multi-entry upload CSV string
 */

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  dkSlates,
  dkPlayers,
  teams,
  torvikRatings,
  bracketMatchups,
  playerStats,
} from "@/db/schema";
import { eq, sql, isNull, and, or } from "drizzle-orm";
import { optimizeLineups, buildMultiEntryCSV } from "./optimizer";
import type { OptimizerPlayer, OptimizerSettings, GeneratedLineup } from "./optimizer";

const CURRENT_SEASON = 2026;
const LEAGUE_AVG_TEMPO = 68.5;
const LEAGUE_AVG_ADJE = 100.0;

// ── CSV Parsers ──────────────────────────────────────────────

function parseDkCsv(content: string): Array<{
  name: string;
  dkId: number;
  teamAbbrev: string;
  eligiblePositions: string;
  salary: number;
  gameInfo: string;
  avgFptsDk: number | null;
}> {
  const lines = content.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const header = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  const col = (name: string) => header.findIndex((h) => h === name);

  const nameCol = col("Name");
  const idCol = col("ID");
  const salaryCol = col("Salary");
  const rosterPosCol = col("Roster Position");
  const teamCol = col("TeamAbbrev");
  const gameInfoCol = col("Game Info");
  const avgCol = col("AvgPointsPerGame");

  const players = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const name = cells[nameCol] ?? "";
    const idStr = cells[idCol] ?? "";
    if (!name || !idStr) continue;
    const salaryStr = (cells[salaryCol] ?? "0").replace(/[^0-9]/g, "");
    players.push({
      name,
      dkId: parseInt(idStr, 10),
      teamAbbrev: (cells[teamCol] ?? "").toUpperCase(),
      eligiblePositions: cells[rosterPosCol] ?? "UTIL",
      salary: parseInt(salaryStr, 10) || 0,
      gameInfo: cells[gameInfoCol] ?? "",
      avgFptsDk: parseFloat(cells[avgCol] ?? "") || null,
    });
  }
  return players;
}

function parseLinestarCsv(content: string): Map<string, { linestarProj: number; projOwnPct: number }> {
  const lines = content.split(/\r?\n/).filter(Boolean);
  // Skip header row; columns: Pos, Team, Player, Salary, projOwn%, actualOwn%, Diff, Proj
  const map = new Map<string, { linestarProj: number; projOwnPct: number }>();
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",").map((c) => c.trim());
    if (cells.length < 8) continue;
    const playerName = cells[2] ?? "";
    const salaryStr = (cells[3] ?? "").replace(/[^0-9]/g, "");
    const projOwnStr = (cells[4] ?? "").replace("%", "");
    const projStr = cells[7] ?? "";
    if (!playerName) continue;
    const proj = parseFloat(projStr) || 0;
    const projOwn = parseFloat(projOwnStr) || 0;
    if (proj === 0 && projOwn === 0) continue; // true DNP
    const salary = parseInt(salaryStr, 10) || 0;
    // Key: "name_lower|salary" — allows salary-confirmed fuzzy match
    map.set(`${playerName.toLowerCase()}|${salary}`, { linestarProj: proj, projOwnPct: projOwn });
  }
  return map;
}

// Simple Levenshtein for fuzzy name matching
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function findLinestarMatch(
  name: string,
  salary: number,
  map: Map<string, { linestarProj: number; projOwnPct: number }>
) {
  // Exact match first
  const exact = map.get(`${name.toLowerCase()}|${salary}`);
  if (exact) return exact;
  // Fuzzy: find best name match with same salary
  let best: { linestarProj: number; projOwnPct: number } | null = null;
  let bestDist = 4; // max edit distance threshold
  for (const [key, val] of map.entries()) {
    const [lsName, lsSalStr] = key.split("|");
    if (parseInt(lsSalStr, 10) !== salary) continue;
    const dist = levenshtein(name.toLowerCase(), lsName);
    if (dist < bestDist) {
      bestDist = dist;
      best = val;
    }
  }
  return best;
}

// Match DK team abbreviation to team_id
const DK_OVERRIDES: Record<string, string> = {
  DUKE: "Duke", TCU: "TCU", KU: "Kansas", KSAS: "Kansas",
  STJ: "St. John's", STJN: "St. John's", STJS: "St. John's",
  CONN: "Connecticut", CCONN: "Connecticut", UCONN: "Connecticut",
  "MICH ST": "Michigan State", MSU: "Michigan State",
  LOU: "Louisville", UCLA: "UCLA", TTU: "Texas Tech",
  SLU: "Saint Louis", SNTLS: "Saint Louis",
  UVA: "Virginia", VIRG: "Virginia",
  ISU: "Iowa State", "IOWA ST": "Iowa State",
  UK: "Kentucky", VAN: "Vanderbilt", IOWA: "Iowa",
  NEB: "Nebraska", VCU: "VCU", ILL: "Illinois",
  TXAM: "Texas A&M", "TA&M": "Texas A&M",
  AZ: "Arizona", HOU: "Houston",
  UTST: "Utah State", USU: "Utah State",
  HPT: "High Point", "HIGH PT": "High Point",
  GONZ: "Gonzaga", ARK: "Arkansas", PUR: "Purdue",
  MIA: "Miami FL", MIAF: "Miami FL", MIAFL: "Miami FL",
  ALA: "Alabama",
};

function matchTeamId(abbrev: string, teamCache: Map<string, number>): number | null {
  const up = abbrev.toUpperCase().trim();
  const override = DK_OVERRIDES[up];
  if (override) {
    const id = teamCache.get(override.toLowerCase());
    if (id) return id;
  }
  const direct = teamCache.get(up.toLowerCase());
  if (direct) return direct;
  // Prefix match: "DUKE" matches "duke"
  for (const [key, id] of teamCache.entries()) {
    if (key.startsWith(up.toLowerCase()) || up.toLowerCase().startsWith(key.substring(0, 4))) {
      return id;
    }
  }
  return null;
}

// ── Projection helpers ───────────────────────────────────────

function computeOurProjection(
  player: { minPct: number | null; usageRate: number | null; ppg: number | null; rpg: number | null; apg: number | null; stlPct: number | null; blkPct: number | null; tovPct: number | null },
  teamTempo: number,
  oppTempo: number,
  oppDe: number,
  winProb: number
): number | null {
  const minPct = player.minPct ?? 0;
  if (minPct < 5) return null;
  const avgMinutes = (minPct * 40) / 100;
  if (avgMinutes <= 0) return null;

  const gameTempo = (teamTempo + oppTempo) / 2;
  const paceFactor = gameTempo / LEAGUE_AVG_TEMPO;
  const defFactor = LEAGUE_AVG_ADJE / (oppDe || LEAGUE_AVG_ADJE);
  const blowoutFactor = 1.0 - Math.max(0, (winProb - 0.75) * 0.5);
  const projMinutes = avgMinutes * blowoutFactor;

  const ppg = player.ppg ?? 0;
  const rpg = player.rpg ?? 0;
  const apg = player.apg ?? 0;
  const stlPct = player.stlPct ?? 0;
  const blkPct = player.blkPct ?? 0;
  const tovPct = player.tovPct ?? 0;
  const usage = player.usageRate ?? 20;

  const projPts = (ppg / avgMinutes) * projMinutes * defFactor;
  const projReb = (rpg / avgMinutes) * projMinutes * paceFactor;
  const projAst = (apg / avgMinutes) * projMinutes * defFactor;
  const teamPoss = gameTempo * 2;
  const projStl = (stlPct / 100) * teamPoss * (projMinutes / 40);
  const projBlk = (blkPct / 100) * teamPoss * (projMinutes / 40);
  const playerPoss = teamPoss * (usage / 100);
  const projTov = (tovPct / 100) * playerPoss * (projMinutes / 40);

  return Math.round((projPts * 1.0 + projReb * 1.25 + projAst * 1.5 + projStl * 2.0 + projBlk * 2.0 - projTov * 0.5) * 100) / 100;
}

function computeLeverage(
  ourProj: number,
  projOwnPct: number,
  ourWinProb: number | null,
  vegasWinProb: number | null,
  contrarianFactor = 0.7
): number {
  const ownFraction = Math.max(0, Math.min(1, projOwnPct / 100));
  let base = ourProj * Math.pow(1 - ownFraction, contrarianFactor);
  if (ourWinProb != null && vegasWinProb != null && vegasWinProb > 0) {
    const edge = Math.max(0, ourWinProb - vegasWinProb);
    base *= 1 + edge * 2;
  }
  return Math.round(base * 1000) / 1000;
}

// ── Main server actions ──────────────────────────────────────

export async function processDkSlate(formData: FormData): Promise<{ success: boolean; message: string }> {
  const dkCsv = formData.get("dkCsv") as string | null;
  const linestarCsv = formData.get("linestarCsv") as string | null;

  if (!dkCsv || !linestarCsv) {
    return { success: false, message: "Both DK CSV and LineStar CSV are required." };
  }

  try {
    const dkPlayerList = parseDkCsv(dkCsv);
    const linestarMap = parseLinestarCsv(linestarCsv);

    if (dkPlayerList.length === 0) {
      return { success: false, message: "Could not parse any players from DK CSV." };
    }

    // Determine slate date from first game_info
    let slateDate = new Date().toISOString().slice(0, 10);
    for (const p of dkPlayerList) {
      const m = p.gameInfo.match(/(\d{2}\/\d{2}\/\d{4})/);
      if (m) {
        const [mm, dd, yyyy] = m[1].split("/");
        slateDate = `${yyyy}-${mm}-${dd}`;
        break;
      }
    }

    const gameKeys = new Set(dkPlayerList.map((p) => p.gameInfo.split(" ")[0]).filter(Boolean));

    // Upsert slate
    const [slateRow] = await db
      .insert(dkSlates)
      .values({ slateDate, gameCount: gameKeys.size })
      .onConflictDoUpdate({
        target: dkSlates.slateDate,
        set: { gameCount: gameKeys.size },
      })
      .returning({ id: dkSlates.id });
    const slateId = slateRow.id;

    // Load DB context: teams, ratings, matchups, player stats
    const allTeams = await db
      .select({ teamId: teams.teamId, name: teams.name, torvikName: teams.torvikName, ncaaName: teams.ncaaName, shortName: teams.shortName })
      .from(teams);

    const teamCache = new Map<string, number>();
    for (const t of allTeams) {
      for (const n of [t.name, t.torvikName, t.ncaaName, t.shortName]) {
        if (n) teamCache.set(n.toLowerCase(), t.teamId);
      }
    }

    const allRatings = await db
      .select({ teamId: torvikRatings.teamId, adjTempo: torvikRatings.adjTempo, adjDe: torvikRatings.adjDe })
      .from(torvikRatings)
      .where(eq(torvikRatings.season, CURRENT_SEASON));
    const ratingsMap = new Map(allRatings.map((r) => [r.teamId, r]));

    const activeMatchups = await db
      .select({
        id: bracketMatchups.id,
        teamAId: bracketMatchups.teamAId,
        teamBId: bracketMatchups.teamBId,
        modelProbA: bracketMatchups.modelProbA,
        vegasProbA: bracketMatchups.vegasProbA,
      })
      .from(bracketMatchups)
      .where(and(eq(bracketMatchups.season, CURRENT_SEASON), isNull(bracketMatchups.winnerId)));

    const matchupByTeam = new Map<number, (typeof activeMatchups)[0]>();
    for (const m of activeMatchups) {
      matchupByTeam.set(m.teamAId, m);
      matchupByTeam.set(m.teamBId, m);
    }

    type PlayerStatRecord = {
      name: string; teamId: number; minPct: number | null; usageRate: number | null;
      ppg: number | null; rpg: number | null; apg: number | null;
      stlPct: number | null; blkPct: number | null; tovPct: number | null;
    };

    const tournamentTeamIds = [...new Set(activeMatchups.flatMap((m) => [m.teamAId, m.teamBId]))];
    const allPlayerStats: PlayerStatRecord[] = tournamentTeamIds.length > 0
      ? (await db.execute<PlayerStatRecord>(sql`
          SELECT name, team_id as "teamId", min_pct as "minPct", usage_rate as "usageRate",
                 ppg, rpg, apg, stl_pct as "stlPct", blk_pct as "blkPct", tov_pct as "tovPct"
          FROM player_stats
          WHERE season = ${CURRENT_SEASON}
            AND team_id IN (${sql.join(tournamentTeamIds.map((id) => sql`${id}`), sql`, `)})
        `)).rows
      : [];

    const statsByTeam = new Map<number, PlayerStatRecord[]>();
    for (const ps of allPlayerStats) {
      if (!statsByTeam.has(ps.teamId)) statsByTeam.set(ps.teamId, []);
      statsByTeam.get(ps.teamId)!.push(ps);
    }

    // Process each DK player
    for (const p of dkPlayerList) {
      const ls = findLinestarMatch(p.name, p.salary, linestarMap);
      const teamId = matchTeamId(p.teamAbbrev, teamCache);
      const matchup = teamId ? matchupByTeam.get(teamId) : null;

      let winProb: number | null = null;
      let vegasWinProb: number | null = null;
      if (matchup && teamId) {
        winProb = matchup.teamAId === teamId ? matchup.modelProbA : (matchup.modelProbA != null ? 1 - matchup.modelProbA : null);
        vegasWinProb = matchup.teamAId === teamId ? matchup.vegasProbA : (matchup.vegasProbA != null ? 1 - matchup.vegasProbA : null);
      }

      // Fuzzy-match player stats within same team
      let matchedStats: PlayerStatRecord | null = null;
      if (teamId) {
        const candidates = statsByTeam.get(teamId) ?? [];
        let bestDist = 5;
        for (const ps of candidates) {
          const dist = levenshtein(p.name.toLowerCase(), ps.name.toLowerCase());
          if (dist < bestDist) {
            bestDist = dist;
            matchedStats = ps;
          }
        }
      }

      let ourProj: number | null = null;
      if (matchedStats && teamId && matchup && winProb != null) {
        const oppId = matchup.teamAId === teamId ? matchup.teamBId : matchup.teamAId;
        const teamR = ratingsMap.get(teamId);
        const oppR = ratingsMap.get(oppId);
        ourProj = computeOurProjection(
          matchedStats,
          teamR?.adjTempo ?? LEAGUE_AVG_TEMPO,
          oppR?.adjTempo ?? LEAGUE_AVG_TEMPO,
          oppR?.adjDe ?? LEAGUE_AVG_ADJE,
          winProb
        );
      }

      const ourLeverage = (ourProj != null && ls?.projOwnPct != null)
        ? computeLeverage(ourProj, ls.projOwnPct, winProb, vegasWinProb)
        : null;

      await db
        .insert(dkPlayers)
        .values({
          slateId,
          dkPlayerId: p.dkId,
          name: p.name,
          teamAbbrev: p.teamAbbrev,
          eligiblePositions: p.eligiblePositions,
          salary: p.salary,
          teamId: teamId ?? undefined,
          matchupId: matchup?.id ?? undefined,
          gameInfo: p.gameInfo,
          avgFptsDk: p.avgFptsDk,
          linestarProj: ls?.linestarProj ?? null,
          projOwnPct: ls?.projOwnPct ?? null,
          ourProj,
          ourLeverage,
        })
        .onConflictDoUpdate({
          target: [dkPlayers.slateId, dkPlayers.dkPlayerId],
          set: {
            linestarProj: ls?.linestarProj ?? undefined,
            projOwnPct: ls?.projOwnPct ?? undefined,
            ourProj: ourProj ?? undefined,
            ourLeverage: ourLeverage ?? undefined,
            teamId: teamId ?? undefined,
            matchupId: matchup?.id ?? undefined,
          },
        });
    }

    revalidatePath("/dfs");
    return { success: true, message: `Loaded ${dkPlayerList.length} players for ${slateDate}` };
  } catch (err) {
    console.error("processDkSlate error:", err);
    return { success: false, message: String(err) };
  }
}

export async function runOptimizer(
  playerIds: number[],  // subset of dk_player ids (game-filtered)
  settings: OptimizerSettings
): Promise<GeneratedLineup[]> {
  if (playerIds.length === 0) return [];

  const rows = await db.execute<{
    id: number; dkPlayerId: number; name: string; teamAbbrev: string;
    teamId: number | null; matchupId: number | null; eligiblePositions: string;
    salary: number; ourProj: number | null; ourLeverage: number | null;
    linestarProj: number | null; projOwnPct: number | null; gameInfo: string | null;
    teamLogo: string | null; teamName: string | null;
  }>(sql`
    SELECT dp.id, dp.dk_player_id as "dkPlayerId", dp.name, dp.team_abbrev as "teamAbbrev",
           dp.team_id as "teamId", dp.matchup_id as "matchupId",
           dp.eligible_positions as "eligiblePositions", dp.salary,
           dp.our_proj as "ourProj", dp.our_leverage as "ourLeverage",
           dp.linestar_proj as "linestarProj", dp.proj_own_pct as "projOwnPct",
           dp.game_info as "gameInfo",
           t.logo_url as "teamLogo", t.name as "teamName"
    FROM dk_players dp
    LEFT JOIN teams t ON t.team_id = dp.team_id
    WHERE dp.id IN (${sql.join(playerIds.map((id) => sql`${id}`), sql`, `)})
  `);

  const pool = rows.rows as OptimizerPlayer[];
  return optimizeLineups(pool, settings);
}

/**
 * Re-parse a fresh LineStar CSV and update linestar_proj + proj_own_pct + our_leverage
 * for all players on the most recent slate. DK salary data is unchanged.
 */
export async function refreshLinestarProjs(
  formData: FormData
): Promise<{ success: boolean; message: string }> {
  const linestarCsv = formData.get("linestarCsv") as string | null;
  if (!linestarCsv) return { success: false, message: "LineStar CSV is required." };

  try {
    const linestarMap = parseLinestarCsv(linestarCsv);
    if (linestarMap.size === 0) {
      return { success: false, message: "Could not parse any players from LineStar CSV." };
    }

    // Fetch the most recent slate's players (with win probs for leverage recalc)
    const rows = await db.execute<{
      id: number; name: string; salary: number;
      ourProj: number | null; winProb: number | null; vegasWinProb: number | null;
    }>(sql`
      SELECT dp.id, dp.name, dp.salary, dp.our_proj as "ourProj",
             CASE WHEN bm.team_a_id = dp.team_id THEN bm.model_prob_a
                  ELSE 1 - bm.model_prob_a END as "winProb",
             CASE WHEN bm.team_a_id = dp.team_id THEN bm.vegas_prob_a
                  ELSE 1 - bm.vegas_prob_a END as "vegasWinProb"
      FROM dk_players dp
      LEFT JOIN bracket_matchups bm ON bm.id = dp.matchup_id
      WHERE dp.slate_id = (SELECT id FROM dk_slates ORDER BY slate_date DESC LIMIT 1)
    `);

    let updated = 0;
    for (const row of rows.rows) {
      const ls = findLinestarMatch(row.name, row.salary, linestarMap);
      if (!ls) continue;
      const ourLeverage =
        row.ourProj != null
          ? computeLeverage(row.ourProj, ls.projOwnPct, row.winProb ?? null, row.vegasWinProb ?? null)
          : null;
      await db
        .update(dkPlayers)
        .set({ linestarProj: ls.linestarProj, projOwnPct: ls.projOwnPct, ourLeverage })
        .where(eq(dkPlayers.id, row.id));
      updated++;
    }

    revalidatePath("/dfs");
    return { success: true, message: `Updated ${updated} / ${rows.rows.length} players from LineStar.` };
  } catch (err) {
    console.error("refreshLinestarProjs error:", err);
    return { success: false, message: String(err) };
  }
}

/**
 * Re-fetch LineStar projections + ownership via API for the latest slate.
 * Use this to pick up injury updates, late scratches, or ownership shifts
 * without reloading DK salary data.
 *
 * Requires DNN_COOKIE env var. The draftGroupId tells us which LineStar
 * slate to pull (same ID used when the slate was first loaded).
 */
export async function refreshLinestarApi(
  draftGroupId: number
): Promise<{ success: boolean; message: string; updated: number }> {
  const dnnCookie = process.env.DNN_COOKIE;
  if (!dnnCookie) {
    return { success: false, message: "DNN_COOKIE env var not set.", updated: 0 };
  }

  try {
    // Look up the stored LineStar periodId for this draft group — avoids re-discovery
    // via GetPeriodInformation, which only returns upcoming/active slates (fails once
    // games have started).
    const slateRows = await db.execute<{ id: number; linestarPeriodId: number | null }>(sql`
      SELECT id, linestar_period_id as "linestarPeriodId"
      FROM dk_slates
      WHERE dk_draft_group_id = ${draftGroupId}
      ORDER BY slate_date DESC LIMIT 1
    `);
    const storedPeriodId = slateRows.rows[0]?.linestarPeriodId ?? null;

    let lsMap: Map<string, { linestarProj: number; projOwnPct: number; isOut: boolean }>;
    if (storedPeriodId) {
      // Fast path: use stored periodId, call GetSalariesV5 directly
      const data = await lsGetSalariesV5(storedPeriodId, dnnCookie);
      const scj = (data.SalaryContainerJson as string | null | undefined) ?? "{}";
      let container: { Salaries?: Array<{ Id: number; Name: string; SAL: number; PP: number; IS?: number; STAT?: number }> } = {};
      try { container = JSON.parse(scj); } catch { /* ignore */ }
      const ownershipBlock = (data.Ownership as { Projected?: Record<string, Array<{ SalaryId: number; Owned: number }>> } | undefined);
      const ownershipMap = averageOwnershipBySalaryId(ownershipBlock?.Projected ?? {});
      lsMap = new Map();
      for (const p of (container.Salaries ?? [])) {
        const proj = typeof p.PP === "number" ? p.PP : parseFloat(p.PP as unknown as string) || 0;
        const ownPct = ownershipMap.get(p.Id) ?? 0;
        lsMap.set(`${(p.Name ?? "").toLowerCase()}|${p.SAL}`, {
          linestarProj: proj,
          projOwnPct: ownPct,
          isOut: p.IS === 1 || p.STAT === 4,
        });
      }
    } else {
      // Slow path: discover periodId via GetPeriodInformation, then store it for next time
      const lsResult = await fetchLinestarData(draftGroupId, dnnCookie);
      lsMap = lsResult.data;
      // Store discovered periodId so future refreshes skip GetPeriodInformation
      if (lsResult.periodId && slateRows.rows[0]?.id) {
        await db.execute(sql`
          UPDATE dk_slates SET linestar_period_id = ${lsResult.periodId}
          WHERE id = ${slateRows.rows[0].id}
        `);
      }
    }

    if (lsMap.size === 0) {
      return { success: false, message: "LineStar returned no players.", updated: 0 };
    }
    const linestarData = lsMap;

    // Load current slate players with win probs for leverage recalc
    const rows = await db.execute<{
      id: number; name: string; salary: number;
      ourProj: number | null; winProb: number | null; vegasWinProb: number | null;
    }>(sql`
      SELECT dp.id, dp.name, dp.salary, dp.our_proj as "ourProj",
             CASE WHEN bm.team_a_id = dp.team_id THEN bm.model_prob_a
                  ELSE 1 - bm.model_prob_a END as "winProb",
             CASE WHEN bm.team_a_id = dp.team_id THEN bm.vegas_prob_a
                  ELSE 1 - bm.vegas_prob_a END as "vegasWinProb"
      FROM dk_players dp
      LEFT JOIN bracket_matchups bm ON bm.id = dp.matchup_id
      WHERE dp.slate_id = (SELECT id FROM dk_slates ORDER BY slate_date DESC LIMIT 1)
    `);

    let updated = 0;
    for (const row of rows.rows) {
      const lsKey = `${row.name.toLowerCase()}|${row.salary}`;
      const lsData = linestarData.get(lsKey);
      if (!lsData) continue;

      const isOut = lsData.isOut;
      const projForLeverage = isOut ? 0 : (row.ourProj ?? lsData.linestarProj);
      const ourLeverage = (projForLeverage != null && projForLeverage > 0 && lsData.projOwnPct != null)
        ? computeLeverage(projForLeverage, lsData.projOwnPct, row.winProb ?? null, row.vegasWinProb ?? null)
        : null;

      await db
        .update(dkPlayers)
        .set({
          linestarProj: lsData.linestarProj,
          projOwnPct: lsData.projOwnPct,
          ourLeverage,
        })
        .where(eq(dkPlayers.id, row.id));
      updated++;
    }

    revalidatePath("/dfs");
    return {
      success: true,
      message: `Updated ${updated} / ${rows.rows.length} players from LineStar API.`,
      updated,
    };
  } catch (err) {
    console.error("refreshLinestarApi error:", err);
    return { success: false, message: String(err), updated: 0 };
  }
}

export async function exportLineups(
  lineups: GeneratedLineup[],
  entryTemplateCsv: string
): Promise<string> {
  const lines = entryTemplateCsv.split(/\r?\n/).filter(Boolean);
  return buildMultiEntryCSV(lineups, lines);
}

// ── DK API helpers ───────────────────────────────────────────

const DK_PROJ_STAT_ID = 279;
const DK_ET_OFFSET_MS = -4 * 60 * 60 * 1000; // EDT = UTC-4 (March–November)

function formatDkGameInfo(competition: { name?: string; startTime?: string }): string {
  const name = (competition.name ?? "").replace(" @ ", "@").replace(/ /g, "");
  if (!competition.startTime) return name;
  try {
    const et = new Date(new Date(competition.startTime).getTime() + DK_ET_OFFSET_MS);
    const mm = String(et.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(et.getUTCDate()).padStart(2, "0");
    const yyyy = et.getUTCFullYear();
    const hh = et.getUTCHours();
    const min = String(et.getUTCMinutes()).padStart(2, "0");
    const ampm = hh >= 12 ? "PM" : "AM";
    const h12 = String(hh % 12 || 12).padStart(2, "0");
    return `${name} ${mm}/${dd}/${yyyy} ${h12}:${min}${ampm} ET`;
  } catch {
    return name;
  }
}

async function fetchDkDraftables(draftGroupId: number): Promise<Array<{
  name: string; dkId: number; teamAbbrev: string;
  eligiblePositions: string; salary: number; gameInfo: string; avgFptsDk: number | null;
}>> {
  const res = await fetch(
    `https://api.draftkings.com/draftgroups/v1/draftgroups/${draftGroupId}/draftables`,
    { cache: "no-store" }
  );
  if (!res.ok) throw new Error(`DK API returned ${res.status} for draftGroupId ${draftGroupId}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await res.json() as { draftables?: any[] };
  const raw = data.draftables ?? [];

  // Group by playerId; take lowest rosterSlotId as canonical (primary position)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byPlayer = new Map<number, any[]>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const e of raw as any[]) {
    if (!byPlayer.has(e.playerId)) byPlayer.set(e.playerId, []);
    byPlayer.get(e.playerId)!.push(e);
  }

  return Array.from(byPlayer.values()).map((entries) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    entries.sort((a: any, b: any) => a.rosterSlotId - b.rosterSlotId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = entries[0] as any;
    const pos: string = c.position ?? "UTIL";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const avgAttr = (c.draftStatAttributes ?? []).find((a: any) => a.id === DK_PROJ_STAT_ID);
    return {
      name: (c.displayName ?? "") as string,
      dkId: c.draftableId as number,
      teamAbbrev: ((c.teamAbbreviation ?? "") as string).toUpperCase(),
      eligiblePositions: pos !== "UTIL" ? `${pos}/UTIL` : "UTIL",
      salary: (c.salary ?? 0) as number,
      gameInfo: formatDkGameInfo((c.competition ?? {}) as { name?: string; startTime?: string }),
      avgFptsDk: avgAttr ? (parseFloat(avgAttr.value) || null) : null,
    };
  });
}

// ── loadSlateFromApi server action ───────────────────────────

export async function loadSlateFromApi(
  idType: "contest" | "draftGroup",
  id: number
): Promise<{
  success: boolean;
  message: string;
  slateDate?: string;
  gameCount?: number;
  playerCount?: number;
  teams?: string[];
  lockTime?: string;
  draftGroupId?: number;
}> {
  try {
    // Resolve draftGroupId
    let draftGroupId = id;
    if (idType === "contest") {
      const res = await fetch(
        `https://api.draftkings.com/contests/v1/contests/${id}`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error(`DK contests API returned ${res.status}`);
      const data = await res.json() as { contestDetail: { draftGroupId: number } };
      draftGroupId = data.contestDetail.draftGroupId;
    }

    const dkPlayerList = await fetchDkDraftables(draftGroupId);
    if (dkPlayerList.length === 0) {
      return { success: false, message: "No players returned — check your ID." };
    }

    // Extract slate date and game info
    let slateDate = new Date().toISOString().slice(0, 10);
    let lockTime: string | undefined;
    for (const p of dkPlayerList) {
      const m = p.gameInfo.match(/(\d{2}\/\d{2}\/\d{4})/);
      if (m) {
        const [mm, dd, yyyy] = m[1].split("/");
        slateDate = `${yyyy}-${mm}-${dd}`;
        const parts = p.gameInfo.split(" ");
        if (parts.length >= 3) lockTime = `${parts[1]} ${parts[2]}`;
        break;
      }
    }

    const gameKeys = new Set(dkPlayerList.map((p) => p.gameInfo.split(" ")[0]).filter(Boolean));
    const gameCount = gameKeys.size;
    const uniqueTeams = Array.from(new Set(dkPlayerList.map((p) => p.teamAbbrev))).sort();

    // ── Upsert slate row ──────────────────────────────────────
    const [slateRow] = await db
      .insert(dkSlates)
      .values({ slateDate, gameCount, dkDraftGroupId: draftGroupId })
      .onConflictDoUpdate({
        target: dkSlates.slateDate,
        set: { gameCount, dkDraftGroupId: draftGroupId },
      })
      .returning({ id: dkSlates.id });
    const slateId = slateRow.id;

    const allTeams = await db
      .select({ teamId: teams.teamId, name: teams.name, torvikName: teams.torvikName, ncaaName: teams.ncaaName, shortName: teams.shortName })
      .from(teams);

    const teamCache = new Map<string, number>();
    for (const t of allTeams) {
      for (const n of [t.name, t.torvikName, t.ncaaName, t.shortName]) {
        if (n) teamCache.set(n.toLowerCase(), t.teamId);
      }
    }

    const allRatings = await db
      .select({ teamId: torvikRatings.teamId, adjTempo: torvikRatings.adjTempo, adjDe: torvikRatings.adjDe })
      .from(torvikRatings)
      .where(eq(torvikRatings.season, CURRENT_SEASON));
    const ratingsMap = new Map(allRatings.map((r) => [r.teamId, r]));

    const activeMatchups = await db
      .select({ id: bracketMatchups.id, teamAId: bracketMatchups.teamAId, teamBId: bracketMatchups.teamBId, modelProbA: bracketMatchups.modelProbA, vegasProbA: bracketMatchups.vegasProbA })
      .from(bracketMatchups)
      .where(and(eq(bracketMatchups.season, CURRENT_SEASON), isNull(bracketMatchups.winnerId)));

    const matchupByTeam = new Map<number, (typeof activeMatchups)[0]>();
    for (const m of activeMatchups) {
      matchupByTeam.set(m.teamAId, m);
      matchupByTeam.set(m.teamBId, m);
    }

    type PlayerStatRecord = {
      name: string; teamId: number; minPct: number | null; usageRate: number | null;
      ppg: number | null; rpg: number | null; apg: number | null;
      stlPct: number | null; blkPct: number | null; tovPct: number | null;
    };

    const tournamentTeamIds = [...new Set(activeMatchups.flatMap((m) => [m.teamAId, m.teamBId]))];
    const allPlayerStats: PlayerStatRecord[] = tournamentTeamIds.length > 0
      ? (await db.execute<PlayerStatRecord>(sql`
          SELECT name, team_id as "teamId", min_pct as "minPct", usage_rate as "usageRate",
                 ppg, rpg, apg, stl_pct as "stlPct", blk_pct as "blkPct", tov_pct as "tovPct"
          FROM player_stats
          WHERE season = ${CURRENT_SEASON}
            AND team_id IN (${sql.join(tournamentTeamIds.map((id) => sql`${id}`), sql`, `)})
        `)).rows
      : [];

    const statsByTeam = new Map<number, PlayerStatRecord[]>();
    for (const ps of allPlayerStats) {
      if (!statsByTeam.has(ps.teamId)) statsByTeam.set(ps.teamId, []);
      statsByTeam.get(ps.teamId)!.push(ps);
    }

    // ── LineStar API fetch (if DNN_COOKIE env var is set) ──────
    let linestarData: Map<string, { linestarProj: number; projOwnPct: number; isOut: boolean }> = new Map();
    let linestarPeriodId: number | null = null;
    const dnnCookie = process.env.DNN_COOKIE;
    if (dnnCookie) {
      try {
        const lsResult = await fetchLinestarData(draftGroupId, dnnCookie);
        linestarData = lsResult.data;
        linestarPeriodId = lsResult.periodId;
        console.log(`LineStar API: ${linestarData.size} players fetched (periodId=${linestarPeriodId})`);
        // Store periodId in slate so refresh doesn't need to re-discover it
        await db.update(dkSlates)
          .set({ linestarPeriodId })
          .where(eq(dkSlates.id, slateRow.id));
      } catch (lsErr) {
        console.warn("LineStar API fetch failed (continuing without it):", lsErr);
      }
    }

    // Save each player
    for (const p of dkPlayerList) {
      const lsKey = `${p.name.toLowerCase()}|${p.salary}`;
      const lsData = linestarData.get(lsKey);
      const teamId = matchTeamId(p.teamAbbrev, teamCache);
      const matchup = teamId ? matchupByTeam.get(teamId) : null;

      let winProb: number | null = null;
      let vegasWinProb: number | null = null;
      if (matchup && teamId) {
        winProb = matchup.teamAId === teamId ? matchup.modelProbA : (matchup.modelProbA != null ? 1 - matchup.modelProbA : null);
        vegasWinProb = matchup.teamAId === teamId ? matchup.vegasProbA : (matchup.vegasProbA != null ? 1 - matchup.vegasProbA : null);
      }

      let matchedStats: PlayerStatRecord | null = null;
      if (teamId) {
        let bestDist = 5;
        for (const ps of statsByTeam.get(teamId) ?? []) {
          const dist = levenshtein(p.name.toLowerCase(), ps.name.toLowerCase());
          if (dist < bestDist) { bestDist = dist; matchedStats = ps; }
        }
      }

      let ourProj: number | null = null;
      if (matchedStats && teamId && matchup && winProb != null) {
        const oppId = matchup.teamAId === teamId ? matchup.teamBId : matchup.teamAId;
        ourProj = computeOurProjection(
          matchedStats,
          ratingsMap.get(teamId)?.adjTempo ?? LEAGUE_AVG_TEMPO,
          ratingsMap.get(oppId)?.adjTempo ?? LEAGUE_AVG_TEMPO,
          ratingsMap.get(oppId)?.adjDe ?? LEAGUE_AVG_ADJE,
          winProb
        );
      }

      const linestarProj = lsData?.linestarProj ?? null;
      const projOwnPct = lsData?.projOwnPct ?? null;
      const isOut = lsData?.isOut ?? false;
      // If LineStar marks player OUT/injured, zero their leverage so the
      // optimizer excludes them even if our model has a non-zero ourProj.
      const projForLeverage = isOut ? 0 : (ourProj ?? linestarProj);
      const ourLeverage = (projForLeverage != null && projForLeverage > 0 && projOwnPct != null)
        ? computeLeverage(projForLeverage, projOwnPct, winProb, vegasWinProb)
        : null;

      await db
        .insert(dkPlayers)
        .values({
          slateId,
          dkPlayerId: p.dkId,
          name: p.name,
          teamAbbrev: p.teamAbbrev,
          eligiblePositions: p.eligiblePositions,
          salary: p.salary,
          teamId: teamId ?? undefined,
          matchupId: matchup?.id ?? undefined,
          gameInfo: p.gameInfo,
          avgFptsDk: p.avgFptsDk,
          linestarProj,
          projOwnPct,
          ourProj,
          ourLeverage,
        })
        .onConflictDoUpdate({
          target: [dkPlayers.slateId, dkPlayers.dkPlayerId],
          set: {
            salary: p.salary,
            avgFptsDk: p.avgFptsDk ?? undefined,
            teamId: teamId ?? undefined,
            matchupId: matchup?.id ?? undefined,
            linestarProj: linestarProj ?? undefined,
            projOwnPct: projOwnPct ?? undefined,
            ourProj: ourProj ?? undefined,
            ourLeverage: ourLeverage ?? undefined,
          },
        });
    }

    revalidatePath("/dfs");
    return {
      success: true,
      message: `Loaded ${dkPlayerList.length} players for ${slateDate} (${gameCount} games)`,
      slateDate,
      gameCount,
      playerCount: dkPlayerList.length,
      teams: uniqueTeams,
      lockTime,
      draftGroupId,
    };
  } catch (err) {
    console.error("loadSlateFromApi error:", err);
    return { success: false, message: String(err) };
  }
}

// ── LineStar API helpers ──────────────────────────────────────

const LS_BASE = "https://www.linestarapp.com";
const LS_SITE = 1;   // DraftKings
const LS_SPORT = 4;  // College Basketball
const LS_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Accept": "application/json",
  "Referer": "https://www.linestarapp.com/DesktopModules/DailyFantasyApi/",
};

/**
 * Fetch LineStar projections + ownership for a DK draftGroupId.
 *
 * Returns Map<"name_lower|salary" → {linestarProj, projOwnPct}>.
 * Compatible with the DB upsert pipeline in loadSlateFromApi.
 */
async function fetchLinestarData(
  draftGroupId: number,
  dnnCookie: string
): Promise<{ data: Map<string, { linestarProj: number; projOwnPct: number; isOut: boolean }>; periodId: number }> {
  const periodId = await findLinestarPeriodId(draftGroupId, dnnCookie);
  const data = await lsGetSalariesV5(periodId, dnnCookie);

  // Parse SalaryContainerJson
  const scj = (data.SalaryContainerJson as string | null | undefined) ?? "{}";
  let container: { Salaries?: Array<{
    Id: number; Name: string; SAL: number; PP: number; IS?: number; STAT?: number;
  }> } = {};
  try { container = JSON.parse(scj); } catch { /* ignore */ }

  const salaries = container.Salaries ?? [];

  // Build ownership map: salaryId → avg ownership %
  const ownershipBlock = (data.Ownership as { Projected?: Record<string, Array<{ SalaryId: number; Owned: number }>> } | undefined);
  const ownershipRaw = ownershipBlock?.Projected ?? {};
  const ownershipMap = averageOwnershipBySalaryId(ownershipRaw);

  const result = new Map<string, { linestarProj: number; projOwnPct: number; isOut: boolean }>();
  for (const p of salaries) {
    const proj = typeof p.PP === "number" ? p.PP : parseFloat(p.PP as unknown as string) || 0;
    const ownPct = ownershipMap.get(p.Id) ?? 0;
    const isOut = p.IS === 1 || p.STAT === 4;
    // Include injured/out players with proj=0 so re-fetches overwrite stale DB values.
    // Optimizer's score > 0 filter handles exclusion.
    const key = `${(p.Name ?? "").toLowerCase()}|${p.SAL}`;
    result.set(key, { linestarProj: proj, projOwnPct: ownPct, isOut });
  }
  return { data: result, periodId };
}

async function findLinestarPeriodId(draftGroupId: number, dnnCookie: string): Promise<number> {
  // 1. Manual override via env var — use this when GetPeriodInformation fails
  //    (it only returns upcoming slates; returns empty once games are in progress).
  const envPeriodId = process.env.LINESTAR_PERIOD_ID;
  if (envPeriodId) {
    const pid = parseInt(envPeriodId, 10);
    if (!isNaN(pid)) return pid;
  }

  // 2. Call GetPeriodInformation WITH auth (always — unauthenticated returns HTTP 200
  //    but with empty data, silently blocking the auth retry in a try/catch).
  const infoUrl = `${LS_BASE}/DesktopModules/DailyFantasyApi/API/Fantasy/GetPeriodInformation?site=${LS_SITE}&sport=${LS_SPORT}`;
  const headers: Record<string, string> = { ...LS_HEADERS };
  if (dnnCookie) headers["Cookie"] = `.DOTNETNUKE=${dnnCookie}`;
  const res = await fetch(infoUrl, { headers, cache: "no-store" });
  if (!res.ok) throw new Error(`GetPeriodInformation returned ${res.status}`);
  const periodsData: unknown = await res.json();

  const periods: Array<{ PeriodId?: number; Id?: number }> = Array.isArray(periodsData)
    ? periodsData
    : ((periodsData as { Periods?: unknown[] }).Periods ?? []);

  if (!periods.length) {
    throw new Error(
      "GetPeriodInformation returned no periods — the slate may already be in progress. " +
      "Set the LINESTAR_PERIOD_ID env var in Vercel to bypass discovery."
    );
  }

  // 3. Scan most-recent periods until we find one whose Slates contain our draftGroupId
  for (const period of periods.slice(0, 10)) {
    const pid = period.PeriodId ?? period.Id;
    if (!pid) continue;
    try {
      const data = await lsGetSalariesV5(pid, dnnCookie);
      const slates = (data.Slates ?? []) as Array<{ PeriodId?: number; DfsSlateId?: number }>;
      if (slates.some((s) => s.DfsSlateId === draftGroupId)) {
        return pid;
      }
    } catch { /* skip period */ }
  }

  throw new Error(
    `No LineStar slate found for DK draftGroupId ${draftGroupId}. ` +
    "Set the LINESTAR_PERIOD_ID env var in Vercel to bypass discovery."
  );
}

async function lsGetSalariesV5(periodId: number, dnnCookie: string): Promise<Record<string, unknown>> {
  const url = `${LS_BASE}/DesktopModules/DailyFantasyApi/API/Fantasy/GetSalariesV5` +
              `?periodId=${periodId}&site=${LS_SITE}&sport=${LS_SPORT}`;
  const headers: Record<string, string> = { ...LS_HEADERS };
  if (dnnCookie) headers["Cookie"] = `.DOTNETNUKE=${dnnCookie}`;

  const res = await fetch(url, { headers, cache: "no-store" });
  if (!res.ok) throw new Error(`LineStar GetSalariesV5 returned ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}

function averageOwnershipBySalaryId(
  ownershipRaw: Record<string, Array<{ SalaryId: number; Owned: number }>>
): Map<number, number> {
  const totals = new Map<number, number>();
  const counts = new Map<number, number>();
  for (const entries of Object.values(ownershipRaw)) {
    if (!Array.isArray(entries)) continue;
    for (const e of entries) {
      const owned = typeof e.Owned === "number" ? e.Owned : parseFloat(e.Owned as unknown as string);
      if (e.SalaryId != null && !isNaN(owned)) {
        totals.set(e.SalaryId, (totals.get(e.SalaryId) ?? 0) + owned);
        counts.set(e.SalaryId, (counts.get(e.SalaryId) ?? 0) + 1);
      }
    }
  }
  const result = new Map<number, number>();
  for (const [sid, total] of totals) {
    result.set(sid, total / counts.get(sid)!);
  }
  return result;
}
