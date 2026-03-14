export const dynamic = "force-dynamic";

import {
  getGamesWithOdds,
  getTeamProfiles,
  type DivergenceRow,
} from "@/db/queries";
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
import { ArchetypeBadges } from "@/components/archetype-badges";

function log5(barthagA: number, barthagB: number): number {
  const num = barthagA * (1 - barthagB);
  const den = num + barthagB * (1 - barthagA);
  if (den === 0) return 0.5;
  return num / den;
}

type AnalyzedGame = Omit<DivergenceRow, "vegasProb"> & {
  vegasProb: number;
  modelProb: number;
  divergence: number;
  modelPick: boolean;
  vegasPick: boolean;
  homeWon: boolean;
  modelRight: boolean;
  vegasRight: boolean;
};

export default async function DivergencePage() {
  const [rows, profiles] = await Promise.all([
    getGamesWithOdds(),
    getTeamProfiles(),
  ]);

  if (rows.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Model vs Vegas
          </h1>
          <p className="text-muted-foreground">
            No games with odds data available.
          </p>
        </div>
      </div>
    );
  }

  // Analyze each game
  const analyzed: AnalyzedGame[] = rows.map((g) => {
    const hb = g.homeBarthag ?? 0.5;
    const ab = g.awayBarthag ?? 0.5;
    const modelProb = log5(hb, ab);
    const vegasProb = g.vegasProb ?? 0.5;
    const homeWon = (g.homeScore ?? 0) > (g.awayScore ?? 0);
    const modelPick = modelProb > 0.5;
    const vegasPick = vegasProb > 0.5;

    return {
      ...g,
      vegasProb,
      modelProb,
      divergence: modelProb - vegasProb,
      modelPick,
      vegasPick,
      homeWon,
      modelRight: modelPick === homeWon,
      vegasRight: vegasPick === homeWon,
    };
  });

  // Summary stats
  const total = analyzed.length;
  const modelCorrect = analyzed.filter((g) => g.modelRight).length;
  const vegasCorrect = analyzed.filter((g) => g.vegasRight).length;
  const disagreements = analyzed.filter((g) => g.modelPick !== g.vegasPick);
  const modelOnlyRight = analyzed.filter(
    (g) => g.modelRight && !g.vegasRight
  ).length;
  const vegasOnlyRight = analyzed.filter(
    (g) => g.vegasRight && !g.modelRight
  ).length;
  const bothWrong = analyzed.filter(
    (g) => !g.modelRight && !g.vegasRight
  ).length;

  // Biggest divergences (sorted by absolute divergence)
  const bigDivergences = [...analyzed]
    .filter((g) => Math.abs(g.divergence) > 0.08)
    .sort((a, b) => Math.abs(b.divergence) - Math.abs(a.divergence));

  // Top-50 disagreements
  const topTeamDisagreements = disagreements
    .filter(
      (g) =>
        Math.min(g.homeRank ?? 999, g.awayRank ?? 999) <= 50
    )
    .sort((a, b) => Math.abs(b.divergence) - Math.abs(a.divergence));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Model vs Vegas Divergence
        </h1>
        <p className="text-muted-foreground">
          Where our efficiency model disagrees with Vegas lines ({total.toLocaleString()}{" "}
          games analyzed)
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Our Model</CardDescription>
            <CardTitle className="text-3xl">
              {((modelCorrect / total) * 100).toFixed(1)}%
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {modelCorrect.toLocaleString()} / {total.toLocaleString()} correct
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Vegas</CardDescription>
            <CardTitle className="text-3xl">
              {((vegasCorrect / total) * 100).toFixed(1)}%
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {vegasCorrect.toLocaleString()} / {total.toLocaleString()} correct
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Our Edge</CardDescription>
            <CardTitle className="text-3xl text-green-500">
              +{(((modelCorrect - vegasCorrect) / total) * 100).toFixed(1)}%
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              +{modelCorrect - vegasCorrect} more games correct
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Disagreements</CardDescription>
            <CardTitle className="text-3xl">
              {disagreements.length}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Model: {modelOnlyRight} right | Vegas: {vegasOnlyRight} right
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Accuracy Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Agreement Breakdown</CardTitle>
          <CardDescription>
            How often the model and Vegas agree/disagree, and who wins
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-lg border bg-green-500/10 p-4 text-center">
              <div className="text-2xl font-bold">
                {(
                  ((total - disagreements.length - bothWrong) / total) *
                  100
                ).toFixed(0)}
                %
              </div>
              <div className="text-xs text-muted-foreground">
                Both Right
              </div>
              <div className="mt-1 text-sm font-medium text-green-600">
                Chalk picks
              </div>
            </div>
            <div className="rounded-lg border bg-blue-500/10 p-4 text-center">
              <div className="text-2xl font-bold">
                {((modelOnlyRight / total) * 100).toFixed(1)}%
              </div>
              <div className="text-xs text-muted-foreground">
                Only Model Right
              </div>
              <div className="mt-1 text-sm font-medium text-blue-600">
                Our edge
              </div>
            </div>
            <div className="rounded-lg border bg-orange-500/10 p-4 text-center">
              <div className="text-2xl font-bold">
                {((vegasOnlyRight / total) * 100).toFixed(1)}%
              </div>
              <div className="text-xs text-muted-foreground">
                Only Vegas Right
              </div>
              <div className="mt-1 text-sm font-medium text-orange-600">
                Their edge
              </div>
            </div>
            <div className="rounded-lg border bg-red-500/10 p-4 text-center">
              <div className="text-2xl font-bold">
                {((bothWrong / total) * 100).toFixed(1)}%
              </div>
              <div className="text-xs text-muted-foreground">
                Both Wrong
              </div>
              <div className="mt-1 text-sm font-medium text-red-600">
                True upsets
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Top-50 Disagreements */}
      <Card>
        <CardHeader>
          <CardTitle>Tournament-Relevant Disagreements</CardTitle>
          <CardDescription>
            Games involving Top-50 teams where model and Vegas picked differently
            ({topTeamDisagreements.length} games)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Home</TableHead>
                  <TableHead>Away</TableHead>
                  <TableHead className="text-center">Score</TableHead>
                  <TableHead className="text-right">Model</TableHead>
                  <TableHead className="text-right">Vegas</TableHead>
                  <TableHead className="text-right">Gap</TableHead>
                  <TableHead className="text-center">Winner</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topTeamDisagreements.slice(0, 50).map((g) => {
                  const modelFavorsHome = g.modelProb > 0.5;
                  const vegasFavorsHome = g.vegasProb > 0.5;

                  return (
                    <TableRow
                      key={g.gameId}
                      className={
                        g.modelRight && !g.vegasRight
                          ? "bg-green-500/5"
                          : !g.modelRight && g.vegasRight
                            ? "bg-orange-500/5"
                            : ""
                      }
                    >
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {g.gameDate}
                        {g.isNeutralSite ? " (N)" : ""}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {g.homeLogoUrl && (
                            <img
                              src={g.homeLogoUrl}
                              alt=""
                              className="h-5 w-5 object-contain"
                            />
                          )}
                          <span
                            className={
                              g.homeWon ? "font-bold" : "text-muted-foreground"
                            }
                          >
                            {g.homeName}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            #{g.homeRank}
                          </span>
                          <ArchetypeBadges
                            profile={profiles.get(g.homeTeamId!)}
                            max={1}
                          />
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {g.awayLogoUrl && (
                            <img
                              src={g.awayLogoUrl}
                              alt=""
                              className="h-5 w-5 object-contain"
                            />
                          )}
                          <span
                            className={
                              !g.homeWon ? "font-bold" : "text-muted-foreground"
                            }
                          >
                            {g.awayName}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            #{g.awayRank}
                          </span>
                          <ArchetypeBadges
                            profile={profiles.get(g.awayTeamId!)}
                            max={1}
                          />
                        </div>
                      </TableCell>
                      <TableCell className="text-center font-mono">
                        {g.homeScore}-{g.awayScore}
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={`font-mono text-sm ${
                            g.modelRight
                              ? "font-bold text-green-600"
                              : "text-red-500"
                          }`}
                        >
                          {modelFavorsHome
                            ? g.homeName?.split(" ").pop()
                            : g.awayName?.split(" ").pop()}{" "}
                          {(Math.max(g.modelProb, 1 - g.modelProb) * 100).toFixed(0)}%
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={`font-mono text-sm ${
                            g.vegasRight
                              ? "font-bold text-green-600"
                              : "text-red-500"
                          }`}
                        >
                          {vegasFavorsHome
                            ? g.homeName?.split(" ").pop()
                            : g.awayName?.split(" ").pop()}{" "}
                          {(Math.max(g.vegasProb, 1 - g.vegasProb) * 100).toFixed(0)}%
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        <span
                          className={
                            Math.abs(g.divergence) > 0.2
                              ? "font-bold text-yellow-600"
                              : "text-muted-foreground"
                          }
                        >
                          {(Math.abs(g.divergence) * 100).toFixed(0)}%
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        {g.modelRight && !g.vegasRight ? (
                          <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900 dark:text-green-300">
                            MODEL
                          </span>
                        ) : !g.modelRight && g.vegasRight ? (
                          <span className="rounded bg-orange-100 px-1.5 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-900 dark:text-orange-300">
                            VEGAS
                          </span>
                        ) : (
                          <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900 dark:text-red-300">
                            UPSET
                          </span>
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

      {/* All Big Divergences */}
      <Card>
        <CardHeader>
          <CardTitle>Biggest Divergences</CardTitle>
          <CardDescription>
            All games where model and Vegas probability gap exceeds 8%
            ({bigDivergences.length} games)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Matchup</TableHead>
                  <TableHead className="text-center">Score</TableHead>
                  <TableHead className="text-right">Model</TableHead>
                  <TableHead className="text-right">Vegas</TableHead>
                  <TableHead className="text-right">Gap</TableHead>
                  <TableHead className="text-center">Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bigDivergences.slice(0, 100).map((g) => {
                  const modelFavorsHome = g.modelProb > 0.5;
                  const vegasFavorsHome = g.vegasProb > 0.5;
                  const disagree = modelFavorsHome !== vegasFavorsHome;

                  return (
                    <TableRow
                      key={g.gameId}
                      className={
                        !disagree
                          ? ""
                          : g.modelRight && !g.vegasRight
                            ? "bg-green-500/5"
                            : !g.modelRight && g.vegasRight
                              ? "bg-orange-500/5"
                              : ""
                      }
                    >
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {g.gameDate}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {g.homeLogoUrl && (
                            <img
                              src={g.homeLogoUrl}
                              alt=""
                              className="h-4 w-4 object-contain"
                            />
                          )}
                          <span
                            className={
                              g.homeWon ? "font-bold" : "text-muted-foreground"
                            }
                          >
                            {g.homeName}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            ({g.homeRank})
                          </span>
                          <span className="mx-1 text-muted-foreground">vs</span>
                          {g.awayLogoUrl && (
                            <img
                              src={g.awayLogoUrl}
                              alt=""
                              className="h-4 w-4 object-contain"
                            />
                          )}
                          <span
                            className={
                              !g.homeWon ? "font-bold" : "text-muted-foreground"
                            }
                          >
                            {g.awayName}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            ({g.awayRank})
                          </span>
                          {g.isNeutralSite && (
                            <span className="ml-1 text-xs text-muted-foreground">
                              N
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-center font-mono text-sm">
                        {g.homeScore}-{g.awayScore}
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono text-sm ${
                          g.modelRight ? "text-green-600" : "text-red-500"
                        }`}
                      >
                        {(g.modelProb * 100).toFixed(0)}%
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono text-sm ${
                          g.vegasRight ? "text-green-600" : "text-red-500"
                        }`}
                      >
                        {(g.vegasProb * 100).toFixed(0)}%
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm font-bold text-yellow-600">
                        {(Math.abs(g.divergence) * 100).toFixed(0)}%
                      </TableCell>
                      <TableCell className="text-center">
                        {disagree ? (
                          g.modelRight ? (
                            <span className="text-xs font-medium text-green-600">
                              MODEL
                            </span>
                          ) : (
                            <span className="text-xs font-medium text-orange-600">
                              VEGAS
                            </span>
                          )
                        ) : g.modelRight ? (
                          <span className="text-xs text-muted-foreground">
                            agree
                          </span>
                        ) : (
                          <span className="text-xs text-red-500">upset</span>
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
