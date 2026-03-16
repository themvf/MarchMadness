"use client";

import { ROUNDS, ROUND_LABELS, type BracketTeam } from "@/lib/bracket-logic";
import type { TopPlayer, SimAdvancement } from "@/db/queries";
import type { SlotDef } from "@/lib/bracket-logic";

interface Props {
  slotId: string;
  slotDef: SlotDef;
  teamA: BracketTeam;
  teamB: BracketTeam;
  prob: number | null;
  modelProb: number | null;
  playersA: TopPlayer[];
  playersB: TopPlayer[];
  simA: Map<string, number>;
  simB: Map<string, number>;
  winnerId: number | null;
  onPick: (teamId: number) => void;
  onClose: () => void;
}

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
  const a = valA ?? 0;
  const b = valB ?? 0;
  const aWins = higherIsBetter ? a > b : a < b;
  const bWins = higherIsBetter ? b > a : b < a;

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

export default function MatchupDetailModal({
  slotDef,
  teamA,
  teamB,
  prob,
  modelProb,
  playersA,
  playersB,
  simA,
  simB,
  winnerId,
  onPick,
  onClose,
}: Props) {
  const displayProb = modelProb ?? prob;
  const roundLabel = ROUND_LABELS[slotDef.round] ?? slotDef.round;

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
          {/* Team headers + Probability */}
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

            {/* Probability bars */}
            {displayProb != null && (
              <div className="space-y-1.5">
                {modelProb != null && (
                  <div>
                    <div className="text-[10px] text-muted-foreground mb-0.5">
                      XGBoost Model
                    </div>
                    <div className="flex h-6 w-full overflow-hidden rounded-full bg-muted text-xs font-bold">
                      <div
                        className="flex items-center justify-center bg-blue-500 text-white"
                        style={{
                          width: `${Math.round(modelProb * 100)}%`,
                        }}
                      >
                        {Math.round(modelProb * 100)}%
                      </div>
                      <div
                        className="flex items-center justify-center bg-red-400 text-white"
                        style={{
                          width: `${Math.round((1 - modelProb) * 100)}%`,
                        }}
                      >
                        {Math.round((1 - modelProb) * 100)}%
                      </div>
                    </div>
                  </div>
                )}
                {prob != null && (
                  <div>
                    <div className="text-[10px] text-muted-foreground mb-0.5">
                      {modelProb != null ? "Log5 (Barthag)" : "Win Probability (Log5)"}
                    </div>
                    <div className="flex h-6 w-full overflow-hidden rounded-full bg-muted text-xs font-bold">
                      <div
                        className="flex items-center justify-center bg-blue-400 text-white"
                        style={{
                          width: `${Math.round(prob * 100)}%`,
                        }}
                      >
                        {Math.round(prob * 100)}%
                      </div>
                      <div
                        className="flex items-center justify-center bg-red-300 text-white"
                        style={{
                          width: `${Math.round((1 - prob) * 100)}%`,
                        }}
                      >
                        {Math.round((1 - prob) * 100)}%
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

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
