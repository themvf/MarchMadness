"use client";

import { useState, useTransition } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getMatchupReview, type MatchupResult } from "./actions";

type TeamOption = {
  teamId: number;
  name: string;
  conference: string;
  logoUrl: string;
  rank: number | null;
};

export function MatchupClient({ teams }: { teams: TeamOption[] }) {
  const [teamAId, setTeamAId] = useState<number | "">("");
  const [teamBId, setTeamBId] = useState<number | "">("");
  const [result, setResult] = useState<MatchupResult | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleReview() {
    if (teamAId === "" || teamBId === "" || teamAId === teamBId) return;
    startTransition(async () => {
      const res = await getMatchupReview(Number(teamAId), Number(teamBId));
      setResult(res);
    });
  }

  return (
    <div className="space-y-6">
      {/* Team Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Select Teams</CardTitle>
          <CardDescription>
            Pick two teams to review their head-to-head game history
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="mb-1.5 block text-sm font-medium">
                Team A
              </label>
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={teamAId}
                onChange={(e) =>
                  setTeamAId(e.target.value ? Number(e.target.value) : "")
                }
              >
                <option value="">Select a team...</option>
                {teams.map((t) => (
                  <option key={t.teamId} value={t.teamId}>
                    #{t.rank} {t.name} ({t.conference})
                  </option>
                ))}
              </select>
            </div>

            <span className="hidden text-lg font-bold text-muted-foreground sm:block">
              vs
            </span>

            <div className="flex-1">
              <label className="mb-1.5 block text-sm font-medium">
                Team B
              </label>
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={teamBId}
                onChange={(e) =>
                  setTeamBId(e.target.value ? Number(e.target.value) : "")
                }
              >
                <option value="">Select a team...</option>
                {teams.map((t) => (
                  <option key={t.teamId} value={t.teamId}>
                    #{t.rank} {t.name} ({t.conference})
                  </option>
                ))}
              </select>
            </div>

            <Button
              onClick={handleReview}
              disabled={
                isPending ||
                teamAId === "" ||
                teamBId === "" ||
                teamAId === teamBId
              }
            >
              {isPending ? "Loading..." : "Review Matchup"}
            </Button>
          </div>
          {teamAId !== "" && teamBId !== "" && teamAId === teamBId && (
            <p className="mt-2 text-sm text-destructive">
              Please select two different teams.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Results */}
      {result && (
        <>
          {/* No games case */}
          {result.games.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                {result.teamA.name} and {result.teamB.name} have not played each
                other in any tracked season.
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Series Summary */}
              <Card>
                <CardHeader>
                  <CardTitle>Season Series</CardTitle>
                  <CardDescription>
                    {result.summary.totalGames} game
                    {result.summary.totalGames !== 1 ? "s" : ""} played
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Record display */}
                  <div className="flex items-center justify-center gap-6 py-2">
                    <div className="text-center">
                      <div className="flex items-center justify-center gap-2">
                        {result.teamA.logoUrl && (
                          <img
                            src={result.teamA.logoUrl}
                            alt=""
                            className="h-6 w-6 object-contain"
                          />
                        )}
                        <span className="text-sm font-medium">
                          {result.teamA.name}
                        </span>
                        {result.teamA.rank && (
                          <span className="text-xs text-muted-foreground">
                            #{result.teamA.rank}
                          </span>
                        )}
                      </div>
                      <div className="text-4xl font-bold mt-1">
                        {result.summary.teamAWins}
                      </div>
                    </div>

                    <span className="text-2xl text-muted-foreground">-</span>

                    <div className="text-center">
                      <div className="flex items-center justify-center gap-2">
                        {result.teamB.logoUrl && (
                          <img
                            src={result.teamB.logoUrl}
                            alt=""
                            className="h-6 w-6 object-contain"
                          />
                        )}
                        <span className="text-sm font-medium">
                          {result.teamB.name}
                        </span>
                        {result.teamB.rank && (
                          <span className="text-xs text-muted-foreground">
                            #{result.teamB.rank}
                          </span>
                        )}
                      </div>
                      <div className="text-4xl font-bold mt-1">
                        {result.summary.teamBWins}
                      </div>
                    </div>
                  </div>

                  {/* Model probability bar */}
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Model Win Probability</span>
                      <span className="text-muted-foreground">
                        Based on current Barthag ratings
                      </span>
                    </div>
                    <div className="flex h-8 w-full overflow-hidden rounded-full">
                      <div
                        className="flex items-center justify-center bg-blue-500 text-xs font-bold text-white transition-all"
                        style={{
                          width: `${result.summary.modelWinProbA * 100}%`,
                        }}
                      >
                        {result.summary.modelWinProbA >= 0.15 &&
                          `${(result.summary.modelWinProbA * 100).toFixed(0)}%`}
                      </div>
                      <div
                        className="flex items-center justify-center bg-red-500 text-xs font-bold text-white transition-all"
                        style={{
                          width: `${(1 - result.summary.modelWinProbA) * 100}%`,
                        }}
                      >
                        {1 - result.summary.modelWinProbA >= 0.15 &&
                          `${((1 - result.summary.modelWinProbA) * 100).toFixed(0)}%`}
                      </div>
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>
                        {result.teamA.name} (
                        {(result.summary.modelWinProbA * 100).toFixed(1)}%)
                      </span>
                      <span>
                        {result.teamB.name} (
                        {((1 - result.summary.modelWinProbA) * 100).toFixed(1)}
                        %)
                      </span>
                    </div>
                  </div>

                  {/* Quick stats */}
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-lg border p-3">
                      <div className="text-xs font-medium text-muted-foreground">
                        Avg Margin
                      </div>
                      <div className="mt-1 font-mono font-semibold">
                        {result.summary.avgMargin > 0 ? "+" : ""}
                        {result.summary.avgMargin.toFixed(1)} {result.teamA.name}
                      </div>
                    </div>
                    {result.summary.gamesWithSpread > 0 && (
                      <>
                        <div className="rounded-lg border p-3">
                          <div className="text-xs font-medium text-muted-foreground">
                            {result.teamA.name} ATS
                          </div>
                          <div className="mt-1 font-mono font-semibold">
                            {result.summary.teamACovers}-
                            {result.summary.teamBCovers}
                          </div>
                        </div>
                        <div className="rounded-lg border p-3">
                          <div className="text-xs font-medium text-muted-foreground">
                            {result.teamB.name} ATS
                          </div>
                          <div className="mt-1 font-mono font-semibold">
                            {result.summary.teamBCovers}-
                            {result.summary.teamACovers}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Edge Insight */}
              <Card
                className={
                  result.summary.edgeInsight.includes("Potential matchup edge")
                    ? "border-amber-400 dark:border-amber-600"
                    : ""
                }
              >
                <CardHeader>
                  <CardTitle className="text-base">Matchup Edge Analysis</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-relaxed">
                    {result.summary.edgeInsight}
                  </p>
                </CardContent>
              </Card>

              {/* Game-by-Game Table */}
              <Card>
                <CardHeader>
                  <CardTitle>Game Log</CardTitle>
                  <CardDescription>
                    All head-to-head results (from {result.teamA.name}
                    &apos;s perspective)
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Location</TableHead>
                          <TableHead className="text-right">
                            {result.teamA.name}
                          </TableHead>
                          <TableHead className="text-right">
                            {result.teamB.name}
                          </TableHead>
                          <TableHead className="text-right">Margin</TableHead>
                          {result.summary.gamesWithSpread > 0 && (
                            <>
                              <TableHead className="text-right">
                                Spread
                              </TableHead>
                              <TableHead className="text-center">
                                Cover
                              </TableHead>
                            </>
                          )}
                          <TableHead>Info</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {result.games.map((g) => (
                          <TableRow key={g.gameId}>
                            <TableCell className="font-mono text-sm">
                              {formatDate(g.date)}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs">
                                {g.location}
                              </Badge>
                            </TableCell>
                            <TableCell
                              className={`text-right font-mono ${
                                g.winner === "A" ? "font-bold" : ""
                              }`}
                            >
                              {g.teamAScore}
                            </TableCell>
                            <TableCell
                              className={`text-right font-mono ${
                                g.winner === "B" ? "font-bold" : ""
                              }`}
                            >
                              {g.teamBScore}
                            </TableCell>
                            <TableCell
                              className={`text-right font-mono ${
                                g.margin > 0
                                  ? "text-green-600"
                                  : "text-red-600"
                              }`}
                            >
                              {g.margin > 0 ? "+" : ""}
                              {g.margin}
                            </TableCell>
                            {result.summary.gamesWithSpread > 0 && (
                              <>
                                <TableCell className="text-right font-mono text-sm">
                                  {g.spreadTeamA != null
                                    ? `${g.spreadTeamA > 0 ? "+" : ""}${g.spreadTeamA.toFixed(1)}`
                                    : "\u2014"}
                                </TableCell>
                                <TableCell className="text-center">
                                  {g.coveredSpread != null ? (
                                    <Badge
                                      className={
                                        g.coveredSpread
                                          ? "bg-green-500 text-white hover:bg-green-600"
                                          : "bg-red-500 text-white hover:bg-red-600"
                                      }
                                    >
                                      {g.coveredSpread ? "YES" : "NO"}
                                    </Badge>
                                  ) : (
                                    "\u2014"
                                  )}
                                </TableCell>
                              </>
                            )}
                            <TableCell>
                              {g.isTournament && g.tournamentRound && (
                                <Badge variant="secondary" className="text-xs">
                                  {g.tournamentRound}
                                </Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
