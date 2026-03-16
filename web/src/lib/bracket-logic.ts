/**
 * Pure bracket logic: slot mapping, feeder relationships, log5 probability,
 * and cascading pick clears. No React, no DB — just data transformations.
 */

// ── Types ────────────────────────────────────────────────────

export type BracketTeam = {
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

export type SlotDef = {
  id: string;
  round: string;
  region: string; // "East", "Midwest", etc. or "FF" for Final Four
  slot: number; // 1-indexed within the round+region
  feederA: string | null; // slot ID that feeds team A
  feederB: string | null; // slot ID that feeds team B
  // For R64 only: the pre-assigned teams
  presetTeamAId?: number;
  presetTeamBId?: number;
};

export type PickState = Record<string, number>; // slotId → winnerId

// ── Constants ────────────────────────────────────────────────

export const ROUNDS = ["R64", "R32", "S16", "E8", "F4", "NCG"] as const;
export const REGIONS = ["East", "Midwest", "South", "West"] as const;

// Standard NCAA bracket seed matchups — adjacent pairs play each other
export const SEED_ORDER = [1, 16, 8, 9, 5, 12, 4, 13, 6, 11, 3, 14, 7, 10, 2, 15];

// Final Four pairings: East vs Midwest, South vs West
export const FF_PAIRINGS: [string, string][] = [
  ["East", "Midwest"],
  ["South", "West"],
];

export const ROUND_LABELS: Record<string, string> = {
  R64: "Round of 64",
  R32: "Round of 32",
  S16: "Sweet 16",
  E8: "Elite 8",
  F4: "Final Four",
  NCG: "Championship",
};

// ── Slot ID helpers ──────────────────────────────────────────

export function makeSlotId(round: string, region: string, slot: number): string {
  return `${round}-${region}-${slot}`;
}

// ── Build the full slot map ──────────────────────────────────

export function buildSlotMap(
  teams: BracketTeam[]
): Map<string, SlotDef> {
  const slots = new Map<string, SlotDef>();

  // Group teams by region and seed
  const regionSeeds = new Map<string, Map<number, BracketTeam>>();
  for (const t of teams) {
    if (!regionSeeds.has(t.region)) regionSeeds.set(t.region, new Map());
    regionSeeds.get(t.region)!.set(t.seed, t);
  }

  // For each region: create R64 → R32 → S16 → E8
  for (const region of REGIONS) {
    const seedMap = regionSeeds.get(region) ?? new Map();

    // R64: 8 matchups from SEED_ORDER pairs
    for (let i = 0; i < SEED_ORDER.length; i += 2) {
      const slot = (i / 2) + 1;
      const seedA = SEED_ORDER[i];
      const seedB = SEED_ORDER[i + 1];
      const teamA = seedMap.get(seedA);
      const teamB = seedMap.get(seedB);

      const id = makeSlotId("R64", region, slot);
      slots.set(id, {
        id,
        round: "R64",
        region,
        slot,
        feederA: null,
        feederB: null,
        presetTeamAId: teamA?.teamId,
        presetTeamBId: teamB?.teamId,
      });
    }

    // R32: 4 matchups, each fed by 2 adjacent R64 slots
    for (let s = 1; s <= 4; s++) {
      const id = makeSlotId("R32", region, s);
      slots.set(id, {
        id,
        round: "R32",
        region,
        slot: s,
        feederA: makeSlotId("R64", region, s * 2 - 1),
        feederB: makeSlotId("R64", region, s * 2),
      });
    }

    // S16: 2 matchups
    for (let s = 1; s <= 2; s++) {
      const id = makeSlotId("S16", region, s);
      slots.set(id, {
        id,
        round: "S16",
        region,
        slot: s,
        feederA: makeSlotId("R32", region, s * 2 - 1),
        feederB: makeSlotId("R32", region, s * 2),
      });
    }

    // E8: 1 matchup (region champion)
    const e8Id = makeSlotId("E8", region, 1);
    slots.set(e8Id, {
      id: e8Id,
      round: "E8",
      region,
      slot: 1,
      feederA: makeSlotId("S16", region, 1),
      feederB: makeSlotId("S16", region, 2),
    });
  }

  // Final Four: 2 semifinals
  for (let i = 0; i < FF_PAIRINGS.length; i++) {
    const [regionA, regionB] = FF_PAIRINGS[i];
    const id = makeSlotId("F4", "FF", i + 1);
    slots.set(id, {
      id,
      round: "F4",
      region: "FF",
      slot: i + 1,
      feederA: makeSlotId("E8", regionA, 1),
      feederB: makeSlotId("E8", regionB, 1),
    });
  }

  // NCG: 1 championship
  const ncgId = makeSlotId("NCG", "FF", 1);
  slots.set(ncgId, {
    id: ncgId,
    round: "NCG",
    region: "FF",
    slot: 1,
    feederA: makeSlotId("F4", "FF", 1),
    feederB: makeSlotId("F4", "FF", 2),
  });

  return slots;
}

// ── Resolve which teams occupy a slot based on current picks ─

export function resolveSlotTeams(
  slotId: string,
  slots: Map<string, SlotDef>,
  picks: PickState
): { teamAId: number | null; teamBId: number | null } {
  const slot = slots.get(slotId);
  if (!slot) return { teamAId: null, teamBId: null };

  if (slot.round === "R64") {
    return {
      teamAId: slot.presetTeamAId ?? null,
      teamBId: slot.presetTeamBId ?? null,
    };
  }

  // Later rounds: teams come from feeder winners
  const teamAId = slot.feederA ? (picks[slot.feederA] ?? null) : null;
  const teamBId = slot.feederB ? (picks[slot.feederB] ?? null) : null;
  return { teamAId, teamBId };
}

// ── Get all downstream slot IDs from a given slot ────────────

export function getDownstreamSlots(
  slotId: string,
  slots: Map<string, SlotDef>
): string[] {
  const downstream: string[] = [];

  // Find all slots that have this slot as a feeder
  for (const [id, def] of slots) {
    if (def.feederA === slotId || def.feederB === slotId) {
      downstream.push(id);
      downstream.push(...getDownstreamSlots(id, slots));
    }
  }

  return downstream;
}

// ── Cascade-clear picks when a pick changes ──────────────────

export function clearDownstreamPicks(
  slotId: string,
  eliminatedTeamId: number,
  picks: PickState,
  slots: Map<string, SlotDef>
): PickState {
  const newPicks = { ...picks };
  const downstream = getDownstreamSlots(slotId, slots);

  for (const dsId of downstream) {
    if (newPicks[dsId] === eliminatedTeamId) {
      delete newPicks[dsId];
    }
    // Also check if the eliminated team is now occupying a slot
    // and was picked to advance from there
    const { teamAId, teamBId } = resolveSlotTeams(dsId, slots, newPicks);
    if (teamAId == null && teamBId == null && newPicks[dsId]) {
      delete newPicks[dsId];
    }
  }

  return newPicks;
}

// ── Log5 win probability ─────────────────────────────────────

export function log5(barthagA: number, barthagB: number): number {
  const num = barthagA * (1 - barthagB);
  const den = num + barthagB * (1 - barthagA);
  if (den === 0) return 0.5;
  return num / den;
}

// ── Compute probability for any matchup ──────────────────────

export function computeProb(
  teamA: BracketTeam | undefined,
  teamB: BracketTeam | undefined
): number | null {
  if (!teamA?.barthag || !teamB?.barthag) return null;
  return log5(teamA.barthag, teamB.barthag);
}

// ── Count total picks ────────────────────────────────────────

export function countPicks(picks: PickState): number {
  return Object.keys(picks).length;
}

export const TOTAL_GAMES = 63; // 32 + 16 + 8 + 4 + 2 + 1
