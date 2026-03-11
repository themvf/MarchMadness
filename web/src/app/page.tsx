export const dynamic = "force-dynamic";

import {
  getDashboardStats,
  getSimulationResults,
  getTeamRatingsWithProfile,
  getTeamProfiles,
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
import { Badge } from "@/components/ui/badge";
import { ArchetypeBadges } from "@/components/archetype-badges";

export default async function DashboardPage() {
  const [stats, simRows, ratings, profiles] = await Promise.all([
    getDashboardStats(),
    getSimulationResults(),
    getTeamRatingsWithProfile(),
    getTeamProfiles(),
  ]);

  // Get championship probabilities (round = "Champion")
  const champRows = simRows
    .filter((r) => r.round === "Champion")
    .sort((a, b) => b.advancementPct - a.advancementPct)
    .slice(0, 16);

  // Champion profile teams
  const champProfile = ratings.filter((t) => t.isChampionProfile);

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
        <StatCard title="Champion Profile" value={champProfile.length} />
      </div>

      {/* Champion Profile Teams */}
      {champProfile.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Champion Profile Teams</CardTitle>
            <CardDescription>
              Top 20 offense + Top 20 defense + Top 15 efficiency margin
              &mdash; historically narrows the field to true contenders
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead>Conf</TableHead>
                  <TableHead className="text-right">AdjOE</TableHead>
                  <TableHead className="text-right">OE#</TableHead>
                  <TableHead className="text-right">AdjDE</TableHead>
                  <TableHead className="text-right">DE#</TableHead>
                  <TableHead className="text-right">AdjEM</TableHead>
                  <TableHead className="text-right">EM#</TableHead>
                  <TableHead className="text-right">W-L</TableHead>
                  <TableHead>Archetypes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {champProfile.map((t) => (
                  <TableRow
                    key={t.teamId}
                    className="bg-amber-50 dark:bg-amber-950/30"
                  >
                    <TableCell className="font-mono text-muted-foreground">
                      {t.rank}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {t.logoUrl && (
                          <img
                            src={t.logoUrl}
                            alt=""
                            className="h-5 w-5 object-contain"
                          />
                        )}
                        <span className="font-medium">{t.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{t.conference}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {t.adjOe?.toFixed(1)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-bold text-green-600">
                      {t.offRank}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {t.adjDe?.toFixed(1)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-bold text-green-600">
                      {t.defRank}
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold">
                      {t.adjEm?.toFixed(1)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-bold text-green-600">
                      {t.emRank}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {t.wins}-{t.losses}
                    </TableCell>
                    <TableCell>
                      <ArchetypeBadges profile={profiles.get(t.teamId)} max={3} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Top Championship Contenders from Simulation */}
      {champRows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Simulated Championship Odds</CardTitle>
            <CardDescription>
              Top 16 teams by Monte Carlo championship probability
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
                      {row.seed ?? "\u2014"}
                    </TableCell>
                    <TableCell>{row.region ?? "\u2014"}</TableCell>
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

      {champRows.length === 0 && champProfile.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No data available yet. Ingest Torvik ratings and run the simulator.
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
