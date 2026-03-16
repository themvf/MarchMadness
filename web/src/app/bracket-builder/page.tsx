export const dynamic = "force-dynamic";

import { getBracketBuilderData } from "@/db/queries";
import BracketBuilderClient from "./bracket-builder-client";

export default async function BracketBuilderPage() {
  const data = await getBracketBuilderData();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Bracket Builder</h1>
        <p className="text-muted-foreground">
          Click teams to pick winners. Probabilities update as matchups form.
          Click the probability bar for a detailed comparison.
        </p>
      </div>
      <BracketBuilderClient
        teams={data.teams}
        r64Matchups={data.matchups}
        simResults={data.simResults}
        players={data.players}
      />
    </div>
  );
}
