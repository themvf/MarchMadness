"use client";

import { useState, useMemo, useCallback } from "react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
  Label,
} from "recharts";
import type { WarRoomTeam } from "@/db/queries";

// Conference color map
const CONF_COLORS: Record<string, string> = {
  SEC: "#e63946",
  B12: "#2a6fdb",
  B10: "#1d3557",
  ACC: "#0077b6",
  BE: "#6a4c93",
  MWC: "#e9c46a",
  WCC: "#2a9d8f",
  AAC: "#f4845f",
  A10: "#e76f51",
  MVC: "#588157",
};

function getConfColor(conf: string | null): string {
  if (!conf) return "#94a3b8";
  return CONF_COLORS[conf] || "#94a3b8";
}

// Power 6 conferences for filtering
const POWER_CONFERENCES = ["SEC", "B12", "B10", "ACC", "BE"];

type FilterMode = "all" | "tournament" | "power" | "mid";

interface Props {
  teams: WarRoomTeam[];
}

interface TooltipPayload {
  payload: WarRoomTeam;
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
}) {
  if (!active || !payload?.[0]) return null;
  const t = payload[0].payload;
  return (
    <div className="rounded-lg border bg-background/95 px-4 py-3 shadow-lg backdrop-blur text-sm">
      <div className="flex items-center gap-2 mb-2">
        {t.logoUrl && (
          <img src={t.logoUrl} alt="" className="h-6 w-6 object-contain" />
        )}
        <span className="font-bold">{t.name}</span>
        {t.seed && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-mono text-amber-800">
            #{t.seed} {t.region}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
        <span>Rank</span>
        <span className="font-medium text-foreground">#{t.rank}</span>
        <span>AdjOE</span>
        <span className="font-medium text-foreground">
          {t.adjOe?.toFixed(1)}
        </span>
        <span>AdjDE</span>
        <span className="font-medium text-foreground">
          {t.adjDe?.toFixed(1)}
        </span>
        <span>AdjEM</span>
        <span className="font-medium text-foreground">
          {t.adjEm?.toFixed(1)}
        </span>
        <span>Barthag</span>
        <span className="font-medium text-foreground">
          {t.barthag?.toFixed(3)}
        </span>
        <span>Record</span>
        <span className="font-medium text-foreground">
          {t.wins}-{t.losses}
        </span>
        <span>Conference</span>
        <span className="font-medium text-foreground">{t.conference}</span>
      </div>
    </div>
  );
}

export default function WarRoomChart({ teams }: Props) {
  const [filter, setFilter] = useState<FilterMode>("all");
  const [selectedTeam, setSelectedTeam] = useState<WarRoomTeam | null>(null);
  const [highlightConf, setHighlightConf] = useState<string | null>(null);

  // Compute averages for reference lines
  const { avgOe, avgDe } = useMemo(() => {
    const valid = teams.filter((t) => t.adjOe != null && t.adjDe != null);
    if (valid.length === 0) return { avgOe: 100, avgDe: 100 };
    return {
      avgOe:
        valid.reduce((sum, t) => sum + (t.adjOe ?? 0), 0) / valid.length,
      avgDe:
        valid.reduce((sum, t) => sum + (t.adjDe ?? 0), 0) / valid.length,
    };
  }, [teams]);

  // Filter teams
  const filteredTeams = useMemo(() => {
    return teams.filter((t) => {
      if (t.adjOe == null || t.adjDe == null) return false;
      switch (filter) {
        case "tournament":
          return t.seed != null;
        case "power":
          return POWER_CONFERENCES.includes(t.conference ?? "");
        case "mid":
          return !POWER_CONFERENCES.includes(t.conference ?? "");
        default:
          return true;
      }
    });
  }, [teams, filter]);

  // Unique conferences for legend
  const conferences = useMemo(() => {
    const seen = new Set<string>();
    for (const t of filteredTeams) {
      if (t.conference) seen.add(t.conference);
    }
    return [...seen].sort();
  }, [filteredTeams]);

  // Quadrant counts
  const quadrants = useMemo(() => {
    let elite = 0, offOnly = 0, defOnly = 0, weak = 0;
    for (const t of filteredTeams) {
      const goodO = (t.adjOe ?? 0) > avgOe;
      const goodD = (t.adjDe ?? 999) < avgDe;
      if (goodO && goodD) elite++;
      else if (goodO) offOnly++;
      else if (goodD) defOnly++;
      else weak++;
    }
    return { elite, offOnly, defOnly, weak };
  }, [filteredTeams, avgOe, avgDe]);

  const getDotSize = useCallback(
    (t: WarRoomTeam) => {
      // Scale barthag to dot radius: min ~4, max ~16
      const b = t.barthag ?? 0.5;
      if (filter === "tournament") return 10 + b * 12;
      return 4 + b * 10;
    },
    [filter]
  );

  const getDotOpacity = useCallback(
    (t: WarRoomTeam) => {
      if (highlightConf && t.conference !== highlightConf) return 0.15;
      if (filter === "all" && !t.seed) return 0.35;
      return 0.85;
    },
    [highlightConf, filter]
  );

  const getStroke = useCallback((t: WarRoomTeam) => {
    if (t.seed) return "#f59e0b"; // amber border for tournament teams
    return "none";
  }, []);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground mr-1">
          Filter:
        </span>
        {(
          [
            ["all", "All Teams"],
            ["tournament", "Tournament"],
            ["power", "Power Conferences"],
            ["mid", "Mid-Majors"],
          ] as [FilterMode, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              filter === key
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          {filteredTeams.length} teams
        </span>
      </div>

      {/* Quadrant summary */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-lg border bg-emerald-50 px-3 py-2 dark:bg-emerald-950/30">
          <div className="text-lg font-bold text-emerald-700 dark:text-emerald-400">{quadrants.elite}</div>
          <div className="text-xs text-muted-foreground">Elite Both</div>
        </div>
        <div className="rounded-lg border bg-blue-50 px-3 py-2 dark:bg-blue-950/30">
          <div className="text-lg font-bold text-blue-700 dark:text-blue-400">{quadrants.offOnly}</div>
          <div className="text-xs text-muted-foreground">Offense Only</div>
        </div>
        <div className="rounded-lg border bg-orange-50 px-3 py-2 dark:bg-orange-950/30">
          <div className="text-lg font-bold text-orange-700 dark:text-orange-400">{quadrants.defOnly}</div>
          <div className="text-xs text-muted-foreground">Defense Only</div>
        </div>
        <div className="rounded-lg border bg-red-50 px-3 py-2 dark:bg-red-950/30">
          <div className="text-lg font-bold text-red-700 dark:text-red-400">{quadrants.weak}</div>
          <div className="text-xs text-muted-foreground">Below Average</div>
        </div>
      </div>

      {/* Chart */}
      <div className="rounded-lg border bg-card p-4">
        <ResponsiveContainer width="100%" height={600}>
          <ScatterChart margin={{ top: 20, right: 30, bottom: 40, left: 20 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis
              type="number"
              dataKey="adjOe"
              name="AdjOE"
              domain={["auto", "auto"]}
              tick={{ fontSize: 12 }}
            >
              <Label
                value="Adjusted Offensive Efficiency (higher = better)"
                position="bottom"
                offset={20}
                style={{ fontSize: 13, fill: "#94a3b8" }}
              />
            </XAxis>
            <YAxis
              type="number"
              dataKey="adjDe"
              name="AdjDE"
              reversed
              domain={["auto", "auto"]}
              tick={{ fontSize: 12 }}
            >
              <Label
                value="Adjusted Defensive Efficiency (lower = better)"
                angle={-90}
                position="left"
                offset={0}
                style={{ fontSize: 13, fill: "#94a3b8" }}
              />
            </YAxis>

            {/* Average reference lines create quadrants */}
            <ReferenceLine
              x={avgOe}
              stroke="#94a3b8"
              strokeDasharray="4 4"
              strokeWidth={1}
            />
            <ReferenceLine
              y={avgDe}
              stroke="#94a3b8"
              strokeDasharray="4 4"
              strokeWidth={1}
            />

            <Tooltip
              content={<CustomTooltip />}
              cursor={{ strokeDasharray: "3 3" }}
            />

            <Scatter data={filteredTeams} onClick={(d: { payload?: WarRoomTeam }) => { if (d?.payload) setSelectedTeam(d.payload); }}>
              {filteredTeams.map((t) => (
                <Cell
                  key={t.teamId}
                  fill={getConfColor(t.conference)}
                  r={getDotSize(t)}
                  opacity={getDotOpacity(t)}
                  stroke={getStroke(t)}
                  strokeWidth={t.seed ? 2 : 0}
                />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      {/* Conference legend */}
      <div className="flex flex-wrap gap-3 text-xs">
        <span className="font-medium text-muted-foreground">Conferences:</span>
        {conferences.map((conf) => (
          <button
            key={conf}
            onClick={() =>
              setHighlightConf(highlightConf === conf ? null : conf)
            }
            className={`flex items-center gap-1.5 transition-opacity ${
              highlightConf && highlightConf !== conf ? "opacity-30" : ""
            }`}
          >
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: getConfColor(conf) }}
            />
            <span>{conf}</span>
          </button>
        ))}
        {highlightConf && (
          <button
            onClick={() => setHighlightConf(null)}
            className="text-muted-foreground underline"
          >
            Clear
          </button>
        )}
        <span className="ml-2 flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-amber-500" />
          <span className="text-muted-foreground">= Tournament team</span>
        </span>
      </div>

      {/* Selected team detail card */}
      {selectedTeam && (
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {selectedTeam.logoUrl && (
                <img
                  src={selectedTeam.logoUrl}
                  alt=""
                  className="h-10 w-10 object-contain"
                />
              )}
              <div>
                <div className="font-bold text-lg">{selectedTeam.name}</div>
                <div className="text-sm text-muted-foreground">
                  #{selectedTeam.rank} overall &middot;{" "}
                  {selectedTeam.conference} &middot; {selectedTeam.wins}-
                  {selectedTeam.losses}
                  {selectedTeam.seed && (
                    <span className="ml-2 text-amber-600 font-medium">
                      #{selectedTeam.seed} seed ({selectedTeam.region})
                    </span>
                  )}
                </div>
              </div>
            </div>
            <button
              onClick={() => setSelectedTeam(null)}
              className="text-muted-foreground hover:text-foreground text-lg"
            >
              &times;
            </button>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-4 sm:grid-cols-6">
            {[
              ["AdjOE", selectedTeam.adjOe?.toFixed(1)],
              ["AdjDE", selectedTeam.adjDe?.toFixed(1)],
              ["AdjEM", selectedTeam.adjEm?.toFixed(1)],
              ["Barthag", selectedTeam.barthag?.toFixed(3)],
              ["Tempo", selectedTeam.adjTempo?.toFixed(1)],
              ["Record", `${selectedTeam.wins}-${selectedTeam.losses}`],
            ].map(([label, val]) => (
              <div key={label}>
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="font-mono font-bold">{val ?? "---"}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
