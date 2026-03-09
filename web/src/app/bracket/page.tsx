export const dynamic = "force-dynamic";

import { getBracket } from "@/db/queries";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function BracketPage() {
  const bracket = await getBracket();

  if (bracket.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Bracket</h1>
          <p className="text-muted-foreground">
            Tournament bracket visualization
          </p>
        </div>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No bracket data available. The bracket will be populated after
            Selection Sunday.
          </CardContent>
        </Card>
      </div>
    );
  }

  // Group by region
  const regions = new Map<
    string,
    { teamId: number; name: string; seed: number; conference: string; logoUrl: string }[]
  >();

  for (const row of bracket) {
    const region = row.region;
    if (!regions.has(region)) regions.set(region, []);
    regions.get(region)!.push({
      teamId: row.teamId,
      name: row.name,
      seed: row.seed,
      conference: row.conference ?? "",
      logoUrl: row.logoUrl ?? "",
    });
  }

  // Sort each region by seed
  for (const teams of regions.values()) {
    teams.sort((a, b) => a.seed - b.seed);
  }

  const regionNames = Array.from(regions.keys()).sort();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Bracket</h1>
        <p className="text-muted-foreground">
          {bracket.length} teams across {regions.size} regions
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {regionNames.map((region) => (
          <Card key={region}>
            <CardHeader>
              <CardTitle>{region}</CardTitle>
              <CardDescription>16 teams</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                {regions.get(region)!.map((team) => (
                  <div
                    key={team.teamId}
                    className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50"
                  >
                    <span className="w-6 text-right font-mono text-sm text-muted-foreground">
                      {team.seed}
                    </span>
                    {team.logoUrl && (
                      <img
                        src={team.logoUrl}
                        alt=""
                        className="h-5 w-5 object-contain"
                      />
                    )}
                    <span className="flex-1 text-sm font-medium">
                      {team.name}
                    </span>
                    <Badge variant="outline" className="text-xs">
                      {team.conference}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
