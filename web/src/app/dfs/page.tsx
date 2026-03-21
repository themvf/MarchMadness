export const dynamic = "force-dynamic";

import { getDkPlayers, getLatestSlateInfo } from "@/db/queries";
import DfsClient from "./dfs-client";

export default async function DfsPage() {
  const [players, slateInfo] = await Promise.all([
    getDkPlayers(),
    getLatestSlateInfo(),
  ]);

  return (
    <DfsClient
      players={players}
      slateDate={slateInfo?.slateDate ?? null}
    />

  );
}
