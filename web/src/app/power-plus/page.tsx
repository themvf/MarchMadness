export const dynamic = "force-dynamic";

import { getTeamRatings, getSeasonGames, getTeamProfiles } from "@/db/queries";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ArchetypeBadges } from "@/components/archetype-badges";

type GameRecord = {
  opponentId: number;
  won: boolean;
};

type PlusPowerEntry = {
  teamId: number;
  name: string;
  conference: string | null;
  logoUrl: string | null;
  wins: number;
  losses: number;
  winPct: number;
  iterativeRating: number;
  plusRank: number;
  torvikRank: number | null;
  powerRankDelta: number; // plusRank vs static powerRank
  torvikDelta: number; // torvikRank - plusRank (positive = undervalued by Torvik)
  bestWin: { name: string; rank: number | null } | null;
  worstLoss: { name: string; rank: number | null } | null;
};

/**
 * Iterative Power Rating Algorithm
 *
 * Unlike the static Power Rankings (which use fixed Torvik rank tiers),
 * this algorithm computes team strength recursively — a win is worth more
 * if the opponent you beat has themselves beaten strong opponents.
 *
 * 1. Initialize each team's rating as their win percentage
 * 2. For 25 iterations:
 *    a. For each team, compute:
 *       - winCredit = average rating of teams they BEAT
 *       - lossCost = average rating of teams they LOST TO
 *       - scheduleStrength = average rating of ALL opponents
 *       - newRating = 0.25 * winPct + 0.40 * winCredit + 0.20 * scheduleStrength + 0.15 * (1 - lossCost)
 *    b. Normalize all ratings to [0, 1]
 * 3. Sort by final converged rating
 *
 * The recursive property: beating a team that beats good teams is worth
 * more than beating a team that only beats weak teams. This ripples through
 * the entire network of game results.
 */
function computeIterativeRatings(
  teamGames: Map<number, GameRecord[]>,
  iterations = 25
): Map<number, number> {
  const teamIds = Array.from(teamGames.keys());

  // Initialize with win percentage
  const rating = new Map<number, number>();
  for (const tid of teamIds) {
    const games = teamGames.get(tid)!;
    const wins = games.filter((g) => g.won).length;
    const total = games.length;
    // Laplace smoothing to avoid 0/1 extremes for teams with few games
    rating.set(tid, (wins + 1) / (total + 2));
  }

  // Iterate until convergence
  for (let iter = 0; iter < iterations; iter++) {
    const newRating = new Map<number, number>();

    for (const tid of teamIds) {
      const games = teamGames.get(tid)!;
      if (games.length === 0) {
        newRating.set(tid, 0);
        continue;
      }

      const wins = games.filter((g) => g.won);
      const losses = games.filter((g) => !g.won);
      const winPct = (wins.length + 1) / (games.length + 2);

      // Average rating of beaten opponents (credit for quality wins)
      const winCredit =
        wins.length > 0
          ? wins.reduce((sum, g) => sum + (rating.get(g.opponentId) ?? 0.5), 0) /
            wins.length
          : 0;

      // Average rating of teams that beat you (penalty for losing to weak teams)
      const lossCost =
        losses.length > 0
          ? losses.reduce(
              (sum, g) => sum + (rating.get(g.opponentId) ?? 0.5),
              0
            ) / losses.length
          : 0.5;

      // Overall schedule strength
      const scheduleStrength =
        games.reduce(
          (sum, g) => sum + (rating.get(g.opponentId) ?? 0.5),
          0
        ) / games.length;

      // Weighted composite
      const raw =
        0.25 * winPct +
        0.40 * winCredit * winPct + // credit for beating good teams, scaled by win%
        0.20 * scheduleStrength +
        0.15 * (1 - lossCost * (1 - winPct)); // penalty for losing to bad teams

      newRating.set(tid, raw);
    }

    // Normalize to [0, 1]
    const values = Array.from(newRating.values());
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    for (const tid of teamIds) {
      rating.set(tid, (newRating.get(tid)! - min) / range);
    }
  }

  return rating;
}

export default async function PowerPlusPage() {
  const [ratings, gameRows, profiles] = await Promise.all([
    getTeamRatings(),
    getSeasonGames(),
    getTeamProfiles(),
  ]);

  // Build team info lookup
  const teamInfo = new Map(
    ratings.map((t) => [
      t.teamId,
      {
        name: t.name,
        conference: t.conference,
        logoUrl: t.logoUrl,
        rank: t.rank,
        adjEm: t.adjEm,
      },
    ])
  );

  // Build game records per team
  const teamGames = new Map<number, GameRecord[]>();

  function ensureTeam(tid: number) {
    if (!teamGames.has(tid)) teamGames.set(tid, []);
  }

  // Also track best win / worst loss per team
  const bestWins = new Map<number, { oppId: number; oppRank: number }>();
  const worstLosses = new Map<number, { oppId: number; oppRank: number }>();

  for (const g of gameRows) {
    if (g.homeTeamId == null || g.awayTeamId == null) continue;
    if (g.homeScore == null || g.awayScore == null) continue;

    const homeWon = g.homeScore > g.awayScore;

    ensureTeam(g.homeTeamId);
    ensureTeam(g.awayTeamId);

    // Home team record
    teamGames.get(g.homeTeamId)!.push({
      opponentId: g.awayTeamId,
      won: homeWon,
    });

    // Away team record
    teamGames.get(g.awayTeamId)!.push({
      opponentId: g.homeTeamId,
      won: !homeWon,
    });

    // Track best wins / worst losses by opponent Torvik rank
    const homeOppRank = teamInfo.get(g.awayTeamId)?.rank;
    const awayOppRank = teamInfo.get(g.homeTeamId)?.rank;

    if (homeWon && homeOppRank != null) {
      const current = bestWins.get(g.homeTeamId);
      if (!current || homeOppRank < current.oppRank) {
        bestWins.set(g.homeTeamId, { oppId: g.awayTeamId, oppRank: homeOppRank });
      }
    }
    if (!homeWon && homeOppRank != null) {
      const current = worstLosses.get(g.homeTeamId);
      if (!current || homeOppRank > current.oppRank) {
        worstLosses.set(g.homeTeamId, { oppId: g.awayTeamId, oppRank: homeOppRank });
      }
    }
    if (!homeWon && awayOppRank != null) {
      const current = bestWins.get(g.awayTeamId);
      if (!current || awayOppRank < current.oppRank) {
        bestWins.set(g.awayTeamId, { oppId: g.homeTeamId, oppRank: awayOppRank });
      }
    }
    if (homeWon && awayOppRank != null) {
      const current = worstLosses.get(g.awayTeamId);
      if (!current || awayOppRank > current.oppRank) {
        worstLosses.set(g.awayTeamId, { oppId: g.homeTeamId, oppRank: awayOppRank });
      }
    }
  }

  // Run iterative algorithm
  const iterativeRatings = computeIterativeRatings(teamGames);

  // Also compute static power ranks for comparison
  const staticPowerScores = new Map<number, number>();
  for (const [tid, games] of teamGames) {
    const wins = games.filter((g) => g.won);
    let score = 0;
    for (const w of wins) {
      const oppRank = teamInfo.get(w.opponentId)?.rank ?? 999;
      if (oppRank <= 25) score += 5;
      else if (oppRank <= 50) score += 3;
      else if (oppRank <= 100) score += 1;
    }
    const losses = games.filter((g) => !g.won);
    for (const l of losses) {
      const oppRank = teamInfo.get(l.opponentId)?.rank ?? 999;
      if (oppRank > 100) score -= 5;
      else if (oppRank > 50) score -= 2;
    }
    staticPowerScores.set(tid, score);
  }
  const staticSorted = Array.from(staticPowerScores.entries()).sort(
    (a, b) => b[1] - a[1]
  );
  const staticRankMap = new Map(staticSorted.map(([tid], i) => [tid, i + 1]));

  // Build entries
  const entries: PlusPowerEntry[] = [];
  for (const [tid, iterRating] of iterativeRatings) {
    const info = teamInfo.get(tid);
    if (!info) continue;
    const games = teamGames.get(tid) ?? [];
    if (games.length === 0) continue;

    const wins = games.filter((g) => g.won).length;
    const losses = games.length - wins;

    const bw = bestWins.get(tid);
    const wl = worstLosses.get(tid);

    const staticRank = staticRankMap.get(tid) ?? 999;
    const torvikRank = info.rank;

    entries.push({
      teamId: tid,
      name: info.name,
      conference: info.conference,
      logoUrl: info.logoUrl,
      wins,
      losses,
      winPct: wins / games.length,
      iterativeRating: iterRating,
      plusRank: 0, // set below
      torvikRank,
      powerRankDelta: 0, // set below
      torvikDelta: 0, // set below
      bestWin: bw
        ? { name: teamInfo.get(bw.oppId)?.name ?? "?", rank: bw.oppRank }
        : null,
      worstLoss: wl
        ? { name: teamInfo.get(wl.oppId)?.name ?? "?", rank: wl.oppRank }
        : null,
    });
  }

  // Sort by iterative rating and assign ranks
  entries.sort((a, b) => b.iterativeRating - a.iterativeRating);
  entries.forEach((e, i) => {
    e.plusRank = i + 1;
    e.powerRankDelta = (staticRankMap.get(e.teamId) ?? 999) - e.plusRank;
    e.torvikDelta = (e.torvikRank ?? 999) - e.plusRank;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Power Rating Plus
        </h1>
        <p className="text-muted-foreground">
          Iterative recursive ranking &mdash; a win is worth more when the team
          you beat has itself beaten strong opponents ({gameRows.length} games,
          25 iterations)
        </p>
      </div>

      {/* How it works */}
      <Card>
        <CardContent className="py-3">
          <div className="text-sm space-y-1">
            <p>
              <span className="font-medium">How it differs from Power Rankings:</span>{" "}
              The standard Power page uses fixed Torvik rank tiers (Q1 = Top 25)
              to score wins. Power Plus computes its own tiers recursively — if
              Michigan beats Wisconsin, that makes Michigan a better win, which
              retroactively makes Duke&apos;s win over Michigan more valuable.
              The ratings ripple through the full network of game results until
              they stabilize.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Iterative Rankings ({entries.length} teams)</CardTitle>
          <CardDescription>
            Positive deltas mean the team ranks higher here than in the
            comparison system (undervalued there).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Plus#</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead>Conf</TableHead>
                  <TableHead className="text-right">Record</TableHead>
                  <TableHead className="text-right">Rating</TableHead>
                  <TableHead className="text-right">Torvik#</TableHead>
                  <TableHead className="text-right">vs Pwr#</TableHead>
                  <TableHead>Best Win</TableHead>
                  <TableHead>Worst Loss</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => {
                  const highlight =
                    Math.abs(e.torvikDelta) >= 15
                      ? e.torvikDelta > 0
                        ? "bg-green-50 dark:bg-green-950/20"
                        : "bg-red-50 dark:bg-red-950/20"
                      : "";

                  return (
                    <TableRow key={e.teamId} className={highlight}>
                      <TableCell className="font-mono font-semibold">
                        {e.plusRank}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {e.logoUrl && (
                            <img
                              src={e.logoUrl}
                              alt=""
                              className="h-5 w-5 object-contain"
                            />
                          )}
                          <span className="font-medium">{e.name}</span>
                          <ArchetypeBadges profile={profiles.get(e.teamId)} max={2} />
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {e.conference}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {e.wins}-{e.losses}
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold">
                        {e.iterativeRating.toFixed(3)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {e.torvikRank ?? "\u2014"}
                        {Math.abs(e.torvikDelta) >= 10 && (
                          <span
                            className={`ml-1 text-xs ${
                              e.torvikDelta > 0
                                ? "text-green-600"
                                : "text-red-600"
                            }`}
                          >
                            ({e.torvikDelta > 0 ? "+" : ""}
                            {e.torvikDelta})
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {e.powerRankDelta !== 0 && (
                          <span
                            className={
                              e.powerRankDelta > 0
                                ? "text-green-600"
                                : "text-red-600"
                            }
                          >
                            {e.powerRankDelta > 0 ? "+" : ""}
                            {e.powerRankDelta}
                          </span>
                        )}
                        {e.powerRankDelta === 0 && (
                          <span className="text-muted-foreground">=</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {e.bestWin ? (
                          <span>
                            <span className="font-medium text-green-600">
                              #{e.bestWin.rank}
                            </span>{" "}
                            {e.bestWin.name}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">\u2014</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {e.worstLoss ? (
                          <span>
                            <span
                              className={`font-medium ${
                                (e.worstLoss.rank ?? 0) > 100
                                  ? "text-red-600"
                                  : (e.worstLoss.rank ?? 0) > 50
                                    ? "text-orange-500"
                                    : ""
                              }`}
                            >
                              #{e.worstLoss.rank}
                            </span>{" "}
                            {e.worstLoss.name}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">\u2014</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
