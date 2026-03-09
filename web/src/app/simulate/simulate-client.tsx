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
import { Separator } from "@/components/ui/separator";
import { simulateMatchup, type SimulationResult } from "./actions";

type TeamOption = {
  teamId: number;
  name: string;
  conference: string;
  logoUrl: string;
  rank: number | null;
};

export function SimulateClient({ teams }: { teams: TeamOption[] }) {
  const [teamAId, setTeamAId] = useState<number | "">("");
  const [teamBId, setTeamBId] = useState<number | "">("");
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSimulate() {
    if (teamAId === "" || teamBId === "" || teamAId === teamBId) return;
    startTransition(async () => {
      const res = await simulateMatchup(Number(teamAId), Number(teamBId));
      setResult(res);
    });
  }

  return (
    <div className="space-y-6">
      {/* Team Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Select Matchup</CardTitle>
          <CardDescription>
            Choose two teams to simulate a head-to-head game
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
              onClick={handleSimulate}
              disabled={
                isPending ||
                teamAId === "" ||
                teamBId === "" ||
                teamAId === teamBId
              }
            >
              {isPending ? "Simulating..." : "Simulate"}
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
          {/* Win Probability */}
          <Card>
            <CardHeader>
              <CardTitle>Win Probability</CardTitle>
              <CardDescription>
                Based on Log5 formula using Barthag ratings
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Probability bar */}
              <div className="space-y-2">
                <div className="flex justify-between text-sm font-medium">
                  <span className="flex items-center gap-2">
                    {result.teamA.logoUrl && (
                      <img
                        src={result.teamA.logoUrl}
                        alt=""
                        className="h-5 w-5 object-contain"
                      />
                    )}
                    {result.teamA.name}
                    {result.teamA.rank && (
                      <span className="text-muted-foreground">
                        #{result.teamA.rank}
                      </span>
                    )}
                  </span>
                  <span className="font-mono text-lg">
                    {(result.winProbA * 100).toFixed(1)}%
                  </span>
                </div>

                <div className="flex h-8 w-full overflow-hidden rounded-full">
                  <div
                    className="flex items-center justify-center bg-blue-500 text-xs font-bold text-white transition-all"
                    style={{ width: `${result.winProbA * 100}%` }}
                  >
                    {result.winProbA >= 0.15 &&
                      `${(result.winProbA * 100).toFixed(0)}%`}
                  </div>
                  <div
                    className="flex items-center justify-center bg-red-500 text-xs font-bold text-white transition-all"
                    style={{ width: `${result.winProbB * 100}%` }}
                  >
                    {result.winProbB >= 0.15 &&
                      `${(result.winProbB * 100).toFixed(0)}%`}
                  </div>
                </div>

                <div className="flex justify-between text-sm font-medium">
                  <span className="flex items-center gap-2">
                    {result.teamB.logoUrl && (
                      <img
                        src={result.teamB.logoUrl}
                        alt=""
                        className="h-5 w-5 object-contain"
                      />
                    )}
                    {result.teamB.name}
                    {result.teamB.rank && (
                      <span className="text-muted-foreground">
                        #{result.teamB.rank}
                      </span>
                    )}
                  </span>
                  <span className="font-mono text-lg">
                    {(result.winProbB * 100).toFixed(1)}%
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Simulation + Score Projection side by side */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Monte Carlo Simulation</CardTitle>
                <CardDescription>
                  {result.simResults.nSims.toLocaleString()} games simulated
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{result.teamA.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-lg font-bold">
                        {result.simResults.winsA}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        wins
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{result.teamB.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-lg font-bold">
                        {result.simResults.winsB}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        wins
                      </span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Projected Score</CardTitle>
                <CardDescription>
                  Based on offensive/defensive efficiency and tempo
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-center gap-6 py-2">
                  <div className="text-center">
                    <div className="text-sm font-medium text-muted-foreground">
                      {result.teamA.name}
                    </div>
                    <div className="text-4xl font-bold">
                      {result.projectedScore.teamA}
                    </div>
                  </div>
                  <span className="text-2xl text-muted-foreground">-</span>
                  <div className="text-center">
                    <div className="text-sm font-medium text-muted-foreground">
                      {result.teamB.name}
                    </div>
                    <div className="text-4xl font-bold">
                      {result.projectedScore.teamB}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Matchup Edges */}
          <Card>
            <CardHeader>
              <CardTitle>Matchup Edges</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border p-3">
                  <div className="text-xs font-medium text-muted-foreground">
                    Offensive Edge
                  </div>
                  <div className="mt-1 font-semibold">{result.edges.offense}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs font-medium text-muted-foreground">
                    Defensive Edge
                  </div>
                  <div className="mt-1 font-semibold">{result.edges.defense}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs font-medium text-muted-foreground">
                    Tempo
                  </div>
                  <div className="mt-1 font-semibold">{result.edges.tempo}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
