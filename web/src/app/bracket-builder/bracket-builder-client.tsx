"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import type {
  BracketBuilderTeam,
  BracketMatchupRow,
  SimAdvancement,
  TopPlayer,
  TeamProfileRow,
} from "@/db/queries";
import {
  buildSlotMap,
  resolveSlotTeams,
  computeProb,
  clearDownstreamPicks,
  getDownstreamSlots as getDownstream,
  countPicks,
  TOTAL_GAMES,
  REGIONS,
  ROUNDS,
  ROUND_LABELS,
  FF_PAIRINGS,
  SEED_ORDER,
  type BracketTeam,
  type PickState,
  type SlotDef,
} from "@/lib/bracket-logic";
import MatchupDetailModal from "./matchup-detail-modal";

// ── Storage key ──────────────────────────────────────────────

const STORAGE_KEY = "bracket-builder-picks-2026";

function loadPicks(): PickState {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function savePicks(picks: PickState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(picks));
  } catch {}
}

// ── Props ────────────────────────────────────────────────────

interface Props {
  teams: BracketBuilderTeam[];
  matchups: BracketMatchupRow[];
  simResults: SimAdvancement[];
  players: TopPlayer[];
  profiles: TeamProfileRow[];
}

// ── Matchup Slot Component ───────────────────────────────────

function MatchupSlot({
  slotDef,
  teamA,
  teamB,
  winnerId,
  prob,
  modelProb,
  championTeamIds,
  isLocked,
  onPick,
  onDetail,
}: {
  slotDef: SlotDef;
  teamA: BracketTeam | undefined;
  teamB: BracketTeam | undefined;
  winnerId: number | null;
  prob: number | null;
  modelProb: number | null;
  championTeamIds: Set<number>;
  isLocked?: boolean;
  onPick: (slotId: string, teamId: number) => void;
  onDetail: (slotId: string) => void;
}) {
  const bothPresent = !!teamA && !!teamB;
  const canInteract = bothPresent && !isLocked;
  const displayProb = modelProb ?? prob;

  return (
    <div className="rounded-md border bg-card text-xs w-full min-w-0">
      {/* Team A row */}
      <TeamRow
        team={teamA}
        isWinner={winnerId === teamA?.teamId}
        isLoser={winnerId != null && winnerId !== teamA?.teamId}
        canPick={canInteract}
        isChampionContender={teamA ? championTeamIds.has(teamA.teamId) : false}
        onClick={() => teamA && onPick(slotDef.id, teamA.teamId)}
      />

      {/* Probability bar (clickable for details) */}
      {bothPresent && displayProb != null ? (
        <button
          onClick={() => onDetail(slotDef.id)}
          className="w-full flex h-3.5 overflow-hidden bg-muted/50 cursor-pointer hover:opacity-80 transition-opacity border-y"
          title="Click for detailed comparison"
        >
          <div
            className="flex items-center justify-center bg-blue-500/80 text-[8px] font-bold text-white"
            style={{ width: `${Math.round(displayProb * 100)}%` }}
          >
            {displayProb > 0.2 && `${Math.round(displayProb * 100)}%`}
          </div>
          <div
            className="flex items-center justify-center bg-red-400/80 text-[8px] font-bold text-white"
            style={{ width: `${Math.round((1 - displayProb) * 100)}%` }}
          >
            {displayProb < 0.8 &&
              `${Math.round((1 - displayProb) * 100)}%`}
          </div>
        </button>
      ) : bothPresent ? (
        <div className="h-3.5 bg-muted/30 border-y" />
      ) : (
        <div className="h-3.5 border-y border-dashed border-muted" />
      )}

      {/* Team B row */}
      <TeamRow
        team={teamB}
        isWinner={winnerId === teamB?.teamId}
        isLoser={winnerId != null && winnerId !== teamB?.teamId}
        canPick={canInteract}
        isChampionContender={teamB ? championTeamIds.has(teamB.teamId) : false}
        onClick={() => teamB && onPick(slotDef.id, teamB.teamId)}
      />
    </div>
  );
}

function TeamRow({
  team,
  isWinner,
  isLoser,
  canPick,
  isChampionContender,
  onClick,
}: {
  team: BracketTeam | undefined;
  isWinner: boolean;
  isLoser: boolean;
  canPick: boolean;
  isChampionContender: boolean;
  onClick: () => void;
}) {
  if (!team) {
    return (
      <div className="flex items-center gap-1 px-1.5 py-1 h-7 text-muted-foreground/50 italic">
        TBD
      </div>
    );
  }

  return (
    <button
      onClick={onClick}
      disabled={!canPick}
      className={`flex items-center gap-1 px-1.5 py-0.5 h-7 w-full text-left transition-colors min-w-0 ${
        canPick ? "hover:bg-accent cursor-pointer" : ""
      } ${isWinner ? "bg-emerald-50 dark:bg-emerald-950/30 font-bold" : ""} ${
        isLoser ? "opacity-40" : ""
      }`}
    >
      {isChampionContender && !isLoser && (
        <span
          className="text-amber-500 text-[9px] shrink-0"
          title="Championship contender"
        >
          &#9733;
        </span>
      )}
      <span className="w-4 text-right font-mono text-[10px] text-muted-foreground shrink-0">
        {team.seed}
      </span>
      {team.logoUrl && (
        <img
          src={team.logoUrl}
          alt=""
          className="h-4 w-4 object-contain shrink-0"
        />
      )}
      <span className={`truncate text-[11px] ${team.teamId < 0 ? "italic text-muted-foreground" : ""}`}>
        {team.teamId < 0 ? "TBD (First Four)" : team.name}
      </span>
      {isWinner && (
        <span className="ml-auto text-emerald-600 text-[10px] shrink-0">
          &#10003;
        </span>
      )}
    </button>
  );
}

// ── Region Bracket Component ─────────────────────────────────

function RegionBracket({
  region,
  slots,
  teamMap,
  picks,
  r64ModelProbs,
  championTeamIds,
  lockedSlotIds,
  onPick,
  onDetail,
  mirrored,
}: {
  region: string;
  slots: Map<string, SlotDef>;
  teamMap: Map<number, BracketTeam>;
  picks: PickState;
  r64ModelProbs: Map<string, number>;
  championTeamIds: Set<number>;
  lockedSlotIds: Set<string>;
  onPick: (slotId: string, teamId: number) => void;
  onDetail: (slotId: string) => void;
  mirrored?: boolean;
}) {
  const roundCols = ["R64", "R32", "S16", "E8"] as const;
  const columns = mirrored ? [...roundCols].reverse() : roundCols;

  // Get all slots for this region grouped by round
  const roundSlots: Record<string, SlotDef[]> = {};
  for (const round of roundCols) {
    roundSlots[round] = [];
    for (const [, def] of slots) {
      if (def.region === region && def.round === round) {
        roundSlots[round].push(def);
      }
    }
    roundSlots[round].sort((a, b) => a.slot - b.slot);
  }

  return (
    <div className="space-y-1">
      <h3 className="text-xs font-semibold text-muted-foreground text-center">
        {region}
      </h3>
      <div
        className="grid gap-x-1"
        style={{ gridTemplateColumns: `repeat(4, minmax(0, 1fr))` }}
      >
        {columns.map((round) => {
          const slotsForRound = roundSlots[round];
          const gapMap: Record<string, string> = {
            R64: "gap-y-0.5",
            R32: "gap-y-6",
            S16: "gap-y-16",
            E8: "gap-y-0",
          };

          return (
            <div
              key={round}
              className={`flex flex-col justify-around ${gapMap[round]}`}
            >
              {slotsForRound.map((def) => {
                const { teamAId, teamBId } = resolveSlotTeams(
                  def.id,
                  slots,
                  picks
                );
                const teamA = teamAId ? teamMap.get(teamAId) : undefined;
                const teamB = teamBId ? teamMap.get(teamBId) : undefined;
                const prob = computeProb(teamA, teamB);
                const modelProb = r64ModelProbs.get(def.id) ?? null;

                return (
                  <MatchupSlot
                    key={def.id}
                    slotDef={def}
                    teamA={teamA}
                    teamB={teamB}
                    winnerId={picks[def.id] ?? null}
                    prob={prob}
                    modelProb={modelProb}
                    championTeamIds={championTeamIds}
                    isLocked={lockedSlotIds.has(def.id)}
                    onPick={onPick}
                    onDetail={onDetail}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Final Four Component ─────────────────────────────────────

function FinalFourPanel({
  slots,
  teamMap,
  picks,
  championTeamIds,
  onPick,
  onDetail,
}: {
  slots: Map<string, SlotDef>;
  teamMap: Map<number, BracketTeam>;
  picks: PickState;
  championTeamIds: Set<number>;
  onPick: (slotId: string, teamId: number) => void;
  onDetail: (slotId: string) => void;
}) {
  const f4Slots = [1, 2].map((s) => slots.get(`F4-FF-${s}`)!).filter(Boolean);
  const ncgSlot = slots.get("NCG-FF-1");
  const championId = ncgSlot ? picks["NCG-FF-1"] : null;
  const champion = championId ? teamMap.get(championId) : null;

  return (
    <div className="flex flex-col items-center gap-2 py-4">
      <h3 className="text-xs font-semibold text-muted-foreground">
        Final Four
      </h3>

      <div className="flex items-center gap-4">
        {f4Slots.map((def, i) => {
          const { teamAId, teamBId } = resolveSlotTeams(
            def.id,
            slots,
            picks
          );
          const teamA = teamAId ? teamMap.get(teamAId) : undefined;
          const teamB = teamBId ? teamMap.get(teamBId) : undefined;
          const prob = computeProb(teamA, teamB);

          return (
            <div key={def.id} className="w-40">
              <div className="text-[9px] text-center text-muted-foreground mb-0.5">
                {FF_PAIRINGS[i]?.join(" vs ")}
              </div>
              <MatchupSlot
                slotDef={def}
                teamA={teamA}
                teamB={teamB}
                winnerId={picks[def.id] ?? null}
                prob={prob}
                modelProb={null}
                championTeamIds={championTeamIds}
                onPick={onPick}
                onDetail={onDetail}
              />
            </div>
          );
        })}
      </div>

      {/* Championship */}
      {ncgSlot && (
        <div className="w-44">
          <h3 className="text-[9px] font-semibold text-muted-foreground text-center mb-0.5">
            Championship
          </h3>
          {(() => {
            const { teamAId, teamBId } = resolveSlotTeams(
              ncgSlot.id,
              slots,
              picks
            );
            const teamA = teamAId ? teamMap.get(teamAId) : undefined;
            const teamB = teamBId ? teamMap.get(teamBId) : undefined;
            const prob = computeProb(teamA, teamB);
            return (
              <MatchupSlot
                slotDef={ncgSlot}
                teamA={teamA}
                teamB={teamB}
                winnerId={picks[ncgSlot.id] ?? null}
                prob={prob}
                modelProb={null}
                championTeamIds={championTeamIds}
                onPick={onPick}
                onDetail={onDetail}
              />
            );
          })()}
        </div>
      )}

      {/* Champion display */}
      {champion && (
        <div className="mt-2 flex flex-col items-center gap-1 rounded-lg border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30 px-6 py-3">
          {champion.logoUrl && (
            <img
              src={champion.logoUrl}
              alt=""
              className="h-10 w-10 object-contain"
            />
          )}
          <div className="text-sm font-bold">{champion.name}</div>
          <div className="text-[10px] text-amber-700 dark:text-amber-400 font-medium">
            National Champion
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Bracket Builder ─────────────────────────────────────

export default function BracketBuilderClient({
  teams,
  matchups,
  simResults,
  players,
  profiles,
}: Props) {
  const [picks, setPicks] = useState<PickState>({});
  const [detailSlotId, setDetailSlotId] = useState<string | null>(null);
  const [activeRegion, setActiveRegion] = useState<string>("all");
  const [loaded, setLoaded] = useState(false);

  // Derive locked picks from DB results (slots with a confirmed winner)
  const lockedSlotIds = useMemo(() => {
    const s = new Set<string>();
    for (const mu of matchups) {
      if (mu.winnerId != null && mu.region) {
        s.add(`${mu.round}-${mu.region}-${mu.matchupSlot}`);
      }
    }
    return s;
  }, [matchups]);

  const lockedPicks = useMemo(() => {
    const lp: PickState = {};
    for (const mu of matchups) {
      if (mu.winnerId != null && mu.region) {
        lp[`${mu.round}-${mu.region}-${mu.matchupSlot}`] = mu.winnerId;
      }
    }
    return lp;
  }, [matchups]);

  // Load picks from localStorage on mount, locked results always win
  useEffect(() => {
    const stored = loadPicks();
    setPicks({ ...stored, ...lockedPicks });
    setLoaded(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save picks on change
  useEffect(() => {
    if (loaded) savePicks(picks);
  }, [picks, loaded]);

  // Inject placeholder teams for missing First Four seeds so 1-seeds can advance
  const teamsWithPlaceholders = useMemo(() => {
    const all: BracketBuilderTeam[] = [...teams];
    const regionSeeds = new Map<string, Set<number>>();
    for (const t of teams) {
      if (!regionSeeds.has(t.region)) regionSeeds.set(t.region, new Set());
      regionSeeds.get(t.region)!.add(t.seed);
    }

    let placeholderId = -1;
    for (const region of REGIONS) {
      const seeds = regionSeeds.get(region) ?? new Set();
      for (let i = 0; i < SEED_ORDER.length; i += 2) {
        const seedA = SEED_ORDER[i];
        const seedB = SEED_ORDER[i + 1];
        // If one team exists but opponent doesn't, create a TBD placeholder
        for (const missingSeed of [seedA, seedB]) {
          const otherSeed = missingSeed === seedA ? seedB : seedA;
          if (!seeds.has(missingSeed) && seeds.has(otherSeed)) {
            all.push({
              teamId: placeholderId--,
              name: "TBD",
              seed: missingSeed,
              region,
              conference: null,
              logoUrl: null,
              barthag: null,
              adjOe: null,
              adjDe: null,
              adjEm: null,
              adjTempo: null,
              rank: null,
              wins: null,
              losses: null,
            });
          }
        }
      }
    }
    return all;
  }, [teams]);

  // Build team lookup map
  const teamMap = useMemo(() => {
    const m = new Map<number, BracketTeam>();
    for (const t of teamsWithPlaceholders) m.set(t.teamId, t);
    return m;
  }, [teamsWithPlaceholders]);

  // Build slot map
  const slots = useMemo(() => buildSlotMap(teamsWithPlaceholders), [teamsWithPlaceholders]);

  // Build R64 model probability map (slotId -> probA)
  const r64ModelProbs = useMemo(() => {
    const m = new Map<string, number>();
    for (const matchup of matchups) {
      if (matchup.modelProbA == null) continue;
      for (const [slotId, def] of slots) {
        if (def.round !== "R64") continue;
        // Match by team IDs (check both orderings)
        if (
          def.presetTeamAId === matchup.teamAId &&
          def.presetTeamBId === matchup.teamBId
        ) {
          m.set(slotId, matchup.modelProbA!);
          break;
        }
        if (
          def.presetTeamAId === matchup.teamBId &&
          def.presetTeamBId === matchup.teamAId
        ) {
          m.set(slotId, 1 - matchup.modelProbA!);
          break;
        }
      }
    }
    return m;
  }, [matchups, slots]);

  // Build matchup lookup by team pair (for Vegas/model data in any round)
  const matchupLookup = useMemo(() => {
    const m = new Map<string, BracketMatchupRow>();
    for (const mu of matchups) {
      // Store under canonical key (smaller id first)
      const key = `${Math.min(mu.teamAId, mu.teamBId)}-${Math.max(mu.teamAId, mu.teamBId)}`;
      m.set(key, mu);
    }
    return m;
  }, [matchups]);

  // Championship contenders from simulation data (≥3% champion probability)
  const championTeamIds = useMemo(() => {
    const s = new Set<number>();
    for (const sim of simResults) {
      if (sim.round === "Champion" && sim.advancementPct >= 0.03) {
        s.add(sim.teamId);
      }
    }
    return s;
  }, [simResults]);

  // Profile map: teamId → TeamProfileRow
  const profileMap = useMemo(() => {
    const m = new Map<number, TeamProfileRow>();
    for (const p of profiles) m.set(p.teamId, p);
    return m;
  }, [profiles]);

  // Build sim results lookup: teamId -> { round -> pct }
  const simMap = useMemo(() => {
    const m = new Map<number, Map<string, number>>();
    for (const s of simResults) {
      if (!m.has(s.teamId)) m.set(s.teamId, new Map());
      m.get(s.teamId)!.set(s.round, s.advancementPct);
    }
    return m;
  }, [simResults]);

  // Build players lookup: teamId -> TopPlayer[]
  const playerMap = useMemo(() => {
    const m = new Map<number, typeof players>();
    for (const p of players) {
      if (!m.has(p.teamId)) m.set(p.teamId, []);
      m.get(p.teamId)!.push(p);
    }
    // Keep top 5 per team
    for (const [tid, list] of m) {
      m.set(tid, list.slice(0, 5));
    }
    return m;
  }, [players]);

  // Pick handler with cascading clear
  const handlePick = useCallback(
    (slotId: string, teamId: number) => {
      if (lockedSlotIds.has(slotId)) return;

      setPicks((prev) => {
        // If clicking the same team that's already picked, unpick
        if (prev[slotId] === teamId) {
          const next = { ...prev };
          delete next[slotId];
          // Clear all downstream non-locked slots
          const downstream = getDownstream(slotId, slots);
          for (const dsId of downstream) {
            if (!lockedSlotIds.has(dsId)) delete next[dsId];
          }
          return next;
        }

        const { teamAId, teamBId } = resolveSlotTeams(slotId, slots, prev);
        const eliminatedId =
          teamId === teamAId ? teamBId : teamAId;

        let next = { ...prev, [slotId]: teamId };

        // Clear downstream picks of the eliminated team
        if (eliminatedId != null) {
          next = clearDownstreamPicks(slotId, eliminatedId, next, slots);
          // Re-apply locked picks that may have been cleared
          for (const [lid, lval] of Object.entries(lockedPicks)) {
            next[lid] = lval;
          }
        }

        return next;
      });
    },
    [slots, lockedSlotIds, lockedPicks]
  );

  const handleDetail = useCallback((slotId: string) => {
    setDetailSlotId(slotId);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setDetailSlotId(null);
  }, []);

  const handleReset = useCallback(() => {
    setPicks({ ...lockedPicks });
  }, [lockedPicks]);

  const handleAutoChalk = useCallback(() => {
    const newPicks: PickState = { ...lockedPicks };

    // Auto-fill: for each slot, pick the team with higher Barthag
    const roundOrder = ["R64", "R32", "S16", "E8", "F4", "NCG"];
    for (const round of roundOrder) {
      for (const [slotId, def] of slots) {
        if (def.round !== round) continue;
        if (lockedSlotIds.has(slotId)) continue;

        const { teamAId, teamBId } = resolveSlotTeams(
          slotId,
          slots,
          newPicks
        );
        if (!teamAId || !teamBId) continue;

        const a = teamMap.get(teamAId);
        const b = teamMap.get(teamBId);
        if (!a || !b) continue;

        const winner =
          (a.barthag ?? 0) >= (b.barthag ?? 0) ? teamAId : teamBId;
        newPicks[slotId] = winner;
      }
    }

    setPicks(newPicks);
  }, [slots, teamMap, lockedPicks, lockedSlotIds]);

  const pickCount = countPicks(picks);

  // Detail modal data
  const detailData = useMemo(() => {
    if (!detailSlotId) return null;
    const { teamAId, teamBId } = resolveSlotTeams(
      detailSlotId,
      slots,
      picks
    );
    const teamA = teamAId ? teamMap.get(teamAId) : undefined;
    const teamB = teamBId ? teamMap.get(teamBId) : undefined;
    if (!teamA || !teamB) return null;

    // Look up matchup data (Vegas, model) for this team pair
    const lookupKey = `${Math.min(teamA.teamId, teamB.teamId)}-${Math.max(teamA.teamId, teamB.teamId)}`;
    const matchup = matchupLookup.get(lookupKey);
    const isReversed = matchup ? matchup.teamAId !== teamA.teamId : false;

    return {
      slotId: detailSlotId,
      slotDef: slots.get(detailSlotId)!,
      teamA,
      teamB,
      prob: computeProb(teamA, teamB),
      modelProb: matchup?.modelProbA != null
        ? (isReversed ? 1 - matchup.modelProbA : matchup.modelProbA)
        : (r64ModelProbs.get(detailSlotId) ?? null),
      vegasProb: matchup?.vegasProbA != null
        ? (isReversed ? 1 - matchup.vegasProbA : matchup.vegasProbA)
        : null,
      vegasSpread: matchup?.vegasSpreadA != null
        ? (isReversed ? -(matchup.vegasSpreadA) : matchup.vegasSpreadA)
        : null,
      vegasTotal: matchup?.vegasTotal ?? null,
      vegasMlA: matchup
        ? (isReversed ? matchup.vegasMlB : matchup.vegasMlA)
        : null,
      vegasMlB: matchup
        ? (isReversed ? matchup.vegasMlA : matchup.vegasMlB)
        : null,
      profileA: profileMap.get(teamA.teamId),
      profileB: profileMap.get(teamB.teamId),
      playersA: playerMap.get(teamA.teamId) ?? [],
      playersB: playerMap.get(teamB.teamId) ?? [],
      simA: simMap.get(teamA.teamId) ?? new Map(),
      simB: simMap.get(teamB.teamId) ?? new Map(),
    };
  }, [detailSlotId, slots, picks, teamMap, r64ModelProbs, matchupLookup, profileMap, playerMap, simMap]);

  if (!loaded) return null;

  return (
    <>
      {/* Top bar: progress + actions */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-2">
        <div className="text-sm">
          <span className="font-bold">{pickCount}</span>
          <span className="text-muted-foreground">/{TOTAL_GAMES} picks</span>
        </div>
        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500 rounded-full transition-all"
            style={{ width: `${(pickCount / TOTAL_GAMES) * 100}%` }}
          />
        </div>
        {pickCount === TOTAL_GAMES && (
          <span className="text-xs font-bold text-emerald-600">
            Bracket Complete!
          </span>
        )}

        {/* Mobile region selector */}
        <div className="flex items-center gap-1 lg:hidden">
          {["all", ...REGIONS, "FF"].map((r) => (
            <button
              key={r}
              onClick={() => setActiveRegion(r)}
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
                activeRegion === r
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {r === "FF" ? "F4" : r === "all" ? "All" : r}
            </button>
          ))}
        </div>

        <div className="flex gap-2 ml-auto">
          <button
            onClick={handleAutoChalk}
            className="rounded-md border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent transition-colors"
          >
            Auto-fill (chalk)
          </button>
          <button
            onClick={handleReset}
            className="rounded-md border border-red-200 px-2.5 py-1 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Desktop: full bracket layout */}
      <div className="hidden lg:block overflow-x-auto">
        <div className="min-w-[1200px]">
          {/* Top row: East + Midwest */}
          <div className="grid grid-cols-[1fr_auto_1fr] gap-2">
            {/* Left region */}
            <RegionBracket
              region="East"
              slots={slots}
              teamMap={teamMap}
              picks={picks}
              r64ModelProbs={r64ModelProbs}
              championTeamIds={championTeamIds}
              lockedSlotIds={lockedSlotIds}
              onPick={handlePick}
              onDetail={handleDetail}
            />

            {/* Final Four center */}
            <FinalFourPanel
              slots={slots}
              teamMap={teamMap}
              picks={picks}
              championTeamIds={championTeamIds}
              onPick={handlePick}
              onDetail={handleDetail}
            />

            {/* Right region (mirrored) */}
            <RegionBracket
              region="Midwest"
              slots={slots}
              teamMap={teamMap}
              picks={picks}
              r64ModelProbs={r64ModelProbs}
              championTeamIds={championTeamIds}
              lockedSlotIds={lockedSlotIds}
              onPick={handlePick}
              onDetail={handleDetail}
              mirrored
            />
          </div>

          {/* Bottom row: South + West */}
          <div className="grid grid-cols-[1fr_auto_1fr] gap-2 mt-6">
            <RegionBracket
              region="South"
              slots={slots}
              teamMap={teamMap}
              picks={picks}
              r64ModelProbs={r64ModelProbs}
              championTeamIds={championTeamIds}
              lockedSlotIds={lockedSlotIds}
              onPick={handlePick}
              onDetail={handleDetail}
            />

            <div className="w-44" /> {/* Spacer for center alignment */}

            <RegionBracket
              region="West"
              slots={slots}
              teamMap={teamMap}
              picks={picks}
              r64ModelProbs={r64ModelProbs}
              championTeamIds={championTeamIds}
              lockedSlotIds={lockedSlotIds}
              onPick={handlePick}
              onDetail={handleDetail}
              mirrored
            />
          </div>
        </div>
      </div>

      {/* Mobile: region tabs */}
      <div className="lg:hidden space-y-4">
        {activeRegion === "all" ? (
          REGIONS.map((region) => (
            <RegionBracket
              key={region}
              region={region}
              slots={slots}
              teamMap={teamMap}
              picks={picks}
              r64ModelProbs={r64ModelProbs}
              championTeamIds={championTeamIds}
              lockedSlotIds={lockedSlotIds}
              onPick={handlePick}
              onDetail={handleDetail}
            />
          ))
        ) : activeRegion === "FF" ? (
          <FinalFourPanel
            slots={slots}
            teamMap={teamMap}
            picks={picks}
            championTeamIds={championTeamIds}
            onPick={handlePick}
            onDetail={handleDetail}
          />
        ) : (
          <RegionBracket
            region={activeRegion}
            slots={slots}
            teamMap={teamMap}
            picks={picks}
            r64ModelProbs={r64ModelProbs}
            championTeamIds={championTeamIds}
            lockedSlotIds={lockedSlotIds}
            onPick={handlePick}
            onDetail={handleDetail}
          />
        )}
      </div>

      {/* Detail Modal */}
      {detailData && (
        <MatchupDetailModal
          {...detailData}
          winnerId={picks[detailData.slotId] ?? null}
          onPick={(teamId) => {
            handlePick(detailData.slotId, teamId);
            handleCloseDetail();
          }}
          onClose={handleCloseDetail}
        />
      )}
    </>
  );
}
