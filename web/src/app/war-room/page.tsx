export const dynamic = "force-dynamic";

import { getWarRoomData } from "@/db/queries";
import WarRoomChart from "./war-room-chart";

export default async function WarRoomPage() {
  const teams = await getWarRoomData();

  // Compute top-10 by efficiency margin for the sidebar
  const top10 = [...teams]
    .filter((t) => t.adjEm != null)
    .sort((a, b) => (b.adjEm ?? 0) - (a.adjEm ?? 0))
    .slice(0, 10);

  // Tournament teams in the "elite" quadrant (above-avg offense AND defense)
  const valid = teams.filter((t) => t.adjOe != null && t.adjDe != null);
  const avgOe = valid.reduce((s, t) => s + (t.adjOe ?? 0), 0) / valid.length;
  const avgDe = valid.reduce((s, t) => s + (t.adjDe ?? 0), 0) / valid.length;
  const eliteTournament = teams
    .filter(
      (t) =>
        t.seed != null &&
        (t.adjOe ?? 0) > avgOe &&
        (t.adjDe ?? 999) < avgDe
    )
    .sort((a, b) => (b.adjEm ?? 0) - (a.adjEm ?? 0));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">War Room</h1>
        <p className="text-muted-foreground">
          Offensive vs defensive efficiency for all {teams.length} D1 teams.
          Tournament teams highlighted with amber borders. Dot size reflects
          Barthag power rating. Click any team for details.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <WarRoomChart teams={teams} />

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Elite tournament teams */}
          <div className="rounded-lg border bg-card p-4">
            <h3 className="font-semibold mb-3">
              Elite Tournament Teams
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                (above-avg O + D)
              </span>
            </h3>
            {eliteTournament.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No bracket data yet
              </p>
            ) : (
              <div className="space-y-2">
                {eliteTournament.map((t) => (
                  <div
                    key={t.teamId}
                    className="flex items-center gap-2 text-sm"
                  >
                    {t.logoUrl && (
                      <img
                        src={t.logoUrl}
                        alt=""
                        className="h-5 w-5 object-contain"
                      />
                    )}
                    <span className="font-medium truncate flex-1">
                      {t.name}
                    </span>
                    <span className="text-xs font-mono text-amber-600">
                      #{t.seed}
                    </span>
                    <span className="text-xs font-mono text-muted-foreground">
                      +{t.adjEm?.toFixed(1)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Top 10 overall */}
          <div className="rounded-lg border bg-card p-4">
            <h3 className="font-semibold mb-3">Top 10 by AdjEM</h3>
            <div className="space-y-2">
              {top10.map((t, i) => (
                <div
                  key={t.teamId}
                  className="flex items-center gap-2 text-sm"
                >
                  <span className="w-5 text-xs text-muted-foreground text-right">
                    {i + 1}
                  </span>
                  {t.logoUrl && (
                    <img
                      src={t.logoUrl}
                      alt=""
                      className="h-5 w-5 object-contain"
                    />
                  )}
                  <span className="font-medium truncate flex-1">
                    {t.name}
                  </span>
                  <span className="text-xs font-mono">
                    +{t.adjEm?.toFixed(1)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Key */}
          <div className="rounded-lg border bg-card p-4 text-xs text-muted-foreground space-y-1.5">
            <h3 className="font-semibold text-foreground mb-2">How to Read</h3>
            <p>
              <strong>Upper-right:</strong> Elite offense + defense. Title
              contenders live here.
            </p>
            <p>
              <strong>Upper-left:</strong> Strong defense, weak offense.
              Grinders that win ugly.
            </p>
            <p>
              <strong>Lower-right:</strong> Offense-first teams. Vulnerable in
              close games.
            </p>
            <p>
              <strong>Lower-left:</strong> Below average in both. Long shots.
            </p>
            <p className="pt-1">
              Dot size = Barthag power rating. Amber border = tournament team.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
