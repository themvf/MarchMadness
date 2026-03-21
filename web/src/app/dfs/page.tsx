export const dynamic = "force-dynamic";

import { getDkPlayers, getLatestSlateInfo, getDfsAccuracy } from "@/db/queries";
import DfsClient from "./dfs-client";

export default async function DfsPage() {
  const [players, slateInfo, accuracy] = await Promise.all([
    getDkPlayers(),
    getLatestSlateInfo(),
    getDfsAccuracy(),
  ]);

  return (
    <DfsClient
      players={players}
      slateDate={slateInfo?.slateDate ?? null}
      accuracy={accuracy}
    />
  );
}
