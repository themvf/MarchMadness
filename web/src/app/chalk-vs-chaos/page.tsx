export const dynamic = "force-dynamic";

import { getChalkChaosData } from "@/db/queries";
import ChalkChaosChart from "./chalk-chaos-chart";

export default async function ChalkChaosPage() {
  const data = await getChalkChaosData();

  // Group by round to show per-round summary
  const roundSummary = new Map<string, { count: number; avgDiv: number }>();
  for (const d of data) {
    const existing = roundSummary.get(d.round) ?? { count: 0, avgDiv: 0 };
    existing.count++;
    existing.avgDiv += Math.abs(d.divergence * 100);
    roundSummary.set(d.round, existing);
  }
  for (const [, v] of roundSummary) {
    v.avgDiv /= v.count;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Chalk vs Chaos</h1>
        <p className="text-muted-foreground">
          Where the public is wrong. Compares ESPN Tournament Challenge public
          pick percentages against our Monte Carlo model probabilities. Green
          bars = the public is sleeping on this team (contrarian value). Red
          bars = the public is overvaluing this team.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <ChalkChaosChart data={data} />

        {/* Sidebar */}
        <div className="space-y-4">
          {/* How it works */}
          <div className="rounded-lg border bg-card p-4 text-xs text-muted-foreground space-y-1.5">
            <h3 className="font-semibold text-foreground mb-2">How It Works</h3>
            <p>
              <strong className="text-emerald-600">Green (right):</strong> Model
              gives this team a higher probability than the public. These are
              undervalued picks — good for contrarian brackets.
            </p>
            <p>
              <strong className="text-red-500">Red (left):</strong> Public pick
              rate exceeds the model probability. The crowd is overrating this
              team — fading them improves expected bracket value.
            </p>
            <p className="pt-1">
              In bracket pools, <strong>differentiation</strong> matters as much
              as accuracy. Picking a chalk team that 40% of brackets have gives
              you no edge — even if they win. Picking an undervalued team that
              only 5% of brackets have creates massive leverage if they advance.
            </p>
          </div>

          {/* Strategy guide */}
          <div className="rounded-lg border bg-card p-4 text-xs text-muted-foreground space-y-1.5">
            <h3 className="font-semibold text-foreground mb-2">
              Pool Strategy
            </h3>
            <p>
              <strong>Small pool (5-20):</strong> Pick the best teams. Chalk is
              fine. Focus on accuracy.
            </p>
            <p>
              <strong>Large pool (50+):</strong> You need contrarian picks to
              differentiate. Target green-bar teams — your model says they&apos;re
              better than the public thinks.
            </p>
            <p>
              <strong>Mega pool (1000+):</strong> Maximize chaos. Stack
              undervalued upsets. You need a unique bracket to win.
            </p>
          </div>

          {data.length > 0 && roundSummary.size > 0 && (
            <div className="rounded-lg border bg-card p-4">
              <h3 className="font-semibold mb-3 text-sm">Round Divergence</h3>
              <div className="space-y-2">
                {["R64", "R32", "S16", "E8", "F4", "NCG", "Champion"].filter(r => roundSummary.has(r)).map((round) => { const { avgDiv } = roundSummary.get(round)!; return (
                  <div key={round} className="flex items-center gap-2 text-sm">
                    <span className="w-20 text-muted-foreground">{round}</span>
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-amber-500 rounded-full"
                        style={{ width: `${Math.min(100, avgDiv * 5)}%` }}
                      />
                    </div>
                    <span className="w-12 text-right font-mono text-xs">
                      {avgDiv.toFixed(1)}%
                    </span>
                  </div>
                ); })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
