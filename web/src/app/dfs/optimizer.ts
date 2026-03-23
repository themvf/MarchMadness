import "server-only";

/**
 * DraftKings CBB lineup optimizer using Integer Linear Programming.
 *
 * Lineup structure: G / G / G / F / F / F / UTIL / UTIL (8 players, $50k cap)
 * - G slot: player with "G" in eligible_positions
 * - F slot: player with "F" in eligible_positions
 * - UTIL: any player
 *
 * Uses javascript-lp-solver for binary ILP. Stack constraints modeled as
 * auxiliary binary variables z_T per team (see inline comments).
 */

import type { DkPlayerRow } from "@/db/queries";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const solver = require("javascript-lp-solver") as {
  Solve: (model: SolverModel) => SolverResult;
};

type SolverModel = {
  optimize: string;
  opType: "max" | "min";
  constraints: Record<string, { min?: number; max?: number; equal?: number }>;
  variables: Record<string, Record<string, number>>;
  binaries: Record<string, number>;
};

type SolverResult = Record<string, number> & { feasible: boolean; result: number };

export type OptimizerPlayer = Pick<
  DkPlayerRow,
  | "id"
  | "dkPlayerId"
  | "name"
  | "teamAbbrev"
  | "teamId"
  | "matchupId"
  | "eligiblePositions"
  | "salary"
  | "ourProj"
  | "ourLeverage"
  | "linestarProj"
  | "projOwnPct"
  | "gameInfo"
  | "teamLogo"
  | "teamName"
>;

export type LineupSlot = "G" | "G2" | "G3" | "F" | "F2" | "F3" | "UTIL" | "UTIL2";

export type GeneratedLineup = {
  players: OptimizerPlayer[];
  slots: Record<LineupSlot, OptimizerPlayer>;
  totalSalary: number;
  projFpts: number;
  leverageScore: number;
};

export type OptimizerSettings = {
  mode: "cash" | "gpp";
  nLineups: number;
  minStack: number;       // min players from same team (2 or 3)
  maxExposure: number;    // 0–1, e.g. 0.6 = max 60% of lineups
};

const SALARY_CAP = 50000;
const ROSTER_SIZE = 8;
const MIN_G = 3;
const MIN_F = 3;

/**
 * Optimize N lineups from the given player pool.
 *
 * @param pool     Filtered player list (already game-selected by caller)
 * @param settings Optimizer settings
 * @returns Array of generated lineups (may be fewer than nLineups if infeasible)
 */
export function optimizeLineups(
  pool: OptimizerPlayer[],
  settings: OptimizerSettings
): GeneratedLineup[] {
  const { mode, nLineups, minStack, maxExposure } = settings;

  // Only include players with a usable projection
  const eligible = pool.filter((p) => {
    const score = mode === "gpp" ? p.ourLeverage : p.ourProj;
    return score != null && score > 0 && p.salary > 0;
  });

  if (eligible.length < ROSTER_SIZE) return [];

  // Track how many lineups each player appears in (for exposure cap)
  const exposureCount = new Map<number, number>(eligible.map((p) => [p.id, 0]));
  const lineups: GeneratedLineup[] = [];
  const previousLineupSets: Set<number>[] = [];

  for (let i = 0; i < nLineups; i++) {
    const maxExp = Math.ceil(nLineups * maxExposure);

    const lineup = solveOneLineup(
      eligible,
      mode,
      minStack,
      maxExp,
      exposureCount,
      previousLineupSets
    );

    if (!lineup) break; // no more feasible lineups

    lineups.push(lineup);
    const lineupSet = new Set(lineup.players.map((p) => p.id));
    previousLineupSets.push(lineupSet);
    for (const p of lineup.players) {
      exposureCount.set(p.id, (exposureCount.get(p.id) ?? 0) + 1);
    }
  }

  return lineups;
}

function solveOneLineup(
  pool: OptimizerPlayer[],
  mode: "cash" | "gpp",
  minStack: number,
  maxExposureCount: number,
  exposureCount: Map<number, number>,
  previousLineupSets: Set<number>[]
): GeneratedLineup | null {
  // Get unique teams with enough players for a stack
  const teamPlayers = new Map<string, OptimizerPlayer[]>();
  for (const p of pool) {
    const team = p.teamAbbrev;
    if (!teamPlayers.has(team)) teamPlayers.set(team, []);
    teamPlayers.get(team)!.push(p);
  }
  const stackableTeams = Array.from(teamPlayers.entries())
    .filter(([, players]) => players.length >= minStack)
    .map(([team]) => team);

  const constraints: SolverModel["constraints"] = {
    salary: { max: SALARY_CAP },
    total: { equal: ROSTER_SIZE },
    g_count: { min: MIN_G },
    f_count: { min: MIN_F },
    stack_count: { min: 1 }, // at least one z_T = 1
  };

  // Exposure cap: player cannot appear in more than maxExposureCount lineups
  for (const p of pool) {
    const used = exposureCount.get(p.id) ?? 0;
    if (used >= maxExposureCount) {
      constraints[`excl_player_${p.id}`] = { max: 0 };
    }
  }

  // Diversity: enforce at least 2 different players vs each previous lineup
  for (let i = 0; i < previousLineupSets.length; i++) {
    constraints[`div_${i}`] = { max: ROSTER_SIZE - 2 }; // at most 6 overlap
  }

  // Per-team stack constraints: sum(players from T) - minStack * z_T >= 0
  for (const team of stackableTeams) {
    constraints[`team_${team}`] = { min: 0 };
  }

  const variables: SolverModel["variables"] = {};
  const binaries: SolverModel["binaries"] = {};

  // Player variables
  for (const p of pool) {
    const key = `p_${p.id}`;
    const score = (mode === "gpp" ? p.ourLeverage : p.ourProj) ?? 0;
    const entry: Record<string, number> = {
      score,
      salary: p.salary,
      total: 1,
    };

    const pos = p.eligiblePositions;
    if (pos.includes("G")) entry.g_count = 1;
    if (pos.includes("F")) entry.f_count = 1;

    // Team stack coefficient
    if (stackableTeams.includes(p.teamAbbrev)) {
      entry[`team_${p.teamAbbrev}`] = 1;
    }

    // Diversity coefficients
    for (let i = 0; i < previousLineupSets.length; i++) {
      if (previousLineupSets[i].has(p.id)) {
        entry[`div_${i}`] = 1;
      }
    }

    // Exposure cap
    if ((exposureCount.get(p.id) ?? 0) >= maxExposureCount) {
      entry[`excl_player_${p.id}`] = 1;
    }

    variables[key] = entry;
    binaries[key] = 1;
  }

  // Stack helper variables z_T (binary: 1 = this team is the stacked team)
  for (const team of stackableTeams) {
    const key = `z_${team}`;
    variables[key] = {
      stack_count: 1,
      [`team_${team}`]: -minStack, // sum(team players) - minStack * z_T >= 0
    };
    binaries[key] = 1;
  }

  const model: SolverModel = {
    optimize: "score",
    opType: "max",
    constraints,
    variables,
    binaries,
  };

  const result = solver.Solve(model);
  if (!result.feasible) return null;

  // Extract selected players
  const selected = pool.filter((p) => result[`p_${p.id}`] === 1);
  if (selected.length !== ROSTER_SIZE) return null;

  const slots = assignPositions(selected);
  if (!slots) return null;

  const totalSalary = selected.reduce((s, p) => s + p.salary, 0);
  const projFpts = selected.reduce((s, p) => s + (p.ourProj ?? 0), 0);
  const leverageScore = selected.reduce((s, p) => s + (p.ourLeverage ?? 0), 0);

  return { players: selected, slots, totalSalary, projFpts, leverageScore };
}

/**
 * Assign 8 selected players to G/G/G/F/F/F/UTIL/UTIL slots.
 * Uses a greedy assignment: pure-position players first, then flexible.
 */
function assignPositions(
  players: OptimizerPlayer[]
): Record<LineupSlot, OptimizerPlayer> | null {
  const gSlots: LineupSlot[] = ["G", "G2", "G3"];
  const fSlots: LineupSlot[] = ["F", "F2", "F3"];
  const utilSlots: LineupSlot[] = ["UTIL", "UTIL2"];

  const assigned = new Map<LineupSlot, OptimizerPlayer>();
  const unassigned = [...players];

  const fill = (
    slots: LineupSlot[],
    filter: (p: OptimizerPlayer) => boolean
  ) => {
    for (const slot of slots) {
      if (assigned.has(slot)) continue;
      const idx = unassigned.findIndex(filter);
      if (idx >= 0) {
        assigned.set(slot, unassigned.splice(idx, 1)[0]);
      }
    }
  };

  // Pure G (only G-eligible, not F)
  fill(gSlots, (p) => p.eligiblePositions.includes("G") && !p.eligiblePositions.includes("F"));
  // Pure F (only F-eligible, not G)
  fill(fSlots, (p) => p.eligiblePositions.includes("F") && !p.eligiblePositions.includes("G"));
  // Flexible G/F fills remaining G slots
  fill(gSlots, (p) => p.eligiblePositions.includes("G"));
  // Flexible G/F fills remaining F slots
  fill(fSlots, (p) => p.eligiblePositions.includes("F"));
  // UTIL gets the rest
  fill(utilSlots, () => true);
  fill(utilSlots, () => true);

  if (assigned.size !== 8) return null;
  return Object.fromEntries(assigned) as Record<LineupSlot, OptimizerPlayer>;
}

/**
 * Build multi-entry upload CSV from lineups + entry IDs.
 *
 * DK format: Entry ID,Contest Name,Contest ID,Entry Fee,G,G,G,F,F,F,UTIL,UTIL
 * Each player cell: "Name (dkPlayerId)"
 */
export function buildMultiEntryCSV(
  lineups: GeneratedLineup[],
  entryRows: string[] // raw lines from template CSV (header + entry rows)
): string {
  if (lineups.length === 0 || entryRows.length < 2) return "";

  const header = entryRows[0];
  const rows = [header];

  for (let i = 0; i < lineups.length; i++) {
    const lineup = lineups[i];
    const entryLine = entryRows[i + 1] ?? entryRows[1]; // reuse last if fewer entries than lineups
    const cols = entryLine.split(",");
    // Columns 4–11 are the 8 player slots
    const slotOrder: LineupSlot[] = ["G", "G2", "G3", "F", "F2", "F3", "UTIL", "UTIL2"];
    for (let j = 0; j < 8; j++) {
      const player = lineup.slots[slotOrder[j]];
      cols[4 + j] = player ? `${player.name} (${player.dkPlayerId})` : "";
    }
    rows.push(cols.join(","));
  }

  return rows.join("\n");
}
