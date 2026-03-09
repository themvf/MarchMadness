"use server";

import { getMatchupTeams, type MatchupTeam } from "@/db/queries";

export type SimulationResult = {
  teamA: { name: string; logoUrl: string | null; rank: number | null };
  teamB: { name: string; logoUrl: string | null; rank: number | null };
  winProbA: number;
  winProbB: number;
  projectedScore: { teamA: number; teamB: number };
  simResults: { winsA: number; winsB: number; nSims: number };
  edges: { offense: string; defense: string; tempo: string };
};

/**
 * Log5 formula: converts two Barthag values into a head-to-head win probability.
 *
 * P(A beats B) = (bA * (1 - bB)) / (bA * (1 - bB) + bB * (1 - bA))
 *
 * This is the same method KenPom/Torvik use for matchup predictions.
 */
function log5(barthagA: number, barthagB: number): number {
  const num = barthagA * (1 - barthagB);
  const den = num + barthagB * (1 - barthagA);
  if (den === 0) return 0.5;
  return num / den;
}

/** Estimate game score using AdjOE, AdjDE, and tempo. */
function projectScore(
  a: MatchupTeam,
  b: MatchupTeam
): { teamA: number; teamB: number } {
  // Average D1 efficiency is ~100 points per 100 possessions
  const avgEfficiency = 100;
  // Estimate possessions from average tempo
  const tempoA = a.adjTempo ?? 67;
  const tempoB = b.adjTempo ?? 67;
  const avgTempo = 67; // D1 average
  const possessions = ((tempoA + tempoB) / 2 / avgTempo) * 70; // ~70 actual possessions per game

  // Team A's points = their offense vs Team B's defense, adjusted
  const oeA = a.adjOe ?? avgEfficiency;
  const deB = b.adjDe ?? avgEfficiency;
  const scoreA = ((oeA + deB - avgEfficiency) / 100) * possessions;

  const oeB = b.adjOe ?? avgEfficiency;
  const deA = a.adjDe ?? avgEfficiency;
  const scoreB = ((oeB + deA - avgEfficiency) / 100) * possessions;

  return { teamA: Math.round(scoreA), teamB: Math.round(scoreB) };
}

export async function simulateMatchup(
  teamAId: number,
  teamBId: number,
  nSims = 1000
): Promise<SimulationResult> {
  const allTeams = await getMatchupTeams();
  const teamA = allTeams.find((t) => t.teamId === teamAId);
  const teamB = allTeams.find((t) => t.teamId === teamBId);

  if (!teamA || !teamB) {
    throw new Error("Team not found");
  }

  const barthagA = teamA.barthag ?? 0.5;
  const barthagB = teamB.barthag ?? 0.5;
  const winProbA = log5(barthagA, barthagB);

  // Run Monte Carlo simulation
  let winsA = 0;
  for (let i = 0; i < nSims; i++) {
    if (Math.random() < winProbA) winsA++;
  }

  const projected = projectScore(teamA, teamB);

  // Determine edges
  const edges = {
    offense:
      (teamA.adjOe ?? 0) > (teamB.adjOe ?? 0) ? teamA.name : teamB.name,
    defense:
      (teamA.adjDe ?? 999) < (teamB.adjDe ?? 999) ? teamA.name : teamB.name,
    tempo:
      Math.abs((teamA.adjTempo ?? 67) - (teamB.adjTempo ?? 67)) < 1
        ? "Even"
        : (teamA.adjTempo ?? 67) > (teamB.adjTempo ?? 67)
          ? `${teamA.name} (faster)`
          : `${teamB.name} (faster)`,
  };

  return {
    teamA: {
      name: teamA.name,
      logoUrl: teamA.logoUrl,
      rank: teamA.rank,
    },
    teamB: {
      name: teamB.name,
      logoUrl: teamB.logoUrl,
      rank: teamB.rank,
    },
    winProbA,
    winProbB: 1 - winProbA,
    projectedScore: projected,
    simResults: { winsA, winsB: nSims - winsA, nSims },
    edges,
  };
}
