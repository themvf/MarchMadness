"use server";

import { getMatchupTeams, getHeadToHeadGames } from "@/db/queries";

/** Log5: converts two Barthag values into a head-to-head win probability. */
function log5(barthagA: number, barthagB: number): number {
  const num = barthagA * (1 - barthagB);
  const den = num + barthagB * (1 - barthagA);
  if (den === 0) return 0.5;
  return num / den;
}

export type MatchupGame = {
  gameId: string;
  date: string;
  season: number;
  teamAScore: number;
  teamBScore: number;
  winner: "A" | "B";
  margin: number; // positive = teamA won by this much
  location: "Home" | "Away" | "Neutral"; // from teamA's perspective
  isTournament: boolean;
  tournamentRound: string | null;
  spreadTeamA: number | null; // negative = teamA favored
  coveredSpread: boolean | null;
  impliedVegasProb: number | null; // teamA win prob from Vegas
};

export type MatchupResult = {
  teamA: {
    name: string;
    logoUrl: string | null;
    rank: number | null;
    barthag: number | null;
  };
  teamB: {
    name: string;
    logoUrl: string | null;
    rank: number | null;
    barthag: number | null;
  };
  games: MatchupGame[];
  summary: {
    totalGames: number;
    teamAWins: number;
    teamBWins: number;
    teamACovers: number;
    teamBCovers: number;
    gamesWithSpread: number;
    avgMargin: number;
    modelWinProbA: number;
    edgeInsight: string;
  };
};

export async function getMatchupReview(
  teamAId: number,
  teamBId: number
): Promise<MatchupResult> {
  const [allTeams, rawGames] = await Promise.all([
    getMatchupTeams(),
    getHeadToHeadGames(teamAId, teamBId),
  ]);

  const teamA = allTeams.find((t) => t.teamId === teamAId);
  const teamB = allTeams.find((t) => t.teamId === teamBId);
  if (!teamA || !teamB) throw new Error("Team not found");

  const barthagA = teamA.barthag ?? 0.5;
  const barthagB = teamB.barthag ?? 0.5;
  const modelWinProbA = log5(barthagA, barthagB);

  // Process each game from Team A's perspective
  const processedGames: MatchupGame[] = rawGames.map((g) => {
    const teamAIsHome = g.homeTeamId === teamAId;
    const teamAScore = teamAIsHome
      ? (g.homeScore ?? 0)
      : (g.awayScore ?? 0);
    const teamBScore = teamAIsHome
      ? (g.awayScore ?? 0)
      : (g.homeScore ?? 0);
    const margin = teamAScore - teamBScore;

    // Location from Team A's perspective
    let location: "Home" | "Away" | "Neutral" = teamAIsHome ? "Home" : "Away";
    if (g.isNeutralSite) location = "Neutral";

    // Spread from Team A's perspective (Vegas stores home perspective)
    let spreadTeamA: number | null = null;
    let coveredSpread: boolean | null = null;
    let impliedVegasProb: number | null = null;

    if (g.spread != null) {
      // g.spread is from home perspective (negative = home favored)
      spreadTeamA = teamAIsHome ? g.spread : -g.spread;
      // TeamA covers if their margin exceeds the spread
      // e.g., spread = -3 (teamA favored by 3), margin = 5 → covered
      coveredSpread = margin + spreadTeamA > 0;
    }

    if (g.impliedHomeProb != null) {
      impliedVegasProb = teamAIsHome
        ? g.impliedHomeProb
        : 1 - g.impliedHomeProb;
    }

    return {
      gameId: g.gameId,
      date: g.gameDate,
      season: g.season,
      teamAScore,
      teamBScore,
      winner: margin > 0 ? ("A" as const) : ("B" as const),
      margin,
      location,
      isTournament: g.isTournament ?? false,
      tournamentRound: g.tournamentRound,
      spreadTeamA,
      coveredSpread,
      impliedVegasProb,
    };
  });

  // Summary stats
  const teamAWins = processedGames.filter((g) => g.winner === "A").length;
  const teamBWins = processedGames.filter((g) => g.winner === "B").length;
  const gamesWithSpread = processedGames.filter(
    (g) => g.coveredSpread !== null
  ).length;
  const teamACovers = processedGames.filter(
    (g) => g.coveredSpread === true
  ).length;
  const teamBCovers = gamesWithSpread - teamACovers;
  const avgMargin =
    processedGames.length > 0
      ? processedGames.reduce((sum, g) => sum + g.margin, 0) /
        processedGames.length
      : 0;

  // Edge insight
  let edgeInsight: string;
  if (processedGames.length === 0) {
    edgeInsight = "These teams have not played each other in any tracked season.";
  } else if (processedGames.length === 1) {
    const g = processedGames[0];
    const winnerName = g.winner === "A" ? teamA.name : teamB.name;
    edgeInsight = `Only one meeting: ${winnerName} won by ${Math.abs(g.margin)}. Not enough data to identify a matchup edge.`;
  } else {
    const actualWinRateA = teamAWins / processedGames.length;
    const diff = actualWinRateA - modelWinProbA;

    if (Math.abs(diff) > 0.15) {
      // Significant divergence from model
      const betterTeam = diff > 0 ? teamA.name : teamB.name;
      const worseTeam = diff > 0 ? teamB.name : teamA.name;
      const actualPct = Math.round((diff > 0 ? actualWinRateA : 1 - actualWinRateA) * 100);
      const modelPct = Math.round((diff > 0 ? modelWinProbA : 1 - modelWinProbA) * 100);
      edgeInsight = `${betterTeam} has won ${diff > 0 ? teamAWins : teamBWins} of ${processedGames.length} games (${actualPct}%) despite the model giving them ${modelPct}%. Potential matchup edge over ${worseTeam}.`;
    } else {
      edgeInsight = `Results align with expectations. ${teamA.name} won ${teamAWins} of ${processedGames.length} (model predicted ${Math.round(modelWinProbA * 100)}% win rate).`;
    }

    // ATS insight
    if (gamesWithSpread >= 2) {
      const dominantCoverer =
        teamACovers > teamBCovers ? teamA.name : teamB.name;
      const coverCount = Math.max(teamACovers, teamBCovers);
      if (coverCount > gamesWithSpread / 2) {
        edgeInsight += ` ${dominantCoverer} has covered the spread in ${coverCount} of ${gamesWithSpread} games.`;
      }
    }
  }

  return {
    teamA: {
      name: teamA.name,
      logoUrl: teamA.logoUrl,
      rank: teamA.rank,
      barthag: teamA.barthag,
    },
    teamB: {
      name: teamB.name,
      logoUrl: teamB.logoUrl,
      rank: teamB.rank,
      barthag: teamB.barthag,
    },
    games: processedGames,
    summary: {
      totalGames: processedGames.length,
      teamAWins,
      teamBWins,
      teamACovers,
      teamBCovers,
      gamesWithSpread,
      avgMargin,
      modelWinProbA,
      edgeInsight,
    },
  };
}
