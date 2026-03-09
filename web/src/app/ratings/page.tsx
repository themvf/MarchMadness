export const dynamic = "force-dynamic";

import { getTeamRatingsWithProfile } from "@/db/queries";
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

export default async function RatingsPage() {
  const ratings = await getTeamRatingsWithProfile();
  const champProfileCount = ratings.filter((t) => t.isChampionProfile).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Team Ratings</h1>
        <p className="text-muted-foreground">
          Torvik efficiency ratings for the current season
          {champProfileCount > 0 && (
            <> &mdash; <strong>{champProfileCount} teams</strong> match the historical champion profile</>
          )}
        </p>
      </div>

      {/* Champion Profile Legend */}
      <Card>
        <CardContent className="py-3">
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="font-medium">Champion Profile:</span>
            <span>Top 20 Offense (OE rank)</span>
            <span>+</span>
            <span>Top 20 Defense (DE rank)</span>
            <span>+</span>
            <span>Top 15 Efficiency Margin (EM rank)</span>
            <Badge className="bg-amber-500 text-white hover:bg-amber-600">
              CHAMP PROFILE
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All Teams ({ratings.length})</CardTitle>
          <CardDescription>
            Sorted by Torvik rank. Teams highlighted in amber match the
            historical champion profile.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Rank</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead>Conf</TableHead>
                  <TableHead className="text-right">AdjOE</TableHead>
                  <TableHead className="text-right">OE#</TableHead>
                  <TableHead className="text-right">AdjDE</TableHead>
                  <TableHead className="text-right">DE#</TableHead>
                  <TableHead className="text-right">AdjEM</TableHead>
                  <TableHead className="text-right">EM#</TableHead>
                  <TableHead className="text-right">Barthag</TableHead>
                  <TableHead className="text-right">Tempo</TableHead>
                  <TableHead className="text-right">W-L</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ratings.map((t) => (
                  <TableRow
                    key={t.teamId}
                    className={t.isChampionProfile ? "bg-amber-50 dark:bg-amber-950/30" : ""}
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
                        {t.isChampionProfile && (
                          <Badge className="bg-amber-500 text-white hover:bg-amber-600 text-[10px] px-1.5 py-0">
                            CHAMP
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {t.conference}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {fmt(t.adjOe)}
                    </TableCell>
                    <TableCell className={`text-right font-mono text-xs ${t.offRank <= 20 ? "font-bold text-green-600" : "text-muted-foreground"}`}>
                      {t.offRank}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {fmt(t.adjDe)}
                    </TableCell>
                    <TableCell className={`text-right font-mono text-xs ${t.defRank <= 20 ? "font-bold text-green-600" : "text-muted-foreground"}`}>
                      {t.defRank}
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold">
                      {fmt(t.adjEm)}
                    </TableCell>
                    <TableCell className={`text-right font-mono text-xs ${t.emRank <= 15 ? "font-bold text-green-600" : "text-muted-foreground"}`}>
                      {t.emRank}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {fmt(t.barthag, 4)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {fmt(t.adjTempo)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {t.wins}-{t.losses}
                    </TableCell>
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

function fmt(val: number | null, decimals = 1): string {
  if (val == null) return "\u2014";
  return val.toFixed(decimals);
}
