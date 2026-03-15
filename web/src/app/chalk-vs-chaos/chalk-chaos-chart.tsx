"use client";

import { useState, useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from "recharts";
import type { ChalkChaosRow } from "@/db/queries";

const ROUND_ORDER = ["R64", "R32", "S16", "E8", "F4", "NCG", "Champion"];
const ROUND_LABELS: Record<string, string> = {
  R64: "Round of 64",
  R32: "Round of 32",
  S16: "Sweet 16",
  E8: "Elite 8",
  F4: "Final Four",
  NCG: "Championship",
  Champion: "Champion",
};

interface Props {
  data: ChalkChaosRow[];
}

interface TooltipPayload {
  payload: ChalkChaosRow & { divergencePct: number };
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
}) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  const isModelHigher = d.divergence > 0;
  return (
    <div className="rounded-lg border bg-background/95 px-4 py-3 shadow-lg backdrop-blur text-sm max-w-xs">
      <div className="flex items-center gap-2 mb-2">
        {d.logoUrl && (
          <img src={d.logoUrl} alt="" className="h-6 w-6 object-contain" />
        )}
        <span className="font-bold">{d.name}</span>
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-mono text-amber-800">
          #{d.seed} {d.region}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
        <span>Public picks</span>
        <span className="font-medium text-foreground">
          {(d.pickPct * 100).toFixed(1)}%
        </span>
        <span>Model prob</span>
        <span className="font-medium text-foreground">
          {(d.modelPct * 100).toFixed(1)}%
        </span>
        <span>Divergence</span>
        <span
          className={`font-bold ${
            isModelHigher ? "text-emerald-600" : "text-red-500"
          }`}
        >
          {isModelHigher ? "+" : ""}
          {(d.divergence * 100).toFixed(1)}%
        </span>
      </div>
      <div className="mt-2 text-xs text-muted-foreground">
        {isModelHigher
          ? "Model sees more value than the public"
          : "Public is overvaluing this team"}
      </div>
    </div>
  );
}

export default function ChalkChaosChart({ data }: Props) {
  const [selectedRound, setSelectedRound] = useState<string>("Champion");

  // Available rounds from data
  const availableRounds = useMemo(() => {
    const rounds = new Set(data.map((d) => d.round));
    return ROUND_ORDER.filter((r) => rounds.has(r));
  }, [data]);

  // Default to first available round if selected isn't available
  const activeRound = availableRounds.includes(selectedRound)
    ? selectedRound
    : availableRounds[0] ?? "Champion";

  // Filter and sort for the active round
  const roundData = useMemo(() => {
    return data
      .filter((d) => d.round === activeRound)
      .map((d) => ({
        ...d,
        divergencePct: d.divergence * 100,
        label: `#${d.seed} ${d.name}`,
      }))
      .sort((a, b) => b.divergencePct - a.divergencePct);
  }, [data, activeRound]);

  // Summary stats
  const stats = useMemo(() => {
    if (roundData.length === 0)
      return {
        modelFavors: 0,
        publicFavors: 0,
        biggestModel: null as (typeof roundData)[0] | null,
        biggestPublic: null as (typeof roundData)[0] | null,
        avgDivergence: 0,
      };

    const modelFavors = roundData.filter((d) => d.divergencePct > 0);
    const publicFavors = roundData.filter((d) => d.divergencePct < 0);

    return {
      modelFavors: modelFavors.length,
      publicFavors: publicFavors.length,
      biggestModel: modelFavors[0] ?? null,
      biggestPublic: publicFavors.at(-1) ?? null,
      avgDivergence:
        roundData.reduce((s, d) => s + Math.abs(d.divergencePct), 0) /
        roundData.length,
    };
  }, [roundData]);

  if (data.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-12 text-center">
        <div className="text-4xl mb-4">&#127936;</div>
        <h3 className="text-lg font-semibold mb-2">
          Waiting for Public Pick Data
        </h3>
        <p className="text-muted-foreground max-w-md mx-auto">
          Public pick percentages from ESPN Tournament Challenge will be
          available after Selection Sunday when millions of brackets are
          submitted. Run the ingestion script to populate this data.
        </p>
        <pre className="mt-4 text-xs bg-muted rounded p-3 inline-block text-left">
          python -m ingest.public_picks --file picks.json
        </pre>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Round selector */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground mr-1">
          Round:
        </span>
        {availableRounds.map((round) => (
          <button
            key={round}
            onClick={() => setSelectedRound(round)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              activeRound === round
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {ROUND_LABELS[round] || round}
          </button>
        ))}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-lg border bg-emerald-50 px-3 py-2 dark:bg-emerald-950/30">
          <div className="text-lg font-bold text-emerald-700 dark:text-emerald-400">
            {stats.modelFavors}
          </div>
          <div className="text-xs text-muted-foreground">
            Model Sees Value
          </div>
        </div>
        <div className="rounded-lg border bg-red-50 px-3 py-2 dark:bg-red-950/30">
          <div className="text-lg font-bold text-red-700 dark:text-red-400">
            {stats.publicFavors}
          </div>
          <div className="text-xs text-muted-foreground">
            Public Overvalues
          </div>
        </div>
        <div className="rounded-lg border px-3 py-2">
          <div className="text-lg font-bold">{stats.avgDivergence.toFixed(1)}%</div>
          <div className="text-xs text-muted-foreground">Avg Divergence</div>
        </div>
        <div className="rounded-lg border px-3 py-2">
          <div className="text-lg font-bold">{roundData.length}</div>
          <div className="text-xs text-muted-foreground">
            Teams ({ROUND_LABELS[activeRound]})
          </div>
        </div>
      </div>

      {/* Biggest divergence callouts */}
      {(stats.biggestModel || stats.biggestPublic) && (
        <div className="grid gap-2 sm:grid-cols-2">
          {stats.biggestModel && (
            <div className="rounded-lg border-2 border-emerald-300 bg-emerald-50/50 px-4 py-3 dark:border-emerald-700 dark:bg-emerald-950/20">
              <div className="text-xs font-medium text-emerald-600 mb-1">
                Best Contrarian Value
              </div>
              <div className="flex items-center gap-2">
                {stats.biggestModel.logoUrl && (
                  <img
                    src={stats.biggestModel.logoUrl}
                    alt=""
                    className="h-6 w-6 object-contain"
                  />
                )}
                <span className="font-bold">{stats.biggestModel.label}</span>
                <span className="ml-auto font-mono text-emerald-700 dark:text-emerald-400 font-bold">
                  +{stats.biggestModel.divergencePct.toFixed(1)}%
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Model: {(stats.biggestModel.modelPct * 100).toFixed(1)}% vs
                Public: {(stats.biggestModel.pickPct * 100).toFixed(1)}%
              </div>
            </div>
          )}
          {stats.biggestPublic && (
            <div className="rounded-lg border-2 border-red-300 bg-red-50/50 px-4 py-3 dark:border-red-700 dark:bg-red-950/20">
              <div className="text-xs font-medium text-red-600 mb-1">
                Most Overvalued by Public
              </div>
              <div className="flex items-center gap-2">
                {stats.biggestPublic.logoUrl && (
                  <img
                    src={stats.biggestPublic.logoUrl}
                    alt=""
                    className="h-6 w-6 object-contain"
                  />
                )}
                <span className="font-bold">{stats.biggestPublic.label}</span>
                <span className="ml-auto font-mono text-red-600 font-bold">
                  {stats.biggestPublic.divergencePct.toFixed(1)}%
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Model: {(stats.biggestPublic.modelPct * 100).toFixed(1)}% vs
                Public: {(stats.biggestPublic.pickPct * 100).toFixed(1)}%
              </div>
            </div>
          )}
        </div>
      )}

      {/* Divergence bar chart */}
      <div className="rounded-lg border bg-card p-4">
        <ResponsiveContainer width="100%" height={Math.max(400, roundData.length * 36)}>
          <BarChart
            data={roundData}
            layout="vertical"
            margin={{ top: 10, right: 30, bottom: 10, left: 140 }}
          >
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} horizontal={false} />
            <XAxis
              type="number"
              tick={{ fontSize: 11 }}
              tickFormatter={(v: number) => `${v > 0 ? "+" : ""}${v.toFixed(0)}%`}
              domain={["auto", "auto"]}
            />
            <YAxis
              type="category"
              dataKey="label"
              tick={{ fontSize: 12 }}
              width={135}
            />
            <ReferenceLine x={0} stroke="#94a3b8" strokeWidth={2} />
            <Tooltip
              content={<CustomTooltip />}
              cursor={{ fill: "rgba(148,163,184,0.1)" }}
            />
            <Bar dataKey="divergencePct" radius={[4, 4, 4, 4]} barSize={20}>
              {roundData.map((d, i) => (
                <Cell
                  key={i}
                  fill={d.divergencePct >= 0 ? "#059669" : "#dc2626"}
                  opacity={0.8}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Data table below chart */}
      <div className="rounded-lg border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-3 py-2 text-left font-medium">Team</th>
              <th className="px-3 py-2 text-right font-medium">Seed</th>
              <th className="px-3 py-2 text-right font-medium">Public %</th>
              <th className="px-3 py-2 text-right font-medium">Model %</th>
              <th className="px-3 py-2 text-right font-medium">Divergence</th>
              <th className="px-3 py-2 text-left font-medium">Signal</th>
            </tr>
          </thead>
          <tbody>
            {roundData.map((d) => {
              const isValue = d.divergencePct > 0;
              return (
                <tr key={d.teamId} className="border-b last:border-0">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {d.logoUrl && (
                        <img
                          src={d.logoUrl}
                          alt=""
                          className="h-5 w-5 object-contain"
                        />
                      )}
                      <span className="font-medium">{d.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {d.conference}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    #{d.seed}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {(d.pickPct * 100).toFixed(1)}%
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {(d.modelPct * 100).toFixed(1)}%
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-mono font-bold ${
                      isValue ? "text-emerald-600" : "text-red-500"
                    }`}
                  >
                    {isValue ? "+" : ""}
                    {d.divergencePct.toFixed(1)}%
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        isValue
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
                          : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                      }`}
                    >
                      {isValue ? "Contrarian Value" : "Overvalued"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
