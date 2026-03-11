/**
 * Archetype derivation from team player-derived profiles.
 *
 * Each archetype represents a tournament-relevant trait. Teams typically
 * receive 2-4 archetypes that describe their roster composition and
 * tournament vulnerability profile.
 *
 * Thresholds are set relative to the D1 population distribution (365 teams).
 */

import type { TeamProfileRow } from "@/db/queries";

export type Archetype = {
  label: string;
  /** "strength" = green, "risk" = red, "style" = gray */
  kind: "strength" | "risk" | "style";
  /** Short tooltip explanation */
  tip: string;
};

/**
 * Derive tournament-relevant archetypes from a team's player-derived profile.
 */
export function getArchetypes(profile: TeamProfileRow | undefined): Archetype[] {
  if (!profile) return [];

  const archetypes: Archetype[] = [];
  const exp = profile.experienceIdx ?? 2.5;
  const star = profile.starConcentration ?? 40;
  const gap = profile.depthGap ?? 0;
  const ft = profile.ftReliability ?? 0.72;
  const three = profile.threePtRate ?? 39;
  const tov = profile.tovDiscipline ?? 16;
  const bal = profile.scoringBalance ?? 3;
  const guard = profile.guardQuality ?? 10;
  const fr = profile.freshmanMinutesPct ?? 14;
  const reb = profile.reboundConcentration ?? 21;

  // ── Strengths (green) ──────────────────────────────────
  if (exp >= 3.2 && fr < 15) {
    archetypes.push({
      label: "Veteran",
      kind: "strength",
      tip: `Experience ${exp.toFixed(1)} — upperclassmen-heavy rotation`,
    });
  }

  if (bal >= 5) {
    archetypes.push({
      label: "Balanced",
      kind: "strength",
      tip: `${bal} double-digit scorers — hard to game-plan`,
    });
  }

  if (tov < 13) {
    archetypes.push({
      label: "Disciplined",
      kind: "strength",
      tip: `${tov.toFixed(1)}% TOV rate — handles pressure defense`,
    });
  }

  if (gap < -3) {
    archetypes.push({
      label: "Deep",
      kind: "strength",
      tip: `Bench ORtg ${Math.abs(gap).toFixed(0)}pts above starters — survives foul trouble`,
    });
  }

  if (ft >= 0.76) {
    archetypes.push({
      label: "Clutch FT",
      kind: "strength",
      tip: `${(ft * 100).toFixed(0)}% FT — wins close games at the line`,
    });
  }

  if (guard >= 25) {
    archetypes.push({
      label: "Elite Guard",
      kind: "strength",
      tip: `Guard quality ${guard.toFixed(0)} — floor general controls tempo`,
    });
  }

  // ── Risks (red) ────────────────────────────────────────
  if (fr >= 30) {
    archetypes.push({
      label: "Youth Movement",
      kind: "risk",
      tip: `${fr.toFixed(0)}% freshman minutes — moment could be too big`,
    });
  }

  if (star >= 44) {
    archetypes.push({
      label: "Star-Driven",
      kind: "risk",
      tip: `Top 2 account for ${star.toFixed(0)}% of scoring — one bad night = done`,
    });
  }

  if (gap >= 14) {
    archetypes.push({
      label: "Top-Heavy",
      kind: "risk",
      tip: `${gap.toFixed(0)}pt ORtg drop to bench — foul trouble is devastating`,
    });
  }

  if (three >= 48) {
    archetypes.push({
      label: "Perimeter",
      kind: "risk",
      tip: `${three.toFixed(0)}% of shots from 3 — live by it, die by it`,
    });
  }

  if (ft < 0.69) {
    archetypes.push({
      label: "FT Liability",
      kind: "risk",
      tip: `${(ft * 100).toFixed(0)}% FT — vulnerable in close games`,
    });
  }

  if (tov >= 17.5) {
    archetypes.push({
      label: "Turnover-Prone",
      kind: "risk",
      tip: `${tov.toFixed(1)}% TOV rate — pressure defense will feast`,
    });
  }

  // ── Style (gray) — only if no strengths/risks assigned ─
  if (three < 30) {
    archetypes.push({
      label: "Interior",
      kind: "style",
      tip: `Only ${three.toFixed(0)}% of shots from 3 — post-oriented attack`,
    });
  }

  return archetypes;
}

/**
 * CSS classes for archetype badge variants.
 */
export function archetypeBadgeClass(kind: Archetype["kind"]): string {
  switch (kind) {
    case "strength":
      return "bg-green-100 text-green-800 border-green-300 dark:bg-green-950 dark:text-green-300 dark:border-green-800";
    case "risk":
      return "bg-red-100 text-red-800 border-red-300 dark:bg-red-950 dark:text-red-300 dark:border-red-800";
    case "style":
      return "bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600";
  }
}
