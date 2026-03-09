export const dynamic = "force-dynamic";

import { getMatchupTeams } from "@/db/queries";
import { SimulateClient } from "./simulate-client";

export default async function SimulatePage() {
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
        <h1 className="text-2xl font-bold tracking-tight">Simulate Game</h1>
        <p className="text-muted-foreground">
          Pick two teams and simulate a head-to-head matchup using Torvik ratings
        </p>
      </div>
      <SimulateClient teams={teamList} />
    </div>
  );
}
