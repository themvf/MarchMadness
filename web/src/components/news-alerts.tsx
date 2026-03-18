import type { TeamNewsRow } from "@/db/queries";

type NewsAlertsProps = {
  teamAId: number;
  teamBId: number;
  teamAName: string;
  teamBName: string;
  newsMap: Map<number, TeamNewsRow[]>;
};

export function NewsAlerts({
  teamAId,
  teamBId,
  teamAName,
  teamBName,
  newsMap,
}: NewsAlertsProps) {
  const newsA = newsMap.get(teamAId) ?? [];
  const newsB = newsMap.get(teamBId) ?? [];

  if (newsA.length === 0 && newsB.length === 0) {
    return <span className="text-xs text-muted-foreground">--</span>;
  }

  return (
    <div className="flex flex-col gap-1">
      {newsA.length > 0 && (
        <NewsBadge articles={newsA} teamName={teamAName} />
      )}
      {newsB.length > 0 && (
        <NewsBadge articles={newsB} teamName={teamBName} />
      )}
    </div>
  );
}

function NewsBadge({
  articles,
  teamName,
}: {
  articles: TeamNewsRow[];
  teamName: string;
}) {
  const top = articles[0];
  const isHighImpact = (top.impactScore ?? 0) >= 30;
  const shortName = teamName.split(" ").pop();

  return (
    <a
      href={top.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold leading-tight ${
        isHighImpact
          ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"
          : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300"
      }`}
      title={top.title}
    >
      {isHighImpact ? "ALERT" : "NEWS"} {shortName}
      {articles.length > 1 ? ` (${articles.length})` : ""}
    </a>
  );
}
