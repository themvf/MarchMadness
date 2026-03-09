import { getTeamRatings } from "@/db/queries";
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
  const ratings = await getTeamRatings();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Team Ratings</h1>
        <p className="text-muted-foreground">
          Torvik efficiency ratings for the current season
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Teams ({ratings.length})</CardTitle>
          <CardDescription>
            Sorted by Torvik rank. AdjEM = Adjusted Efficiency Margin (offense
            minus defense).
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
                  <TableHead className="text-right">AdjDE</TableHead>
                  <TableHead className="text-right">AdjEM</TableHead>
                  <TableHead className="text-right">Barthag</TableHead>
                  <TableHead className="text-right">Tempo</TableHead>
                  <TableHead className="text-right">eFG%</TableHead>
                  <TableHead className="text-right">eFG%D</TableHead>
                  <TableHead className="text-right">TOV%</TableHead>
                  <TableHead className="text-right">ORB%</TableHead>
                  <TableHead className="text-right">FTR</TableHead>
                  <TableHead className="text-right">W-L</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ratings.map((t) => (
                  <TableRow key={t.teamId}>
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
                      <Badge variant="outline" className="text-xs">
                        {t.conference}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {fmt(t.adjOe)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {fmt(t.adjDe)}
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold">
                      {fmt(t.adjEm)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {fmt(t.barthag, 4)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {fmt(t.adjTempo)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {fmt(t.efg)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {fmt(t.efgD)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {fmt(t.tov)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {fmt(t.orb)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {fmt(t.ftr)}
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
  if (val == null) return "—";
  return val.toFixed(decimals);
}
