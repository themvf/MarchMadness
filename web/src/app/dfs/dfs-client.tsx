"use client";

import { useState, useMemo, useTransition, useCallback, useRef } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DkPlayerRow, DfsAccuracyMetrics, DfsAccuracyRow } from "@/db/queries";
import type { GeneratedLineup, OptimizerSettings } from "./optimizer";
import { processDkSlate, refreshLinestarProjs, runOptimizer, exportLineups } from "./actions";

type Props = {
  players: DkPlayerRow[];
  slateDate: string | null;
  accuracy: { metrics: DfsAccuracyMetrics; players: DfsAccuracyRow[] } | null;
};

type SortCol =
  | "name"
  | "salary"
  | "linestarProj"
  | "ourProj"
  | "delta"
  | "projOwnPct"
  | "ourLeverage"
  | "value";

function parseGameKey(gameInfo: string | null): string {
  if (!gameInfo) return "Unknown";
  return gameInfo.split(" ")[0] ?? "Unknown";
}

function parseGameTime(gameInfo: string | null): string {
  if (!gameInfo) return "";
  const parts = gameInfo.split(" ");
  return parts.slice(1, 3).join(" ");
}

function formatDate(gameInfo: string | null): string {
  if (!gameInfo) return "";
  const m = gameInfo.match(/(\d{2}\/\d{2}\/\d{4})/);
  if (!m) return "";
  const [mm, dd] = m[1].split("/");
  return `${mm}/${dd}`;
}

export default function DfsClient({ players, slateDate, accuracy }: Props) {
  const [isPending, startTransition] = useTransition();

  // ── Upload state ─────────────────────────────────────────
  const [dkUploadMsg, setDkUploadMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [lsUploadMsg, setLsUploadMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dkFileRef = useRef<HTMLInputElement>(null);
  const lsFileRef = useRef<HTMLInputElement>(null);

  // ── Game / filter state ───────────────────────────────────
  const allGameKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const p of players) keys.add(parseGameKey(p.gameInfo));
    return Array.from(keys).sort();
  }, [players]);

  const [selectedGames, setSelectedGames] = useState<Set<string>>(
    () => new Set(allGameKeys)
  );

  // ── Optimizer settings ────────────────────────────────────
  const [mode, setMode] = useState<"cash" | "gpp">("gpp");
  const [nLineups, setNLineups] = useState(20);
  const [minStack, setMinStack] = useState(2);
  const [maxExposure, setMaxExposure] = useState(0.6);

  // ── Table sort ────────────────────────────────────────────
  const [sortCol, setSortCol] = useState<SortCol>("ourLeverage");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // ── Generated lineups ─────────────────────────────────────
  const [lineups, setLineups] = useState<GeneratedLineup[] | null>(null);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizeError, setOptimizeError] = useState<string | null>(null);

  // ── Multi-entry export state ──────────────────────────────
  const [entryTemplate, setEntryTemplate] = useState("");
  const [isExporting, setIsExporting] = useState(false);

  // ── Derived: filtered + sorted player pool ────────────────
  const filteredPlayers = useMemo(() => {
    return players.filter((p) => selectedGames.has(parseGameKey(p.gameInfo)));
  }, [players, selectedGames]);

  const sortedPlayers = useMemo(() => {
    const sorted = [...filteredPlayers];
    sorted.sort((a, b) => {
      let av: number | null = null;
      let bv: number | null = null;
      switch (sortCol) {
        case "name":
          return sortDir === "asc"
            ? a.name.localeCompare(b.name)
            : b.name.localeCompare(a.name);
        case "salary":
          av = a.salary; bv = b.salary; break;
        case "linestarProj":
          av = a.linestarProj; bv = b.linestarProj; break;
        case "ourProj":
          av = a.ourProj; bv = b.ourProj; break;
        case "delta":
          av = (a.ourProj ?? 0) - (a.linestarProj ?? 0);
          bv = (b.ourProj ?? 0) - (b.linestarProj ?? 0);
          break;
        case "projOwnPct":
          av = a.projOwnPct; bv = b.projOwnPct; break;
        case "ourLeverage":
          av = a.ourLeverage; bv = b.ourLeverage; break;
        case "value":
          av = a.ourProj != null ? (a.ourProj / a.salary) * 1000 : null;
          bv = b.ourProj != null ? (b.ourProj / b.salary) * 1000 : null;
          break;
      }
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return sorted;
  }, [filteredPlayers, sortCol, sortDir]);

  const handleSort = (col: SortCol) => {
    if (col === sortCol) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("desc");
    }
  };

  const sortIndicator = (col: SortCol) =>
    col === sortCol ? (sortDir === "desc" ? " ↓" : " ↑") : "";

  // ── Per-game model info for slate selector ─────────────────
  const gameInfo = useMemo(() => {
    const map = new Map<
      string,
      { time: string; date: string; modelFavored: string | null; vegasFavored: string | null; edge: number | null }
    >();
    for (const p of players) {
      const key = parseGameKey(p.gameInfo);
      if (map.has(key)) continue;
      // Determine win probabilities from player perspective
      const modelProb = p.matchupTeamAId === p.teamId ? p.modelProbA : (p.modelProbA != null ? 1 - p.modelProbA : null);
      const vegasProb = p.matchupTeamAId === p.teamId ? p.vegasProbA : (p.vegasProbA != null ? 1 - p.vegasProbA : null);
      // Use matchup-level data — find a player with matchup data
      const [away, home] = key.split("@");
      const edge = modelProb != null && vegasProb != null ? Math.abs(modelProb - vegasProb) : null;
      map.set(key, {
        time: parseGameTime(p.gameInfo),
        date: formatDate(p.gameInfo),
        modelFavored: null,
        vegasFavored: null,
        edge,
      });
    }
    // Enrich with matchup probs from first player with matchup data
    for (const p of players) {
      if (p.modelProbA == null) continue;
      const key = parseGameKey(p.gameInfo);
      const info = map.get(key);
      if (!info) continue;
      const [away, home] = key.split("@");
      const modelFavorsA = p.modelProbA > 0.5;
      const vegasFavorsA = p.vegasProbA != null ? p.vegasProbA > 0.5 : null;
      const edge = p.vegasProbA != null ? Math.abs(p.modelProbA - p.vegasProbA) : null;
      map.set(key, {
        ...info,
        modelFavored: modelFavorsA ? home : away,
        vegasFavored: vegasFavorsA != null ? (vegasFavorsA ? home : away) : null,
        edge,
      });
    }
    return map;
  }, [players]);

  // ── Handlers ─────────────────────────────────────────────

  const handleDkUpload = async () => {
    const dkFile = dkFileRef.current?.files?.[0];
    const lsFile = lsFileRef.current?.files?.[0];
    if (!dkFile || !lsFile) {
      setDkUploadMsg({ ok: false, text: "Select both DK CSV and LineStar CSV to load a new slate." });
      return;
    }
    const dkText = await dkFile.text();
    const lsText = await lsFile.text();
    const form = new FormData();
    form.set("dkCsv", dkText);
    form.set("linestarCsv", lsText);
    startTransition(async () => {
      const res = await processDkSlate(form);
      setDkUploadMsg({ ok: res.success, text: res.message });
    });
  };

  const handleLsRefresh = async () => {
    const lsFile = lsFileRef.current?.files?.[0];
    if (!lsFile) {
      setLsUploadMsg({ ok: false, text: "Select a LineStar CSV first." });
      return;
    }
    const lsText = await lsFile.text();
    const form = new FormData();
    form.set("linestarCsv", lsText);
    startTransition(async () => {
      const res = await refreshLinestarProjs(form);
      setLsUploadMsg({ ok: res.success, text: res.message });
    });
  };

  const handleOptimize = async () => {
    if (filteredPlayers.length < 8) return;
    setIsOptimizing(true);
    setOptimizeError(null);
    setLineups(null);
    try {
      const ids = filteredPlayers.map((p) => p.id);
      const settings: OptimizerSettings = { mode, nLineups, minStack, maxExposure };
      const result = await runOptimizer(ids, settings);
      if (result.length === 0) {
        setOptimizeError(
          "No feasible lineups found. Try selecting more games or reducing min stack."
        );
      } else {
        setLineups(result);
      }
    } catch (err) {
      setOptimizeError(`Optimizer error: ${String(err)}`);
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleExport = async () => {
    if (!lineups || lineups.length === 0) return;
    setIsExporting(true);
    try {
      const csv = await exportLineups(lineups, entryTemplate);
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `dk_cbb_lineups_${slateDate ?? "slate"}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
    }
  };

  const toggleGame = (key: string) => {
    setSelectedGames((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAllGames = () => setSelectedGames(new Set(allGameKeys));
  const clearAllGames = () => setSelectedGames(new Set());

  // ── Slate size guidance ───────────────────────────────────
  const slateGuidance = selectedGames.size <= 2
    ? "2-game slate — Cash plays, minimize ownership risk"
    : selectedGames.size <= 5
    ? "Small GPP — Moderate stacking, target leverage plays"
    : "Full slate — Large GPP, maximize leverage and contrarian exposure";

  if (players.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">DFS Optimizer</h1>
          <p className="text-muted-foreground">
            DraftKings CBB tournament lineup optimizer
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Load Your Slate</CardTitle>
            <CardDescription>
              Upload both CSVs to create the player pool, or run{" "}
              <code className="font-mono text-xs">python -m ingest.dk_slate --dk DKSalaries.csv --linestar LineStar.csv</code> via CLI.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SplitUploadPanel
              dkFileRef={dkFileRef}
              lsFileRef={lsFileRef}
              onLoadSlate={handleDkUpload}
              onRefreshLineStar={handleLsRefresh}
              isPending={isPending}
              dkMessage={dkUploadMsg}
              lsMessage={lsUploadMsg}
              hasSlate={false}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">DFS Optimizer</h1>
          <p className="text-muted-foreground">
            {slateDate && <span className="mr-2">{slateDate} ·</span>}
            {players.length} players · {allGameKeys.length} games
          </p>
        </div>
      </div>

      {/* Upload + Refresh */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Update Slate</CardTitle>
          <CardDescription>Refresh LineStar ownership as projections update throughout the day.</CardDescription>
        </CardHeader>
        <CardContent>
          <SplitUploadPanel
            dkFileRef={dkFileRef}
            lsFileRef={lsFileRef}
            onLoadSlate={handleDkUpload}
            onRefreshLineStar={handleLsRefresh}
            isPending={isPending}
            dkMessage={dkUploadMsg}
            lsMessage={lsUploadMsg}
            hasSlate={true}
          />
        </CardContent>
      </Card>

      {/* Slate Selector */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Slate Selector</CardTitle>
          <CardDescription>{slateGuidance}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-2 flex gap-2">
            <button
              className="text-xs text-muted-foreground underline hover:text-foreground"
              onClick={selectAllGames}
            >
              Select all
            </button>
            <button
              className="text-xs text-muted-foreground underline hover:text-foreground"
              onClick={clearAllGames}
            >
              Clear all
            </button>
            <span className="ml-auto text-xs text-muted-foreground">
              {selectedGames.size} / {allGameKeys.length} games · {filteredPlayers.length} players
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {allGameKeys.map((key) => {
              const info = gameInfo.get(key);
              const isSelected = selectedGames.has(key);
              const [away, home] = key.split("@");
              const hasEdge = info?.edge != null && info.edge > 0.08;
              return (
                <button
                  key={key}
                  onClick={() => toggleGame(key)}
                  className={`rounded-lg border p-2 text-left text-sm transition-colors ${
                    isSelected
                      ? "border-blue-500/50 bg-blue-500/5"
                      : "border-border bg-muted/30 opacity-50"
                  } ${hasEdge ? "border-yellow-500/50" : ""}`}
                >
                  <div className="font-medium">
                    {away} @ {home}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                    <span>{info?.date} {info?.time}</span>
                    {hasEdge && (
                      <Badge className="ml-auto bg-yellow-500/20 text-[9px] text-yellow-700">
                        EDGE {((info!.edge!) * 100).toFixed(0)}%
                      </Badge>
                    )}
                  </div>
                  {info?.modelFavored && info.vegasFavored && info.modelFavored !== info.vegasFavored && (
                    <div className="mt-0.5 text-[10px] text-red-500">Model/Vegas disagree</div>
                  )}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Settings + Optimize */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Optimizer Settings</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              Mode:
              <select
                className="rounded border px-2 py-1 text-sm"
                value={mode}
                onChange={(e) => setMode(e.target.value as "cash" | "gpp")}
              >
                <option value="gpp">GPP (Leverage)</option>
                <option value="cash">Cash (Proj FPTS)</option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              Lineups:
              <input
                type="number"
                min={1}
                max={150}
                className="w-16 rounded border px-2 py-1 text-sm"
                value={nLineups}
                onChange={(e) => setNLineups(parseInt(e.target.value, 10) || 1)}
              />
            </label>
            <label className="flex items-center gap-2">
              Min stack:
              <select
                className="rounded border px-2 py-1 text-sm"
                value={minStack}
                onChange={(e) => setMinStack(parseInt(e.target.value, 10))}
              >
                <option value={2}>2</option>
                <option value={3}>3</option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              Max exposure:
              <select
                className="rounded border px-2 py-1 text-sm"
                value={maxExposure}
                onChange={(e) => setMaxExposure(parseFloat(e.target.value))}
              >
                <option value={0.4}>40%</option>
                <option value={0.6}>60%</option>
                <option value={0.8}>80%</option>
                <option value={1.0}>100%</option>
              </select>
            </label>
          </div>
          <Button
            className="mt-4"
            onClick={handleOptimize}
            disabled={isOptimizing || filteredPlayers.length < 8}
          >
            {isOptimizing ? "Optimizing…" : `Generate ${nLineups} Lineup${nLineups !== 1 ? "s" : ""}`}
          </Button>
          {optimizeError && (
            <p className="mt-2 text-xs text-red-500">{optimizeError}</p>
          )}
        </CardContent>
      </Card>

      {/* Player Pool Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Player Pool</CardTitle>
          <CardDescription>
            {filteredPlayers.length} players from {selectedGames.size} selected games
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                {(
                  [
                    ["name", "Player"],
                    ["salary", "Salary"],
                    ["linestarProj", "LS Proj"],
                    ["ourProj", "Our Proj"],
                    ["delta", "Delta"],
                    ["projOwnPct", "Own%"],
                    ["ourLeverage", "Leverage"],
                    ["value", "Value"],
                  ] as [SortCol, string][]
                ).map(([col, label]) => (
                  <th
                    key={col}
                    className="cursor-pointer whitespace-nowrap px-2 py-1.5 font-medium hover:text-foreground"
                    onClick={() => handleSort(col)}
                  >
                    {label}{sortIndicator(col)}
                  </th>
                ))}
                <th className="px-2 py-1.5 font-medium">Pos</th>
                <th className="px-2 py-1.5 font-medium">Team</th>
              </tr>
            </thead>
            <tbody>
              {sortedPlayers.map((p) => {
                const delta =
                  p.ourProj != null && p.linestarProj != null
                    ? p.ourProj - p.linestarProj
                    : null;
                const value =
                  p.ourProj != null ? (p.ourProj / p.salary) * 1000 : null;
                return (
                  <tr key={p.id} className="border-b hover:bg-muted/30">
                    <td className="px-2 py-1 font-medium">{p.name}</td>
                    <td className="px-2 py-1 font-mono">${(p.salary / 1000).toFixed(1)}k</td>
                    <td className="px-2 py-1">
                      {p.linestarProj != null ? p.linestarProj.toFixed(1) : "–"}
                    </td>
                    <td className="px-2 py-1 font-medium">
                      {p.ourProj != null ? p.ourProj.toFixed(1) : "–"}
                    </td>
                    <td
                      className={`px-2 py-1 font-medium ${
                        delta == null
                          ? ""
                          : delta > 2
                          ? "text-green-600"
                          : delta < -2
                          ? "text-red-500"
                          : "text-muted-foreground"
                      }`}
                    >
                      {delta != null ? `${delta > 0 ? "+" : ""}${delta.toFixed(1)}` : "–"}
                    </td>
                    <td className="px-2 py-1">
                      {p.projOwnPct != null ? `${p.projOwnPct.toFixed(1)}%` : "–"}
                    </td>
                    <td className="px-2 py-1 font-medium">
                      {p.ourLeverage != null ? p.ourLeverage.toFixed(2) : "–"}
                    </td>
                    <td className="px-2 py-1">
                      {value != null ? value.toFixed(2) : "–"}
                    </td>
                    <td className="px-2 py-1 text-muted-foreground">
                      {p.eligiblePositions.replace("/UTIL", "").replace("G/F", "G/F")}
                    </td>
                    <td className="px-2 py-1">
                      <div className="flex items-center gap-1">
                        {p.teamLogo && (
                          <img src={p.teamLogo} alt="" className="h-4 w-4 object-contain" />
                        )}
                        <span className="text-muted-foreground">{p.teamAbbrev}</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Generated Lineups */}
      {lineups && lineups.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Generated Lineups ({lineups.length})
            </CardTitle>
            <CardDescription>
              {mode === "gpp" ? "Optimized for GPP leverage" : "Optimized for projected FPTS"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {lineups.map((lineup, i) => (
              <LineupCard key={i} lineup={lineup} num={i + 1} />
            ))}

            {/* Multi-entry export */}
            <div className="mt-4 space-y-2 rounded-lg border p-3">
              <p className="text-xs font-medium">Export to DraftKings</p>
              <p className="text-[11px] text-muted-foreground">
                Paste your DK multi-entry template CSV content below (or leave blank for a basic CSV):
              </p>
              <textarea
                className="w-full rounded border bg-muted/30 px-2 py-1.5 text-xs font-mono"
                rows={3}
                placeholder="Entry ID,Contest Name,Contest ID,Entry Fee,G,G,G,F,F,F,UTIL,UTIL&#10;5093586457,CBB $625...,189023743,$0.25,,,,,,,"
                value={entryTemplate}
                onChange={(e) => setEntryTemplate(e.target.value)}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={handleExport}
                disabled={isExporting}
              >
                {isExporting ? "Exporting…" : "Download CSV"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Accuracy Panel — only shown when actuals have been ingested */}
      {accuracy && <AccuracyPanel metrics={accuracy.metrics} players={accuracy.players} />}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────

function SplitUploadPanel({
  dkFileRef,
  lsFileRef,
  onLoadSlate,
  onRefreshLineStar,
  isPending,
  dkMessage,
  lsMessage,
  hasSlate,
}: {
  dkFileRef: React.RefObject<HTMLInputElement | null>;
  lsFileRef: React.RefObject<HTMLInputElement | null>;
  onLoadSlate: () => void;
  onRefreshLineStar: () => void;
  isPending: boolean;
  dkMessage: { ok: boolean; text: string } | null;
  lsMessage: { ok: boolean; text: string } | null;
  hasSlate: boolean;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {/* DK Salaries — load full slate */}
      <div className="space-y-2 rounded-lg border p-3">
        <p className="text-xs font-medium">
          DK Salary CSV
          <span className="ml-1 text-muted-foreground font-normal">— load new slate</span>
        </p>
        <input ref={dkFileRef} type="file" accept=".csv" className="text-xs" />
        {!hasSlate && (
          <>
            <p className="text-[11px] text-muted-foreground">Also select LineStar CSV →</p>
          </>
        )}
        <Button size="sm" onClick={onLoadSlate} disabled={isPending}>
          {isPending ? "Processing…" : "Load Slate"}
        </Button>
        {dkMessage && (
          <p className={`text-xs ${dkMessage.ok ? "text-green-600" : "text-red-500"}`}>
            {dkMessage.text}
          </p>
        )}
      </div>

      {/* LineStar — refresh ownership only */}
      <div className="space-y-2 rounded-lg border p-3">
        <p className="text-xs font-medium">
          LineStar CSV
          <span className="ml-1 text-muted-foreground font-normal">— refresh ownership %</span>
        </p>
        <input ref={lsFileRef} type="file" accept=".csv" className="text-xs" />
        <p className="text-[11px] text-muted-foreground">
          Updates projections + ownership on existing slate. Use as ownership updates throughout the day.
        </p>
        <Button size="sm" variant="outline" onClick={onRefreshLineStar} disabled={isPending}>
          {isPending ? "Refreshing…" : "Refresh LineStar"}
        </Button>
        {lsMessage && (
          <p className={`text-xs ${lsMessage.ok ? "text-green-600" : "text-red-500"}`}>
            {lsMessage.text}
          </p>
        )}
      </div>
    </div>
  );
}

const SLOT_LABELS: Record<string, string> = {
  G: "G", G2: "G", G3: "G",
  F: "F", F2: "F", F3: "F",
  UTIL: "UTIL", UTIL2: "UTIL",
};

function LineupCard({ lineup, num }: { lineup: GeneratedLineup; num: number }) {
  const slotOrder = ["G", "G2", "G3", "F", "F2", "F3", "UTIL", "UTIL2"] as const;

  // Detect stack (team with 2+ players)
  const teamCounts = new Map<string, number>();
  for (const p of lineup.players) {
    teamCounts.set(p.teamAbbrev, (teamCounts.get(p.teamAbbrev) ?? 0) + 1);
  }
  const stackTeam = Array.from(teamCounts.entries()).find(([, n]) => n >= 2)?.[0];

  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="font-bold text-foreground">#{num}</span>
        <span>${lineup.totalSalary.toLocaleString()} / $50,000</span>
        <span>Proj: {lineup.projFpts.toFixed(1)} FPTS</span>
        <span className="ml-auto">Leverage: {lineup.leverageScore.toFixed(1)}</span>
        {stackTeam && (
          <Badge variant="outline" className="text-[10px]">
            Stack: {stackTeam}
          </Badge>
        )}
      </div>
      <div className="grid grid-cols-4 gap-1">
        {slotOrder.map((slot) => {
          const p = lineup.slots[slot];
          if (!p) return null;
          const isStacked = p.teamAbbrev === stackTeam;
          return (
            <div
              key={slot}
              className={`rounded border px-1.5 py-1 text-[11px] ${isStacked ? "border-blue-500/40 bg-blue-500/5" : ""}`}
            >
              <div className="flex items-center gap-1">
                <span className="font-mono text-[9px] text-muted-foreground">{SLOT_LABELS[slot]}</span>
                {p.teamLogo && (
                  <img src={p.teamLogo} alt="" className="h-3 w-3 object-contain" />
                )}
              </div>
              <div className="font-medium leading-tight">{p.name}</div>
              <div className="text-muted-foreground">
                ${(p.salary / 1000).toFixed(1)}k · {p.ourProj?.toFixed(1) ?? "–"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AccuracyPanel({
  metrics,
  players,
}: {
  metrics: DfsAccuracyMetrics;
  players: DfsAccuracyRow[];
}) {
  const ourWon =
    metrics.ourMAE != null &&
    metrics.linestarMAE != null &&
    metrics.ourMAE < metrics.linestarMAE;
  const diff =
    metrics.ourMAE != null && metrics.linestarMAE != null
      ? Math.abs(metrics.ourMAE - metrics.linestarMAE)
      : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">
          Projection Accuracy — {metrics.slateDate}
        </CardTitle>
        <CardDescription>
          Based on {metrics.nOur} players with actual DK FPTS
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary metrics */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard
            label="Our MAE"
            value={metrics.ourMAE != null ? `${metrics.ourMAE.toFixed(2)} pts` : "–"}
            sub={metrics.ourBias != null ? `Bias: ${metrics.ourBias > 0 ? "+" : ""}${metrics.ourBias.toFixed(2)}` : undefined}
            highlight={ourWon}
          />
          <MetricCard
            label="LineStar MAE"
            value={metrics.linestarMAE != null ? `${metrics.linestarMAE.toFixed(2)} pts` : "–"}
            sub={metrics.linestarBias != null ? `Bias: ${metrics.linestarBias > 0 ? "+" : ""}${metrics.linestarBias.toFixed(2)}` : undefined}
            highlight={!ourWon && metrics.linestarMAE != null}
          />
          <MetricCard
            label="Winner"
            value={diff != null ? (ourWon ? "Our Model" : "LineStar") : "–"}
            sub={diff != null ? `By ${diff.toFixed(2)} pts/player` : undefined}
          />
          <MetricCard
            label="Sample"
            value={`${metrics.nOur} players`}
            sub={`LS: ${metrics.nLinestar}`}
          />
        </div>

        {/* Per-player error table */}
        <div className="overflow-x-auto">
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            Biggest misses (sorted by |Our Error|)
          </p>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-2 py-1">Player</th>
                <th className="px-2 py-1">Sal</th>
                <th className="px-2 py-1">Our Proj</th>
                <th className="px-2 py-1">LS Proj</th>
                <th className="px-2 py-1">Actual</th>
                <th className="px-2 py-1">Our Err</th>
                <th className="px-2 py-1">LS Err</th>
              </tr>
            </thead>
            <tbody>
              {players.slice(0, 30).map((p) => {
                const ourErr = p.ourProj != null && p.actualFpts != null ? p.ourProj - p.actualFpts : null;
                const lsErr = p.linestarProj != null && p.actualFpts != null ? p.linestarProj - p.actualFpts : null;
                return (
                  <tr key={p.id} className="border-b hover:bg-muted/30">
                    <td className="px-2 py-1">
                      <div className="flex items-center gap-1">
                        {p.teamLogo && <img src={p.teamLogo} alt="" className="h-3 w-3 object-contain" />}
                        <span className="font-medium">{p.name}</span>
                        <span className="text-muted-foreground">{p.teamAbbrev}</span>
                      </div>
                    </td>
                    <td className="px-2 py-1 font-mono">${(p.salary / 1000).toFixed(1)}k</td>
                    <td className="px-2 py-1">{p.ourProj?.toFixed(1) ?? "–"}</td>
                    <td className="px-2 py-1">{p.linestarProj?.toFixed(1) ?? "–"}</td>
                    <td className="px-2 py-1 font-medium">{p.actualFpts?.toFixed(1) ?? "–"}</td>
                    <td className={`px-2 py-1 font-medium ${ourErr == null ? "" : Math.abs(ourErr) > 10 ? "text-red-500" : Math.abs(ourErr) < 4 ? "text-green-600" : ""}`}>
                      {ourErr != null ? `${ourErr > 0 ? "+" : ""}${ourErr.toFixed(1)}` : "–"}
                    </td>
                    <td className={`px-2 py-1 ${lsErr == null ? "text-muted-foreground" : Math.abs(lsErr) > 10 ? "text-red-400" : ""}`}>
                      {lsErr != null ? `${lsErr > 0 ? "+" : ""}${lsErr.toFixed(1)}` : "–"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function MetricCard({
  label, value, sub, highlight,
}: {
  label: string; value: string; sub?: string; highlight?: boolean;
}) {
  return (
    <div className={`rounded-lg border p-2.5 ${highlight ? "border-green-500/40 bg-green-500/5" : ""}`}>
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="text-sm font-bold">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}
