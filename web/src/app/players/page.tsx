export const dynamic = "force-dynamic";

import { getPlayerStats } from "@/db/queries";
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

function fmt(v: number | null, decimals = 1): string {
  if (v == null) return "\u2014";
  return v.toFixed(decimals);
}

function pct(v: number | null): string {
  if (v == null) return "\u2014";
  return v.toFixed(1) + "%";
}

export default async function PlayersPage({
  searchParams,
}: {
  searchParams: Promise<{ min?: string; sort?: string }>;
}) {
  const params = await searchParams;
  const minMinPct = Number(params.min ?? "40");
  const sortBy = params.sort ?? "ppg";

  const players = await getPlayerStats(2026, minMinPct);

  // Sort by selected column
  const sorted = [...players].sort((a, b) => {
    switch (sortBy) {
      case "ortg":
        return (b.ortg ?? 0) - (a.ortg ?? 0);
      case "usage":
        return (b.usageRate ?? 0) - (a.usageRate ?? 0);
      case "efg":
        return (b.efg ?? 0) - (a.efg ?? 0);
      case "ts":
        return (b.tsPct ?? 0) - (a.tsPct ?? 0);
      case "rpg":
        return (b.rpg ?? 0) - (a.rpg ?? 0);
      case "apg":
        return (b.apg ?? 0) - (a.apg ?? 0);
      case "obpm":
        return (b.obpm ?? 0) - (a.obpm ?? 0);
      case "3fg":
        return (b.threefgPct ?? 0) - (a.threefgPct ?? 0);
      case "ppg":
      default:
        return (b.ppg ?? 0) - (a.ppg ?? 0);
    }
  });

  // Stat leaders for summary cards
  const topScorer = sorted[0];
  const topEfficiency = [...players].sort(
    (a, b) => (b.ortg ?? 0) - (a.ortg ?? 0)
  )[0];
  const topUsage = [...players].sort(
    (a, b) => (b.usageRate ?? 0) - (a.usageRate ?? 0)
  )[0];
  const topThree = [...players].sort(
    (a, b) => (b.threefgPct ?? 0) - (a.threefgPct ?? 0)
  )[0];

  const sortOptions = [
    { key: "ppg", label: "PPG" },
    { key: "rpg", label: "RPG" },
    { key: "apg", label: "APG" },
    { key: "ortg", label: "ORtg" },
    { key: "usage", label: "Usage" },
    { key: "efg", label: "eFG%" },
    { key: "ts", label: "TS%" },
    { key: "obpm", label: "OBPM" },
    { key: "3fg", label: "3FG%" },
  ];

  const minOptions = [
    { val: "0", label: "All" },
    { val: "20", label: "20%+" },
    { val: "40", label: "40%+" },
    { val: "50", label: "50%+" },
    { val: "60", label: "60%+" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Player Stats</h1>
        <p className="text-muted-foreground">
          Advanced stats for {sorted.length.toLocaleString()} D1 players
          {minMinPct > 0 ? ` (min ${minMinPct}% minutes)` : ""} &mdash; 2025-26 season
        </p>
      </div>

      {/* Stat leader cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Scoring Leader</CardDescription>
            <CardTitle className="text-lg">{topScorer?.name}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{fmt(topScorer?.ppg)}</div>
            <p className="text-xs text-muted-foreground">
              PPG &mdash; {topScorer?.teamName}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Most Efficient</CardDescription>
            <CardTitle className="text-lg">{topEfficiency?.name}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{fmt(topEfficiency?.ortg)}</div>
            <p className="text-xs text-muted-foreground">
              ORtg &mdash; {topEfficiency?.teamName}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Highest Usage</CardDescription>
            <CardTitle className="text-lg">{topUsage?.name}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pct(topUsage?.usageRate)}</div>
            <p className="text-xs text-muted-foreground">
              Usage Rate &mdash; {topUsage?.teamName}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Best 3PT Shooter</CardDescription>
            <CardTitle className="text-lg">{topThree?.name}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pct(topThree?.threefgPct)}</div>
            <p className="text-xs text-muted-foreground">
              3FG% &mdash; {topThree?.teamName}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-3">
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="font-medium">Sort by:</span>
            <div className="flex flex-wrap gap-1">
              {sortOptions.map((opt) => (
                <a
                  key={opt.key}
                  href={`/players?sort=${opt.key}&min=${minMinPct}`}
                  className={`rounded px-2 py-1 ${
                    sortBy === opt.key
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {opt.label}
                </a>
              ))}
            </div>
            <span className="font-medium ml-2">Min%:</span>
            <div className="flex flex-wrap gap-1">
              {minOptions.map((opt) => (
                <a
                  key={opt.val}
                  href={`/players?sort=${sortBy}&min=${opt.val}`}
                  className={`rounded px-2 py-1 ${
                    String(minMinPct) === opt.val
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {opt.label}
                </a>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Player table */}
      <Card>
        <CardHeader>
          <CardTitle>
            Player Rankings ({sorted.length.toLocaleString()})
          </CardTitle>
          <CardDescription>
            Sorted by {sortOptions.find((o) => o.key === sortBy)?.label ?? "PPG"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>Player</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead>Pos</TableHead>
                  <TableHead className="text-center">Cl</TableHead>
                  <TableHead className="text-right">GP</TableHead>
                  <TableHead className="text-right">Min%</TableHead>
                  <TableHead className="text-right">PPG</TableHead>
                  <TableHead className="text-right">RPG</TableHead>
                  <TableHead className="text-right">APG</TableHead>
                  <TableHead className="text-right">ORtg</TableHead>
                  <TableHead className="text-right">USG%</TableHead>
                  <TableHead className="text-right">eFG%</TableHead>
                  <TableHead className="text-right">TS%</TableHead>
                  <TableHead className="text-right">3FG%</TableHead>
                  <TableHead className="text-right">FT%</TableHead>
                  <TableHead className="text-right">OBPM</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.slice(0, 200).map((p, i) => (
                  <TableRow key={p.playerId}>
                    <TableCell className="font-mono text-muted-foreground">
                      {i + 1}
                    </TableCell>
                    <TableCell>
                      <div>
                        <span className="font-medium">{p.name}</span>
                        {p.height && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            {p.height}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        {p.logoUrl && (
                          <img
                            src={p.logoUrl}
                            alt=""
                            className="h-4 w-4 object-contain"
                          />
                        )}
                        <span className="text-sm">{p.teamName}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {p.position ?? "\u2014"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center text-xs">
                      {p.class ?? "\u2014"}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {p.games ?? "\u2014"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {fmt(p.minPct)}
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono font-semibold ${
                        (p.ppg ?? 0) >= 20
                          ? "text-green-600"
                          : (p.ppg ?? 0) >= 15
                            ? "text-foreground"
                            : "text-muted-foreground"
                      }`}
                    >
                      {fmt(p.ppg)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {fmt(p.rpg)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {fmt(p.apg)}
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono text-sm ${
                        (p.ortg ?? 0) >= 120
                          ? "text-green-600"
                          : (p.ortg ?? 0) < 95
                            ? "text-red-500"
                            : ""
                      }`}
                    >
                      {fmt(p.ortg)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {fmt(p.usageRate)}
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono text-sm ${
                        (p.efg ?? 0) >= 55
                          ? "text-green-600"
                          : (p.efg ?? 0) < 45
                            ? "text-red-500"
                            : ""
                      }`}
                    >
                      {fmt(p.efg)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {fmt(p.tsPct)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {fmt(p.threefgPct)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {fmt(p.ftPct)}
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono text-sm ${
                        (p.obpm ?? 0) >= 6
                          ? "text-green-600"
                          : (p.obpm ?? 0) < 0
                            ? "text-red-500"
                            : ""
                      }`}
                    >
                      {fmt(p.obpm)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {sorted.length > 200 && (
              <p className="mt-2 text-center text-sm text-muted-foreground">
                Showing top 200 of {sorted.length.toLocaleString()} players
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
