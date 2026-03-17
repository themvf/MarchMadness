"use client";

import { ROUNDS, ROUND_LABELS, type BracketTeam } from "@/lib/bracket-logic";
import type { TopPlayer, SimAdvancement, TeamProfileRow } from "@/db/queries";
import type { SlotDef } from "@/lib/bracket-logic";
import { getArchetypes, archetypeBadgeClass } from "@/lib/archetypes";

interface Props {
  slotId: string;
  slotDef: SlotDef;
  teamA: BracketTeam;
  teamB: BracketTeam;
  prob: number | null;
  modelProb: number | null;
  vegasProb: number | null;
  vegasSpread: number | null;
  vegasTotal: number | null;
  vegasMlA: number | null;
  vegasMlB: number | null;
  profileA: TeamProfileRow | undefined;
  profileB: TeamProfileRow | undefined;
  playersA: TopPlayer[];
  playersB: TopPlayer[];
  simA: Map<string, number>;
  simB: Map<string, number>;
  winnerId: number | null;
  onPick: (teamId: number) => void;
  onClose: () => void;
}

// ── Probit: convert win probability → expected point margin ───

function probToMargin(prob: number): number {
  // Abramowitz & Stegun rational approximation of the normal quantile
  // Multiply by ~11 (college basketball outcome standard deviation)
  const p = Math.max(0.01, Math.min(0.99, prob));
  const sign = p >= 0.5 ? 1 : -1;
  const q = sign === 1 ? p : 1 - p;
  const t = Math.sqrt(-2 * Math.log(1 - q));
  const z =
    t -
    (2.515517 + 0.802853 * t + 0.010328 * t * t) /
      (1 + 1.432788 * t + 0.189269 * t * t + 0.001308 * t * t * t);
  return sign * z * 11;
}

// ── Projected score from efficiency stats + win probability ──

function computeProjectedScores(
  teamA: BracketTeam,
  teamB: BracketTeam,
  displayProb: number | null
): { scoreA: number; scoreB: number } | null {
  if (
    teamA.adjOe == null || teamA.adjDe == null || teamA.adjTempo == null ||
    teamB.adjOe == null || teamB.adjDe == null || teamB.adjTempo == null
  ) {
    return null;
  }
  const poss = (teamA.adjTempo + teamB.adjTempo) / 2;
  // Projected total from efficiency averages
  const rawA = poss * ((teamA.adjOe + teamB.adjDe) / 2) / 100;
  const rawB = poss * ((teamB.adjOe + teamA.adjDe) / 2) / 100;
  const total = rawA + rawB;

  // Derive margin from win probability so scores are consistent with the displayed %
  const margin = displayProb != null ? probToMargin(displayProb) : rawA - rawB;
  const scoreA = (total + margin) / 2;
  const scoreB = (total - margin) / 2;
  return { scoreA, scoreB };
}

function vegasProjectedScores(
  spread: number | null,
  total: number | null
): { scoreA: number; scoreB: number } | null {
  if (spread == null || total == null) return null;
  // spread < 0 means team A is favored
  const scoreA = (total - spread) / 2;
  const scoreB = (total + spread) / 2;
  return { scoreA, scoreB };
}

// ── Probability bar component ─────────────────────────────────

function ProbBar({
  label,
  probA,
  colorA,
  colorB,
}: {
  label: string;
  probA: number;
  colorA: string;
  colorB: string;
}) {
  const pctA = Math.round(probA * 100);
  const pctB = 100 - pctA;
  return (
    <div>
      <div className="text-[10px] text-muted-foreground mb-0.5">{label}</div>
      <div className="flex h-6 w-full overflow-hidden rounded-full bg-muted text-xs font-bold">
        <div
          className={`flex items-center justify-center text-white ${colorA}`}
          style={{ width: `${pctA}%` }}
        >
          {pctA > 15 && `${pctA}%`}
        </div>
        <div
          className={`flex items-center justify-center text-white ${colorB}`}
          style={{ width: `${pctB}%` }}
        >
          {pctB > 15 && `${pctB}%`}
        </div>
      </div>
    </div>
  );
}

// ── Stat comparison row ───────────────────────────────────────

function StatRow({
  label,
  valA,
  valB,
  higherIsBetter = true,
}: {
  label: string;
  valA: number | null;
  valB: number | null;
  higherIsBetter?: boolean;
}) {
  const bothPresent = valA != null && valB != null;
  const a = valA ?? 0;
  const b = valB ?? 0;
  const aWins = bothPresent && (higherIsBetter ? a > b : a < b);
  const bWins = bothPresent && (higherIsBetter ? b > a : b < a);

  return (
    <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center py-0.5">
      <div
        className={`text-right font-mono text-sm ${
          aWins ? "font-bold text-blue-600" : ""
        }`}
      >
        {valA?.toFixed(1) ?? "---"}
      </div>
      <div className="text-[10px] text-muted-foreground w-16 text-center">
        {label}
      </div>
      <div
        className={`text-left font-mono text-sm ${
          bWins ? "font-bold text-red-500" : ""
        }`}
      >
        {valB?.toFixed(1) ?? "---"}
      </div>
    </div>
  );
}

// ── Player table ──────────────────────────────────────────────

function PlayerTable({
  players,
  color,
}: {
  players: TopPlayer[];
  color: string;
}) {
  if (players.length === 0) {
    return (
      <div className="text-xs text-muted-foreground italic py-2">
        No player data
      </div>
    );
  }

  return (
    <table className="w-full text-[11px]">
      <thead>
        <tr className="text-muted-foreground">
          <th className="text-left font-medium py-0.5">Player</th>
          <th className="text-right font-medium">PPG</th>
          <th className="text-right font-medium">RPG</th>
          <th className="text-right font-medium">APG</th>
        </tr>
      </thead>
      <tbody>
        {players.map((p) => (
          <tr key={p.name}>
            <td className="py-0.5">
              <span className={`font-medium ${color}`}>{p.name}</span>
              {p.position && (
                <span className="text-muted-foreground ml-1">
                  {p.position}
                </span>
              )}
            </td>
            <td className="text-right font-mono">{p.ppg?.toFixed(1)}</td>
            <td className="text-right font-mono">{p.rpg?.toFixed(1)}</td>
            <td className="text-right font-mono">{p.apg?.toFixed(1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Moneyline formatting ──────────────────────────────────────

function formatMl(ml: number | null): string {
  if (ml == null) return "---";
  return ml > 0 ? `+${ml}` : `${ml}`;
}

// ── Main Modal ────────────────────────────────────────────────

export default function MatchupDetailModal({
  slotDef,
  teamA,
  teamB,
  prob,
  modelProb,
  vegasProb,
  vegasSpread,
  vegasTotal,
  vegasMlA,
  vegasMlB,
  profileA,
  profileB,
  playersA,
  playersB,
  simA,
  simB,
  winnerId,
  onPick,
  onClose,
}: Props) {
  const roundLabel = ROUND_LABELS[slotDef.round] ?? slotDef.round;
  const archetypesA = getArchetypes(profileA);
  const archetypesB = getArchetypes(profileB);
  const displayProb = modelProb ?? prob;
  const modelScores = computeProjectedScores(teamA, teamB, displayProb);
  const vegasScores = vegasProjectedScores(vegasSpread, vegasTotal);
  const hasAnyProb = modelProb != null || prob != null || vegasProb != null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-8 px-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50" />

      {/* Modal */}
      <div
        className="relative bg-background rounded-xl border shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-background/95 backdrop-blur border-b px-5 py-3 flex items-center justify-between z-10">
          <div>
            <div className="text-xs text-muted-foreground">
              {roundLabel}
              {slotDef.region !== "FF" && ` - ${slotDef.region}`}
            </div>
            <div className="font-semibold text-sm">Matchup Analysis</div>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-xl leading-none px-2"
          >
            &times;
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* Team headers */}
          <div className="text-center space-y-3">
            <div className="flex items-center justify-center gap-4">
              <div className="flex items-center gap-2">
                {teamA.logoUrl && (
                  <img
                    src={teamA.logoUrl}
                    alt=""
                    className="h-10 w-10 object-contain"
                  />
                )}
                <div className="text-left">
                  <div className="font-bold text-sm">
                    #{teamA.seed} {teamA.name}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {teamA.conference} &middot; {teamA.wins}-{teamA.losses} &middot; #{teamA.rank}
                  </div>
                </div>
              </div>

              <span className="text-lg text-muted-foreground font-light">
                vs
              </span>

              <div className="flex items-center gap-2">
                <div className="text-right">
                  <div className="font-bold text-sm">
                    #{teamB.seed} {teamB.name}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {teamB.conference} &middot; {teamB.wins}-{teamB.losses} &middot; #{teamB.rank}
                  </div>
                </div>
                {teamB.logoUrl && (
                  <img
                    src={teamB.logoUrl}
                    alt=""
                    className="h-10 w-10 object-contain"
                  />
                )}
              </div>
            </div>
          </div>

          {/* Archetypes (Team DNA) */}
          {(archetypesA.length > 0 || archetypesB.length > 0) && (
            <div className="rounded-lg border p-3">
              <h4 className="text-xs font-semibold text-muted-foreground mb-2 text-center">
                Team DNA
              </h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] font-medium text-blue-600 mb-1 flex items-center gap-1">
                    {teamA.logoUrl && (
                      <img src={teamA.logoUrl} alt="" className="h-3 w-3 object-contain" />
                    )}
                    {teamA.name}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {archetypesA.map((a) => (
                      <span
                        key={a.label}
                        title={a.tip}
                        className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${archetypeBadgeClass(a.kind)}`}
                      >
                        {a.label}
                      </span>
                    ))}
                    {archetypesA.length === 0 && (
                      <span className="text-[10px] text-muted-foreground italic">No archetypes</span>
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-medium text-red-500 mb-1 flex items-center gap-1">
                    {teamB.logoUrl && (
                      <img src={teamB.logoUrl} alt="" className="h-3 w-3 object-contain" />
                    )}
                    {teamB.name}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {archetypesB.map((a) => (
                      <span
                        key={a.label}
                        title={a.tip}
                        className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${archetypeBadgeClass(a.kind)}`}
                      >
                        {a.label}
                      </span>
                    ))}
                    {archetypesB.length === 0 && (
                      <span className="text-[10px] text-muted-foreground italic">No archetypes</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Model Comparison — All 3 probability models */}
          {hasAnyProb && (
            <div className="space-y-1.5">
              <h4 className="text-xs font-semibold text-muted-foreground text-center">
                Win Probability
              </h4>
              {modelProb != null && (
                <ProbBar
                  label="XGBoost Model"
                  probA={modelProb}
                  colorA="bg-blue-500"
                  colorB="bg-red-400"
                />
              )}
              {prob != null && (
                <ProbBar
                  label="Log5 (Barthag)"
                  probA={prob}
                  colorA="bg-blue-400"
                  colorB="bg-red-300"
                />
              )}
              {vegasProb != null && (
                <ProbBar
                  label="Vegas Implied"
                  probA={vegasProb}
                  colorA="bg-emerald-500"
                  colorB="bg-orange-400"
                />
              )}
            </div>
          )}

          {/* Projected Score & Vegas Lines */}
          {(modelScores || vegasScores || vegasMlA != null) && (
            <div className="rounded-lg border p-3">
              <h4 className="text-xs font-semibold text-muted-foreground mb-2 text-center">
                Projected Score
              </h4>
              <div className="space-y-2">
                {modelScores && (
                  <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center">
                    <div className="text-right font-mono text-sm font-bold text-blue-600">
                      {modelScores.scoreA.toFixed(1)}
                    </div>
                    <div className="text-[10px] text-muted-foreground text-center w-14">
                      Model
                    </div>
                    <div className="text-left font-mono text-sm font-bold text-red-500">
                      {modelScores.scoreB.toFixed(1)}
                    </div>
                  </div>
                )}
                {vegasScores && (
                  <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center">
                    <div className="text-right font-mono text-sm font-bold text-blue-600">
                      {vegasScores.scoreA.toFixed(1)}
                    </div>
                    <div className="text-[10px] text-muted-foreground text-center w-14">
                      Vegas
                    </div>
                    <div className="text-left font-mono text-sm font-bold text-red-500">
                      {vegasScores.scoreB.toFixed(1)}
                    </div>
                  </div>
                )}

                {/* Vegas line details */}
                {(vegasSpread != null || vegasTotal != null || vegasMlA != null) && (
                  <div className="border-t pt-2 mt-1 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                    {vegasSpread != null && (
                      <span>
                        Spread: <span className="font-mono font-medium text-foreground">
                          {vegasSpread === 0 ? "PK" : `${teamA.name} ${vegasSpread > 0 ? "+" : ""}${vegasSpread.toFixed(1)}`}
                        </span>
                      </span>
                    )}
                    {vegasTotal != null && (
                      <span>
                        O/U: <span className="font-mono font-medium text-foreground">
                          {vegasTotal.toFixed(1)}
                        </span>
                      </span>
                    )}
                    {vegasMlA != null && vegasMlB != null && (
                      <span>
                        ML: <span className="font-mono font-medium text-blue-600">{formatMl(vegasMlA)}</span>
                        {" / "}
                        <span className="font-mono font-medium text-red-500">{formatMl(vegasMlB)}</span>
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Stats Comparison */}
          <div className="rounded-lg border p-3">
            <h4 className="text-xs font-semibold text-muted-foreground mb-2 text-center">
              Team Stats
            </h4>
            <StatRow
              label="AdjOE"
              valA={teamA.adjOe}
              valB={teamB.adjOe}
              higherIsBetter
            />
            <StatRow
              label="AdjDE"
              valA={teamA.adjDe}
              valB={teamB.adjDe}
              higherIsBetter={false}
            />
            <StatRow
              label="AdjEM"
              valA={teamA.adjEm}
              valB={teamB.adjEm}
              higherIsBetter
            />
            <StatRow
              label="Barthag"
              valA={teamA.barthag ? teamA.barthag * 1000 : null}
              valB={teamB.barthag ? teamB.barthag * 1000 : null}
              higherIsBetter
            />
            <StatRow
              label="Tempo"
              valA={teamA.adjTempo}
              valB={teamB.adjTempo}
            />
          </div>

          {/* Key Players */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border p-3">
              <h4 className="text-xs font-semibold mb-2 flex items-center gap-1">
                {teamA.logoUrl && (
                  <img
                    src={teamA.logoUrl}
                    alt=""
                    className="h-4 w-4 object-contain"
                  />
                )}
                {teamA.name}
              </h4>
              <PlayerTable players={playersA} color="text-blue-600" />
            </div>
            <div className="rounded-lg border p-3">
              <h4 className="text-xs font-semibold mb-2 flex items-center gap-1">
                {teamB.logoUrl && (
                  <img
                    src={teamB.logoUrl}
                    alt=""
                    className="h-4 w-4 object-contain"
                  />
                )}
                {teamB.name}
              </h4>
              <PlayerTable players={playersB} color="text-red-500" />
            </div>
          </div>

          {/* Simulation Tournament Path */}
          {(simA.size > 0 || simB.size > 0) && (
            <div className="rounded-lg border p-3">
              <h4 className="text-xs font-semibold text-muted-foreground mb-2 text-center">
                Simulated Tournament Path (10K sims)
              </h4>
              <div className="grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-1 items-center text-xs">
                {/* Header */}
                <div className="text-right font-medium text-blue-600">
                  {teamA.name}
                </div>
                <div className="text-center text-muted-foreground font-medium">
                  Round
                </div>
                <div className="text-left font-medium text-red-500">
                  {teamB.name}
                </div>

                {[...ROUNDS, "Champion"].map((round) => {
                  const pctA = simA.get(round) ?? 0;
                  const pctB = simB.get(round) ?? 0;
                  return (
                    <div
                      key={round}
                      className="contents"
                    >
                      <div className="text-right font-mono">
                        <span
                          className={
                            pctA > 0.5
                              ? "text-blue-600 font-bold"
                              : pctA > 0.1
                                ? ""
                                : "text-muted-foreground"
                          }
                        >
                          {(pctA * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="text-center text-muted-foreground">
                        {ROUND_LABELS[round] ?? round}
                      </div>
                      <div className="text-left font-mono">
                        <span
                          className={
                            pctB > 0.5
                              ? "text-red-500 font-bold"
                              : pctB > 0.1
                                ? ""
                                : "text-muted-foreground"
                          }
                        >
                          {(pctB * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Pick Buttons */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => onPick(teamA.teamId)}
              className={`rounded-lg border-2 px-4 py-3 text-sm font-medium transition-colors ${
                winnerId === teamA.teamId
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30 text-blue-700"
                  : "border-muted hover:border-blue-300 hover:bg-blue-50/50"
              }`}
            >
              <div className="flex items-center justify-center gap-2">
                {teamA.logoUrl && (
                  <img
                    src={teamA.logoUrl}
                    alt=""
                    className="h-6 w-6 object-contain"
                  />
                )}
                Pick {teamA.name}
              </div>
            </button>
            <button
              onClick={() => onPick(teamB.teamId)}
              className={`rounded-lg border-2 px-4 py-3 text-sm font-medium transition-colors ${
                winnerId === teamB.teamId
                  ? "border-red-500 bg-red-50 dark:bg-red-950/30 text-red-700"
                  : "border-muted hover:border-red-300 hover:bg-red-50/50"
              }`}
            >
              <div className="flex items-center justify-center gap-2">
                {teamB.logoUrl && (
                  <img
                    src={teamB.logoUrl}
                    alt=""
                    className="h-6 w-6 object-contain"
                  />
                )}
                Pick {teamB.name}
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
