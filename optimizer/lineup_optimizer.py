"""DraftKings CBB lineup optimizer using PuLP (integer linear programming).

Lineup structure: G / G / G / F / F / F / UTIL / UTIL  (8 players, $50k cap)

Usage:
    python -m optimizer.lineup_optimizer \\
        --entries C:/path/DKEntries.csv \\
        --out C:/path/DKLineups_filled.csv \\
        --n 100 --mode gpp --stack 2 --exposure 0.6

Loads player pool from dk_players (most recent slate), generates N GPP lineups
with exposure caps and team-stack constraints, then fills the DK multi-entry
upload CSV.
"""

from __future__ import annotations

import argparse
import csv
import io
import logging
import math
import sys
import time
from dataclasses import dataclass, field

import pulp
from rapidfuzz import fuzz

from config import load_config
from db.database import DatabaseManager

logger = logging.getLogger(__name__)

SALARY_CAP = 50_000
ROSTER_SIZE = 8
MIN_G = 3
MIN_F = 3
G_SLOTS = ["G", "G2", "G3"]
F_SLOTS = ["F", "F2", "F3"]
UTIL_SLOTS = ["UTIL", "UTIL2"]


# ── Data model ───────────────────────────────────────────────


@dataclass
class DkPlayer:
    id: int
    dk_player_id: int
    name: str
    team_abbrev: str
    eligible_positions: str
    salary: int
    our_proj: float | None
    our_leverage: float | None
    linestar_proj: float | None
    proj_own_pct: float | None

    @property
    def is_g_eligible(self) -> bool:
        return "G" in self.eligible_positions

    @property
    def is_f_eligible(self) -> bool:
        return "F" in self.eligible_positions


@dataclass
class Lineup:
    players: list[DkPlayer]
    slots: dict[str, DkPlayer]
    total_salary: int
    proj_fpts: float
    leverage: float

    def __str__(self) -> str:
        slot_order = G_SLOTS + F_SLOTS + UTIL_SLOTS
        parts = [f"{s}: {self.slots[s].name} ({self.slots[s].team_abbrev})" for s in slot_order]
        return f"[${self.total_salary:,} | proj={self.proj_fpts:.1f} | lev={self.leverage:.1f}] " + ", ".join(parts)


# ── Position assignment ──────────────────────────────────────


def assign_positions(players: list[DkPlayer]) -> dict[str, DkPlayer] | None:
    """Greedy G/G/G/F/F/F/UTIL/UTIL slot assignment."""
    assigned: dict[str, DkPlayer] = {}
    remaining = list(players)

    def fill(slots: list[str], pred) -> None:
        for slot in slots:
            if slot in assigned:
                continue
            for i, p in enumerate(remaining):
                if pred(p):
                    assigned[slot] = remaining.pop(i)
                    break

    # Pure-position players first (avoids locking G/F players into G slots
    # when there's a shortage of pure-F players)
    fill(G_SLOTS, lambda p: p.is_g_eligible and not p.is_f_eligible)
    fill(F_SLOTS, lambda p: p.is_f_eligible and not p.is_g_eligible)
    # Flex G/F fills remaining position slots
    fill(G_SLOTS, lambda p: p.is_g_eligible)
    fill(F_SLOTS, lambda p: p.is_f_eligible)
    # UTIL gets whatever's left
    fill(UTIL_SLOTS, lambda _: True)
    fill(UTIL_SLOTS, lambda _: True)

    if len(assigned) != ROSTER_SIZE:
        return None
    return assigned


# ── ILP solver ──────────────────────────────────────────────


def solve_one(
    pool: list[DkPlayer],
    mode: str,
    min_stack: int,
    max_exposure: int,
    exposure_count: dict[int, int],
    previous: list[set[int]],
) -> Lineup | None:
    """Solve one lineup via PuLP binary ILP. Returns None if infeasible."""

    # Teams with enough eligible players to stack
    from collections import defaultdict
    team_pool: dict[str, list[DkPlayer]] = defaultdict(list)
    for p in pool:
        team_pool[p.team_abbrev].append(p)
    stackable = [t for t, ps in team_pool.items() if len(ps) >= min_stack]

    prob = pulp.LpProblem("dk_cbb", pulp.LpMaximize)

    # Binary variables for each player
    x = {p.id: pulp.LpVariable(f"x_{p.id}", cat="Binary") for p in pool}
    # Binary stack-helper variables z_T (1 = team T is the stacked team)
    z = {t: pulp.LpVariable(f"z_{t}", cat="Binary") for t in stackable}

    # Objective
    score_fn = (lambda p: p.our_leverage or 0) if mode == "gpp" else (lambda p: p.our_proj or 0)
    prob += pulp.lpSum(score_fn(p) * x[p.id] for p in pool)

    # Core constraints
    prob += pulp.lpSum(x[p.id] for p in pool) == ROSTER_SIZE
    prob += pulp.lpSum(p.salary * x[p.id] for p in pool) <= SALARY_CAP
    prob += pulp.lpSum(x[p.id] for p in pool if p.is_g_eligible) >= MIN_G
    prob += pulp.lpSum(x[p.id] for p in pool if p.is_f_eligible) >= MIN_F

    # Stack: at least one team must have >= min_stack players selected
    for t in stackable:
        team_players = [p for p in pool if p.team_abbrev == t]
        prob += (pulp.lpSum(x[p.id] for p in team_players) - min_stack * z[t] >= 0,
                 f"stack_{t}")
    prob += pulp.lpSum(z[t] for t in stackable) >= 1

    # Exposure cap: exclude over-exposed players
    for p in pool:
        if exposure_count.get(p.id, 0) >= max_exposure:
            prob += x[p.id] == 0

    # Diversity: at most ROSTER_SIZE-2 overlap with each previous lineup
    for i, prev_set in enumerate(previous):
        prev_players = [p for p in pool if p.id in prev_set]
        prob += (pulp.lpSum(x[p.id] for p in prev_players) <= ROSTER_SIZE - 2,
                 f"div_{i}")

    # Solve (suppressed output)
    status = prob.solve(pulp.PULP_CBC_CMD(msg=0, timeLimit=10))
    if pulp.LpStatus[prob.status] != "Optimal":
        return None

    selected = [p for p in pool if pulp.value(x[p.id]) == 1]
    if len(selected) != ROSTER_SIZE:
        return None

    slots = assign_positions(selected)
    if slots is None:
        return None

    return Lineup(
        players=selected,
        slots=slots,
        total_salary=sum(p.salary for p in selected),
        proj_fpts=sum(p.our_proj or 0 for p in selected),
        leverage=sum(p.our_leverage or 0 for p in selected),
    )


# ── Multi-lineup generation ──────────────────────────────────


def optimize(
    pool: list[DkPlayer],
    n: int,
    mode: str = "gpp",
    min_stack: int = 2,
    max_exposure_pct: float = 0.6,
) -> list[Lineup]:
    eligible = [
        p for p in pool
        if (p.our_leverage if mode == "gpp" else p.our_proj) is not None
        and (p.our_leverage if mode == "gpp" else p.our_proj) > 0
        and p.salary > 0
    ]
    if len(eligible) < ROSTER_SIZE:
        print(f"ERROR: Only {len(eligible)} eligible players (need {ROSTER_SIZE})")
        return []

    max_exp_count = math.ceil(n * max_exposure_pct)
    exposure_count: dict[int, int] = {p.id: 0 for p in eligible}
    previous: list[set[int]] = []
    lineups: list[Lineup] = []

    print(f"Generating {n} lineups from {len(eligible)} eligible players "
          f"(mode={mode}, stack>={min_stack}, max_exp={max_exposure_pct:.0%})")

    t0 = time.time()
    for i in range(n):
        lineup = solve_one(eligible, mode, min_stack, max_exp_count, exposure_count, previous)
        if lineup is None:
            print(f"  Stopped at lineup {i+1}: no more feasible lineups")
            break
        lineups.append(lineup)
        prev_set = {p.id for p in lineup.players}
        previous.append(prev_set)
        for p in lineup.players:
            exposure_count[p.id] = exposure_count.get(p.id, 0) + 1

        elapsed = time.time() - t0
        if (i + 1) % 10 == 0:
            print(f"  {i+1}/{n} lineups  ({elapsed:.1f}s)")

    total = time.time() - t0
    print(f"Generated {len(lineups)} lineups in {total:.1f}s")
    return lineups


# ── DK multi-entry export ────────────────────────────────────


def build_filled_csv(lineups: list[Lineup], entry_template_path: str) -> str:
    """Fill DK multi-entry upload CSV with generated lineups.

    DK format cols: Entry ID, Contest Name, Contest ID, Entry Fee, G, G, G, F, F, F, UTIL, UTIL
    Player cell format: "Name (dkPlayerId)"
    """
    slot_order = G_SLOTS + F_SLOTS + UTIL_SLOTS  # 8 slots

    with open(entry_template_path, encoding="utf-8-sig") as f:
        reader = list(csv.reader(f))

    header = reader[0]
    entry_rows = [r for r in reader[1:] if r and r[0].strip().isdigit()]

    out_rows = [header]
    for i, lineup in enumerate(lineups):
        # Reuse entry rows cyclically if more lineups than entries
        entry = list(entry_rows[i % len(entry_rows)]) if entry_rows else [""] * 12
        # Pad if needed
        while len(entry) < 12:
            entry.append("")
        for j, slot in enumerate(slot_order):
            player = lineup.slots.get(slot)
            entry[4 + j] = f"{player.name} ({player.dk_player_id})" if player else ""
        out_rows.append(entry)

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerows(out_rows)
    return buf.getvalue()


def print_exposure_report(lineups: list[Lineup], pool: list[DkPlayer], top_n: int = 20) -> None:
    counts: dict[int, int] = {}
    for lu in lineups:
        for p in lu.players:
            counts[p.id] = counts.get(p.id, 0) + 1

    player_map = {p.id: p for p in pool}
    sorted_counts = sorted(counts.items(), key=lambda x: -x[1])

    print(f"\n-- Exposure Report (top {top_n}) --------------------------")
    print(f"{'Player':<28} {'Team':<8} {'Sal':>6}  {'Count':>5}  {'Exp%':>6}")
    print("-" * 60)
    for pid, cnt in sorted_counts[:top_n]:
        p = player_map[pid]
        pct = 100 * cnt / len(lineups)
        print(f"  {p.name:<26} {p.team_abbrev:<8} ${p.salary}  {cnt:>5}  {pct:>5.1f}%")


# ── Main ─────────────────────────────────────────────────────


def run(
    entries_path: str,
    out_path: str,
    n: int = 100,
    mode: str = "gpp",
    min_stack: int = 2,
    max_exposure: float = 0.6,
    slate_date: str | None = None,
) -> None:
    config = load_config()
    db = DatabaseManager(config.database_url)

    # Find target slate
    if slate_date:
        slate = db.execute_one(
            "SELECT id, slate_date FROM dk_slates WHERE slate_date = %s", (slate_date,)
        )
    else:
        slate = db.execute_one(
            "SELECT id, slate_date FROM dk_slates ORDER BY slate_date DESC LIMIT 1"
        )
    if not slate:
        print("ERROR: No slate found. Run ingest.dk_slate first.")
        return
    print(f"Slate: {slate['slate_date']} (id={slate['id']})")

    # Load players
    rows = db.execute(
        """
        SELECT id, dk_player_id, name, team_abbrev, eligible_positions,
               salary, our_proj, our_leverage, linestar_proj, proj_own_pct
        FROM dk_players
        WHERE slate_id = %s AND salary > 0
        ORDER BY our_leverage DESC NULLS LAST
        """,
        (slate["id"],),
    )

    pool = [
        DkPlayer(
            id=r["id"],
            dk_player_id=r["dk_player_id"],
            name=r["name"],
            team_abbrev=r["team_abbrev"],
            eligible_positions=r["eligible_positions"],
            salary=r["salary"],
            our_proj=r["our_proj"],
            our_leverage=r["our_leverage"],
            linestar_proj=r["linestar_proj"],
            proj_own_pct=r["proj_own_pct"],
        )
        for r in rows
    ]
    print(f"Loaded {len(pool)} players from slate")

    lineups = optimize(pool, n, mode, min_stack, max_exposure)
    if not lineups:
        print("No lineups generated.")
        return

    # Exposure report
    print_exposure_report(lineups, pool)

    # Summary stats
    avg_sal = sum(lu.total_salary for lu in lineups) / len(lineups)
    avg_proj = sum(lu.proj_fpts for lu in lineups) / len(lineups)
    avg_lev = sum(lu.leverage for lu in lineups) / len(lineups)
    print(f"\n-- Summary ----------------------------------------------")
    print(f"  Lineups generated : {len(lineups)}")
    print(f"  Avg salary used   : ${avg_sal:,.0f}")
    print(f"  Avg proj FPTS     : {avg_proj:.1f}")
    print(f"  Avg leverage score: {avg_lev:.1f}")

    # Save filled CSV
    csv_content = build_filled_csv(lineups, entries_path)
    with open(out_path, "w", encoding="utf-8", newline="") as f:
        f.write(csv_content)
    print(f"\nSaved {len(lineups)} lineups -> {out_path}")


if __name__ == "__main__":
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="Generate DK CBB lineups")
    parser.add_argument("--entries", required=True, help="DK multi-entry template CSV")
    parser.add_argument("--out", required=True, help="Output CSV path")
    parser.add_argument("--n", type=int, default=100, help="Number of lineups")
    parser.add_argument("--mode", choices=["gpp", "cash"], default="gpp")
    parser.add_argument("--stack", type=int, default=2, help="Min players from same team")
    parser.add_argument("--exposure", type=float, default=0.6, help="Max exposure (0-1)")
    parser.add_argument("--slate-date", help="Slate date YYYY-MM-DD (default: most recent)")
    args = parser.parse_args()
    run(args.entries, args.out, args.n, args.mode, args.stack, args.exposure, args.slate_date)
