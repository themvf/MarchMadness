export const dynamic = "force-dynamic";

import { getDkPlayers, getLatestSlateInfo, getDfsAccuracy, getDkLineupComparison } from "@/db/queries";
import DfsClient from "./dfs-client";

export default async function DfsPage() {
  const [players, slateInfo, accuracy, comparison] = await Promise.all([
    getDkPlayers(),
    getLatestSlateInfo(),
    getDfsAccuracy(),
    getDkLineupComparison(),
  ]);

  return (
    <DfsClient
      players={players}
      slateDate={slateInfo?.slateDate ?? null}
      accuracy={accuracy}
      comparison={comparison}
    />
  );
}
