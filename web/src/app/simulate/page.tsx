export const dynamic = "force-dynamic";

import { getMatchupTeams, getTeamProfiles, type TeamProfileRow } from "@/db/queries";
import { SimulateClient } from "./simulate-client";

export default async function SimulatePage() {
  const [teams, profiles] = await Promise.all([
    getMatchupTeams(),
    getTeamProfiles(),
  ]);

  const teamList = teams.map((t) => ({
    teamId: t.teamId,
    name: t.name,
    conference: t.conference ?? "",
    logoUrl: t.logoUrl ?? "",
    rank: t.rank,
  }));

  // Serialize profiles map to a plain object for the client component
  const profilesObj: Record<number, TeamProfileRow> = {};
  for (const [id, p] of profiles) {
    profilesObj[id] = p;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Simulate Game</h1>
        <p className="text-muted-foreground">
          Pick two teams and simulate a head-to-head matchup using the enhanced model
        </p>
      </div>
      <SimulateClient teams={teamList} profiles={profilesObj} />
    </div>
  );
}
