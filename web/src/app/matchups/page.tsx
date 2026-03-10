export const dynamic = "force-dynamic";

import { getMatchupTeams } from "@/db/queries";
import { MatchupClient } from "./matchup-client";

export default async function MatchupsPage() {
  const teams = await getMatchupTeams();

  const teamList = teams.map((t) => ({
    teamId: t.teamId,
    name: t.name,
    conference: t.conference ?? "",
    logoUrl: t.logoUrl ?? "",
    rank: t.rank,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Head-to-Head Matchups
        </h1>
        <p className="text-muted-foreground">
          Review game history between two teams and find matchup edges
        </p>
      </div>
      <MatchupClient teams={teamList} />
    </div>
  );
}
