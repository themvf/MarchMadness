export const dynamic = "force-dynamic";

import { getTeamRatings, getSeasonGames } from "@/db/queries";
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

type PowerEntry = {
  teamId: number;
  name: string;
  conference: string | null;
  logoUrl: string | null;
  torvikRank: number | null;
  wins: number;
  losses: number;
  homeWins: number;
  homeLosses: number;
  awayWins: number;
  awayLosses: number;
  neutralWins: number;
  neutralLosses: number;
  q1Wins: number;
  q1Losses: number;
  q2Wins: number;
  q2Losses: number;
  q3Wins: number;
  q3Losses: number;
  q4Wins: number;
  q4Losses: number;
  avgOppRank: number;
  sosRank: number;
  powerScore: number;
  powerRank: number;
};

function getQuadrant(oppRank: number | null): 1 | 2 | 3 | 4 {
  if (oppRank == null) return 4;
  if (oppRank <= 25) return 1;
  if (oppRank <= 50) return 2;
  if (oppRank <= 100) return 3;
  return 4;
}

export default async function PowerPage() {
  const [ratings, gameRows] = await Promise.all([
    getTeamRatings(),
    getSeasonGames(),
  ]);

  // Build lookup: teamId → rating info
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

  // Accumulate stats per team
  const stats = new Map<
    number,
    {
      wins: number;
      losses: number;
      homeWins: number;
      homeLosses: number;
      awayWins: number;
      awayLosses: number;
      neutralWins: number;
      neutralLosses: number;
      q1Wins: number;
      q1Losses: number;
      q2Wins: number;
      q2Losses: number;
      q3Wins: number;
      q3Losses: number;
      q4Wins: number;
      q4Losses: number;
      oppRanks: number[];
    }
  >();

  function getOrInit(teamId: number) {
    if (!stats.has(teamId)) {
      stats.set(teamId, {
        wins: 0, losses: 0,
        homeWins: 0, homeLosses: 0,
        awayWins: 0, awayLosses: 0,
        neutralWins: 0, neutralLosses: 0,
        q1Wins: 0, q1Losses: 0,
        q2Wins: 0, q2Losses: 0,
        q3Wins: 0, q3Losses: 0,
        q4Wins: 0, q4Losses: 0,
        oppRanks: [],
      });
    }
    return stats.get(teamId)!;
  }

  // Process every game
  for (const g of gameRows) {
    if (g.homeTeamId == null || g.awayTeamId == null) continue;
    if (g.homeScore == null || g.awayScore == null) continue;

    const homeWon = g.homeScore > g.awayScore;
    const isNeutral = g.isNeutralSite ?? false;

    // Home team perspective
    const homeStats = getOrInit(g.homeTeamId);
    const homeOppRank = teamInfo.get(g.awayTeamId)?.rank ?? null;
    const homeQ = getQuadrant(homeOppRank);
    if (homeOppRank != null) homeStats.oppRanks.push(homeOppRank);

    if (homeWon) {
      homeStats.wins++;
      if (isNeutral) homeStats.neutralWins++;
      else homeStats.homeWins++;
      if (homeQ === 1) homeStats.q1Wins++;
      else if (homeQ === 2) homeStats.q2Wins++;
      else if (homeQ === 3) homeStats.q3Wins++;
      else homeStats.q4Wins++;
    } else {
      homeStats.losses++;
      if (isNeutral) homeStats.neutralLosses++;
      else homeStats.homeLosses++;
      if (homeQ === 1) homeStats.q1Losses++;
      else if (homeQ === 2) homeStats.q2Losses++;
      else if (homeQ === 3) homeStats.q3Losses++;
      else homeStats.q4Losses++;
    }

    // Away team perspective
    const awayStats = getOrInit(g.awayTeamId);
    const awayOppRank = teamInfo.get(g.homeTeamId)?.rank ?? null;
    const awayQ = getQuadrant(awayOppRank);
    if (awayOppRank != null) awayStats.oppRanks.push(awayOppRank);

    if (!homeWon) {
      awayStats.wins++;
      if (isNeutral) awayStats.neutralWins++;
      else awayStats.awayWins++;
      if (awayQ === 1) awayStats.q1Wins++;
      else if (awayQ === 2) awayStats.q2Wins++;
      else if (awayQ === 3) awayStats.q3Wins++;
      else awayStats.q4Wins++;
    } else {
      awayStats.losses++;
      if (isNeutral) awayStats.neutralLosses++;
      else awayStats.awayLosses++;
      if (awayQ === 1) awayStats.q1Losses++;
      else if (awayQ === 2) awayStats.q2Losses++;
      else if (awayQ === 3) awayStats.q3Losses++;
      else awayStats.q4Losses++;
    }
  }

  // Build power entries (only for teams with ratings AND games)
  const entries: PowerEntry[] = [];
  for (const [teamId, s] of stats) {
    const info = teamInfo.get(teamId);
    if (!info) continue;
    if (s.wins + s.losses === 0) continue;

    const avgOppRank =
      s.oppRanks.length > 0
        ? s.oppRanks.reduce((a, b) => a + b, 0) / s.oppRanks.length
        : 999;

    // Power score: rewards quality wins, penalizes bad losses
    const powerScore =
      s.q1Wins * 5 +
      s.q2Wins * 3 +
      s.q3Wins * 1 -
      s.q3Losses * 2 -
      s.q4Losses * 5 +
      s.awayWins * 1 +
      s.neutralWins * 0.5;

    entries.push({
      teamId,
      name: info.name,
      conference: info.conference,
      logoUrl: info.logoUrl,
      torvikRank: info.rank,
      wins: s.wins,
      losses: s.losses,
      homeWins: s.homeWins,
      homeLosses: s.homeLosses,
      awayWins: s.awayWins,
      awayLosses: s.awayLosses,
      neutralWins: s.neutralWins,
      neutralLosses: s.neutralLosses,
      q1Wins: s.q1Wins,
      q1Losses: s.q1Losses,
      q2Wins: s.q2Wins,
      q2Losses: s.q2Losses,
      q3Wins: s.q3Wins,
      q3Losses: s.q3Losses,
      q4Wins: s.q4Wins,
      q4Losses: s.q4Losses,
      avgOppRank,
      sosRank: 0, // computed below
      powerScore,
      powerRank: 0, // computed below
    });
  }

  // Compute SOS rank (lower avg opponent rank = harder schedule = better SOS rank)
  const bySos = [...entries].sort((a, b) => a.avgOppRank - b.avgOppRank);
  bySos.forEach((e, i) => {
    e.sosRank = i + 1;
  });

  // Compute power rank
  entries.sort((a, b) => b.powerScore - a.powerScore);
  entries.forEach((e, i) => {
    e.powerRank = i + 1;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Power Rankings</h1>
        <p className="text-muted-foreground">
          Resume-based rankings from actual game results ({gameRows.length} games
          analyzed)
        </p>
      </div>

      {/* Legend */}
      <Card>
        <CardContent className="py-3">
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="font-medium">Quality Tiers:</span>
            <span>Q1 = vs Top 25</span>
            <span>Q2 = vs #26-50</span>
            <span>Q3 = vs #51-100</span>
            <span>Q4 = vs #101+</span>
            <span className="text-muted-foreground">|</span>
            <span>SOS = Strength of Schedule (avg opponent rank)</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All Teams ({entries.length})</CardTitle>
          <CardDescription>
            Sorted by power score. Compare Power# vs Torvik# to find
            over/under-valued teams.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Pwr#</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead>Conf</TableHead>
                  <TableHead className="text-right">Record</TableHead>
                  <TableHead className="text-right">Q1</TableHead>
                  <TableHead className="text-right">Q2</TableHead>
                  <TableHead className="text-right">Q3</TableHead>
                  <TableHead className="text-right">Q4</TableHead>
                  <TableHead className="text-right">SOS</TableHead>
                  <TableHead className="text-right">SOS#</TableHead>
                  <TableHead className="text-right">Torvik#</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => {
                  const rankDiff =
                    e.torvikRank != null
                      ? e.torvikRank - e.powerRank
                      : 0;
                  // Positive = power rank is better than Torvik (undervalued by ratings)
                  const highlight =
                    Math.abs(rankDiff) >= 15
                      ? rankDiff > 0
                        ? "bg-green-50 dark:bg-green-950/20"
                        : "bg-red-50 dark:bg-red-950/20"
                      : "";

                  return (
                    <TableRow key={e.teamId} className={highlight}>
                      <TableCell className="font-mono font-semibold">
                        {e.powerRank}
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
                      <TableCell className="text-right font-mono">
                        <span className={e.q1Wins > 0 ? "text-green-600 font-semibold" : ""}>
                          {e.q1Wins}
                        </span>
                        -
                        <span>{e.q1Losses}</span>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {e.q2Wins}-{e.q2Losses}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {e.q3Wins}-
                        <span className={e.q3Losses > 0 ? "text-orange-500" : ""}>
                          {e.q3Losses}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {e.q4Wins}-
                        <span className={e.q4Losses > 0 ? "text-red-600 font-semibold" : ""}>
                          {e.q4Losses}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {e.avgOppRank < 999 ? e.avgOppRank.toFixed(0) : "\u2014"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-muted-foreground">
                        {e.sosRank}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {e.torvikRank ?? "\u2014"}
                        {Math.abs(rankDiff) >= 10 && (
                          <span
                            className={`ml-1 text-xs ${
                              rankDiff > 0
                                ? "text-green-600"
                                : "text-red-600"
                            }`}
                          >
                            ({rankDiff > 0 ? "+" : ""}
                            {rankDiff})
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold">
                        {e.powerScore.toFixed(1)}
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
