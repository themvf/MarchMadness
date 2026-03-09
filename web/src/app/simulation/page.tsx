import { getSimulationResults, type SimRow } from "@/db/queries";
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

const ROUND_ORDER = ["R64", "R32", "S16", "E8", "F4", "NCG", "Champion"];
const ROUND_LABELS: Record<string, string> = {
  R64: "Rd 64",
  R32: "Rd 32",
  S16: "Sweet 16",
  E8: "Elite 8",
  F4: "Final Four",
  NCG: "Title Game",
  Champion: "Champion",
};

export default async function SimulationPage() {
  const rows = await getSimulationResults();

  if (rows.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Simulation Results
          </h1>
          <p className="text-muted-foreground">
            Monte Carlo tournament simulation probabilities
          </p>
        </div>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No simulation data available. Run the tournament simulator first.
          </CardContent>
        </Card>
      </div>
    );
  }

  // Pivot: group by team, with each round as a column
  const teamMap = new Map<
    number,
    { name: string; conference: string | null; seed: number | null; region: string | null; rounds: Record<string, number> }
  >();

  for (const row of rows) {
    if (!teamMap.has(row.teamId)) {
      teamMap.set(row.teamId, {
        name: row.name,
        conference: row.conference,
        seed: row.seed,
        region: row.region,
        rounds: {},
      });
    }
    teamMap.get(row.teamId)!.rounds[row.round] = row.advancementPct;
  }

  // Sort by championship probability descending
  const teams = Array.from(teamMap.entries())
    .map(([id, t]) => ({ id, ...t }))
    .sort((a, b) => (b.rounds["Champion"] ?? 0) - (a.rounds["Champion"] ?? 0));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Simulation Results
        </h1>
        <p className="text-muted-foreground">
          Advancement probabilities from Monte Carlo simulation ({teams.length}{" "}
          teams)
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Advancement Probability Matrix</CardTitle>
          <CardDescription>
            Each cell shows the probability of advancing to or past that round
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead className="text-center">Seed</TableHead>
                  <TableHead>Region</TableHead>
                  {ROUND_ORDER.map((r) => (
                    <TableHead key={r} className="text-right">
                      {ROUND_LABELS[r]}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {teams.map((t, i) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono text-muted-foreground">
                      {i + 1}
                    </TableCell>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell className="text-center">
                      {t.seed ?? "—"}
                    </TableCell>
                    <TableCell>{t.region ?? "—"}</TableCell>
                    {ROUND_ORDER.map((r) => {
                      const pct = t.rounds[r];
                      return (
                        <TableCell key={r} className="text-right font-mono">
                          {pct != null ? (
                            <span
                              className="inline-block rounded px-1.5 py-0.5"
                              style={{
                                backgroundColor: heatColor(pct),
                              }}
                            >
                              {(pct * 100).toFixed(1)}%
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/** Returns an rgba background color based on probability (0-1). */
function heatColor(pct: number): string {
  // Green intensity scales with probability
  const alpha = Math.min(pct * 0.8, 0.6);
  return `rgba(34, 197, 94, ${alpha.toFixed(2)})`;
}
