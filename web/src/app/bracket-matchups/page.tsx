export const dynamic = "force-dynamic";

import {
  getBracketMatchups,
  type BracketMatchupRow,
} from "@/db/queries";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const ROUND_LABELS: Record<string, string> = {
  R64: "Round of 64",
  R32: "Round of 32",
  S16: "Sweet 16",
  E8: "Elite 8",
  F4: "Final Four",
  NCG: "Championship",
};

const ROUND_ORDER = ["R64", "R32", "S16", "E8", "F4", "NCG"];

function ProbBar({
  probA,
  label,
  className,
}: {
  probA: number;
  label: string;
  className?: string;
}) {
  const pctA = Math.round(probA * 100);
  const pctB = 100 - pctA;
  return (
    <div className={className}>
      <div className="mb-0.5 text-[10px] text-muted-foreground">{label}</div>
      <div className="flex h-4 w-full overflow-hidden rounded-full bg-muted text-[10px] font-medium">
        <div
          className="flex items-center justify-center bg-blue-500 text-white transition-all"
          style={{ width: `${pctA}%` }}
        >
          {pctA > 15 && `${pctA}%`}
        </div>
        <div
          className="flex items-center justify-center bg-red-400 text-white transition-all"
          style={{ width: `${pctB}%` }}
        >
          {pctB > 15 && `${pctB}%`}
        </div>
      </div>
    </div>
  );
}

function MatchupCard({ m }: { m: BracketMatchupRow }) {
  const modelProb = m.modelProbA;
  const vegasProb = m.vegasProbA;
  const hasVegas = vegasProb != null;
  const hasModel = modelProb != null;

  const divergence =
    hasModel && hasVegas ? (modelProb! - vegasProb!) * 100 : null;

  const modelFavorsA = hasModel && modelProb! > 0.5;
  const vegasFavorsA = hasVegas && vegasProb! > 0.5;
  const disagree = hasModel && hasVegas && modelFavorsA !== vegasFavorsA;

  const played = m.winnerId != null;
  const aWon = played && m.winnerId === m.teamAId;

  return (
    <div
      className={`rounded-lg border p-3 ${
        played
          ? "bg-muted/30"
          : disagree
            ? "border-yellow-500/50 bg-yellow-500/5"
            : ""
      }`}
    >
      {/* Teams */}
      <div className="space-y-2">
        {/* Team A (higher seed) */}
        <div className="flex items-center gap-2">
          <span className="w-5 text-right font-mono text-xs font-bold text-muted-foreground">
            {m.seedA}
          </span>
          {m.teamALogo && (
            <img
              src={m.teamALogo}
              alt=""
              className="h-6 w-6 object-contain"
            />
          )}
          <span
            className={`flex-1 text-sm font-medium ${
              played && !aWon ? "text-muted-foreground line-through" : ""
            } ${played && aWon ? "font-bold" : ""}`}
          >
            {m.teamAName}
          </span>
          <Badge variant="outline" className="text-[10px]">
            {m.teamAConf}
          </Badge>
          {played && (
            <span className="font-mono text-sm font-bold">{m.scoreA}</span>
          )}
        </div>

        {/* Team B (lower seed) */}
        <div className="flex items-center gap-2">
          <span className="w-5 text-right font-mono text-xs font-bold text-muted-foreground">
            {m.seedB}
          </span>
          {m.teamBLogo && (
            <img
              src={m.teamBLogo}
              alt=""
              className="h-6 w-6 object-contain"
            />
          )}
          <span
            className={`flex-1 text-sm font-medium ${
              played && aWon ? "text-muted-foreground line-through" : ""
            } ${played && !aWon ? "font-bold" : ""}`}
          >
            {m.teamBName}
          </span>
          <Badge variant="outline" className="text-[10px]">
            {m.teamBConf}
          </Badge>
          {played && (
            <span className="font-mono text-sm font-bold">{m.scoreB}</span>
          )}
        </div>
      </div>

      {/* Probability Bars */}
      {hasModel && (
        <div className="mt-3 space-y-1.5">
          <ProbBar probA={modelProb!} label="Model" />
          {hasVegas && <ProbBar probA={vegasProb!} label="Vegas" />}
        </div>
      )}

      {/* Spread + Divergence Footer */}
      <div className="mt-2 flex items-center justify-between text-xs">
        <div className="text-muted-foreground">
          {m.vegasSpreadA != null && (
            <span>
              Spread: {m.vegasSpreadA > 0 ? "+" : ""}
              {m.vegasSpreadA!.toFixed(1)}
            </span>
          )}
          {m.vegasTotal != null && (
            <span className="ml-2">O/U: {m.vegasTotal!.toFixed(1)}</span>
          )}
        </div>
        {divergence != null && (
          <span
            className={`font-medium ${
              Math.abs(divergence) > 5
                ? divergence > 0
                  ? "text-green-600"
                  : "text-red-500"
                : "text-muted-foreground"
            }`}
          >
            {divergence > 0 ? "+" : ""}
            {divergence.toFixed(1)}% gap
          </span>
        )}
        {disagree && (
          <Badge className="bg-yellow-500 text-[10px] text-white">
            DISAGREE
          </Badge>
        )}
      </div>
    </div>
  );
}

export default async function BracketMatchupsPage() {
  const matchups = await getBracketMatchups();

  if (matchups.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Tournament Matchups
          </h1>
          <p className="text-muted-foreground">
            Model predictions vs Vegas odds for every tournament game
          </p>
        </div>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No matchup data available. Matchups will appear after the bracket is
            ingested and predictions are computed.
          </CardContent>
        </Card>
      </div>
    );
  }

  // Group by round
  const rounds = new Map<string, BracketMatchupRow[]>();
  for (const m of matchups) {
    if (!rounds.has(m.round)) rounds.set(m.round, []);
    rounds.get(m.round)!.push(m);
  }

  // Compute summary stats
  const withBoth = matchups.filter(
    (m) => m.modelProbA != null && m.vegasProbA != null
  );
  const disagreements = withBoth.filter((m) => {
    const mA = m.modelProbA! > 0.5;
    const vA = m.vegasProbA! > 0.5;
    return mA !== vA;
  });
  const avgDivergence =
    withBoth.length > 0
      ? withBoth.reduce(
          (sum, m) => sum + Math.abs(m.modelProbA! - m.vegasProbA!),
          0
        ) / withBoth.length
      : 0;
  const upsetAlerts = matchups.filter(
    (m) => m.modelProbA != null && m.modelProbA! < 0.65 && m.seedA <= 4
  );

  // Find largest divergence
  let biggestDiv: BracketMatchupRow | null = null;
  let biggestDivAmt = 0;
  for (const m of withBoth) {
    const d = Math.abs(m.modelProbA! - m.vegasProbA!);
    if (d > biggestDivAmt) {
      biggestDivAmt = d;
      biggestDiv = m;
    }
  }

  // Which rounds are available
  const availableRounds = ROUND_ORDER.filter((r) => rounds.has(r));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Tournament Matchups
        </h1>
        <p className="text-muted-foreground">
          Model predictions vs Vegas odds for every tournament game (
          {matchups.length} matchups)
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Matchups</CardDescription>
            <CardTitle className="text-3xl">{matchups.length}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {availableRounds.map((r) => ROUND_LABELS[r] || r).join(", ")}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Disagreements</CardDescription>
            <CardTitle className="text-3xl text-yellow-500">
              {disagreements.length}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Model and Vegas pick different winners
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Avg Divergence</CardDescription>
            <CardTitle className="text-3xl">
              {(avgDivergence * 100).toFixed(1)}%
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Mean probability gap across all matchups
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Upset Alerts</CardDescription>
            <CardTitle className="text-3xl text-red-500">
              {upsetAlerts.length}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Top-4 seeds with {"<"}65% model win probability
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Biggest Divergence Callout */}
      {biggestDiv && (
        <Card className="border-yellow-500/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Biggest Divergence
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              {biggestDiv.teamALogo && (
                <img
                  src={biggestDiv.teamALogo}
                  alt=""
                  className="h-8 w-8 object-contain"
                />
              )}
              <span className="font-medium">
                #{biggestDiv.seedA} {biggestDiv.teamAName}
              </span>
              <span className="text-muted-foreground">vs</span>
              {biggestDiv.teamBLogo && (
                <img
                  src={biggestDiv.teamBLogo}
                  alt=""
                  className="h-8 w-8 object-contain"
                />
              )}
              <span className="font-medium">
                #{biggestDiv.seedB} {biggestDiv.teamBName}
              </span>
              <span className="ml-auto font-mono text-lg font-bold text-yellow-600">
                {(biggestDivAmt * 100).toFixed(1)}% gap
              </span>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Model: {((biggestDiv.modelProbA ?? 0.5) * 100).toFixed(0)}%{" "}
              {biggestDiv.teamAName} | Vegas:{" "}
              {((biggestDiv.vegasProbA ?? 0.5) * 100).toFixed(0)}%{" "}
              {biggestDiv.teamAName}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Matchups by Round */}
      {availableRounds.map((roundKey) => {
        const roundMatchups = rounds.get(roundKey)!;

        // Group by region within the round
        const byRegion = new Map<string, BracketMatchupRow[]>();
        for (const m of roundMatchups) {
          const region = m.region || "Final";
          if (!byRegion.has(region)) byRegion.set(region, []);
          byRegion.get(region)!.push(m);
        }

        const regionNames = Array.from(byRegion.keys()).sort();

        return (
          <Card key={roundKey}>
            <CardHeader>
              <CardTitle>{ROUND_LABELS[roundKey] || roundKey}</CardTitle>
              <CardDescription>
                {roundMatchups.length} matchups
                {roundMatchups.some((m) => m.winnerId) &&
                  ` (${roundMatchups.filter((m) => m.winnerId).length} completed)`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {regionNames.map((region) => (
                  <div key={region}>
                    {regionNames.length > 1 && (
                      <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
                        {region}
                      </h3>
                    )}
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      {byRegion.get(region)!.map((m) => (
                        <MatchupCard key={m.id} m={m} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
