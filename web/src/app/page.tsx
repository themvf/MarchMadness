import { getDashboardStats, getSimulationResults } from "@/db/queries";
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

export default async function DashboardPage() {
  const [stats, simRows] = await Promise.all([
    getDashboardStats(),
    getSimulationResults(),
  ]);

  // Get championship probabilities (round = "Champion")
  const champRows = simRows
    .filter((r) => r.round === "Champion")
    .sort((a, b) => b.advancementPct - a.advancementPct)
    .slice(0, 16);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          NCAA Tournament prediction and bracket strategy
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Teams Rated" value={stats.teams} />
        <StatCard title="Games Tracked" value={stats.games} />
        <StatCard title="Bracket Teams" value={stats.bracketTeams} />
        <StatCard title="Simulated Teams" value={stats.simulatedTeams} />
      </div>

      {/* Top Championship Contenders */}
      {champRows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Championship Contenders</CardTitle>
            <CardDescription>
              Top 16 teams by simulated championship probability
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead>Conference</TableHead>
                  <TableHead className="text-center">Seed</TableHead>
                  <TableHead>Region</TableHead>
                  <TableHead className="text-right">Win %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {champRows.map((row, i) => (
                  <TableRow key={row.teamId}>
                    <TableCell className="font-mono text-muted-foreground">
                      {i + 1}
                    </TableCell>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{row.conference}</Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      {row.seed ?? "—"}
                    </TableCell>
                    <TableCell>{row.region ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono font-semibold">
                      {(row.advancementPct * 100).toFixed(1)}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {champRows.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No simulation results yet. Run the tournament simulator to see
            championship probabilities.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatCard({ title, value }: { title: string; value: number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{title}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold">{value.toLocaleString()}</div>
      </CardContent>
    </Card>
  );
}
