"""DraftKings CBB lineup optimizer using PuLP (integer linear programming).

Lineup structure: G / G / G / F / F / F / UTIL / UTIL  (8 players, $50k cap)

Stacking strategy:
  - Primary stack: >=3 players from the same team (configurable)
  - Bring-back: >=1 player from the opponent in the same game (configurable)
  - Win-prob filter: only allow primary stacks from teams with win_prob
    in [stack_min_win_prob, stack_max_win_prob] (default 0.25-0.82)
    This avoids stacking massive favorites with high blowout risk AND
    avoids stacking 5% underdogs where a loss tanks all their value.

Usage:
    python -m optimizer.lineup_optimizer \\
        --entries DKEntries.csv --out DKLineups.csv \\
        --n 100 --mode gpp --stack 3 --bring-back 1 --exposure 0.6

    # Wider win-prob window (include more teams as stackable):
    python -m optimizer.lineup_optimizer ... --stack-min-prob 0.20 --stack-max-prob 0.90
"""

from __future__ import annotations

import argparse
import csv
import io
import logging
import math
import time
from collections import defaultdict
from dataclasses import dataclass

import pulp

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

# Default win-prob range for primary stacks.
# Teams outside this range can still appear in lineups — they just can't be
# the "stacked team" (z_T = 1). A 92% favorite risks blowout; a 5% underdog
# risks elimination/low stats.
DEFAULT_STACK_MIN_WIN_PROB = 0.25
DEFAULT_STACK_MAX_WIN_PROB = 0.82


# ── Data model ───────────────────────────────────────────────


@dataclass
class DkPlayer:
    id: int
    dk_player_id: int
    name: str
    team_abbrev: str
    game_key: str          # first token of game_info, e.g. "STL@MICH"
    eligible_positions: str
    salary: int
    win_prob: float | None  # probability this player's team wins
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
    stack_team: str | None


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

    fill(G_SLOTS, lambda p: p.is_g_eligible and not p.is_f_eligible)
    fill(F_SLOTS, lambda p: p.is_f_eligible and not p.is_g_eligible)
    fill(G_SLOTS, lambda p: p.is_g_eligible)
    fill(F_SLOTS, lambda p: p.is_f_eligible)
    fill(UTIL_SLOTS, lambda _: True)
    fill(UTIL_SLOTS, lambda _: True)

    if len(assigned) != ROSTER_SIZE:
        return None
    return assigned


# ── Game-pair helpers ────────────────────────────────────────


def build_game_pairs(pool: list[DkPlayer]) -> dict[str, str]:
    """Map each team_abbrev to its opponent's team_abbrev.

    Parses game_key "AWAY@HOME" to extract the two teams, then builds a
    bidirectional mapping: AWAY->HOME and HOME->AWAY.
    """
    game_teams: dict[str, list[str]] = defaultdict(list)
    for p in pool:
        if p.team_abbrev not in game_teams[p.game_key]:
            game_teams[p.game_key].append(p.team_abbrev)

    opponent: dict[str, str] = {}
    for game_key, teams in game_teams.items():
        if len(teams) == 2:
            opponent[teams[0]] = teams[1]
            opponent[teams[1]] = teams[0]
    return opponent


# ── ILP solver ──────────────────────────────────────────────


def solve_one(
    pool: list[DkPlayer],
    mode: str,
    min_stack: int,
    bring_back: int,
    stack_min_win_prob: float,
    stack_max_win_prob: float,
    max_exposure: int,
    exposure_count: dict[int, int],
    previous: list[set[int]],
    max_filler_per_team: int = 3,
    forced: set[int] | None = None,
) -> Lineup | None:
    """Solve one lineup via PuLP binary ILP."""

    # Build opponent map for bring-back constraints
    opponent_map = build_game_pairs(pool)

    # Teams eligible to be the PRIMARY stack (within win-prob window)
    team_pool: dict[str, list[DkPlayer]] = defaultdict(list)
    for p in pool:
        team_pool[p.team_abbrev].append(p)

    # A team can be the primary stack if:
    # 1. It has enough players in the eligible pool
    # 2. Its win_prob is in the configured range (blowout protection)
    def team_win_prob(team: str) -> float | None:
        players = team_pool[team]
        probs = [p.win_prob for p in players if p.win_prob is not None]
        return sum(probs) / len(probs) if probs else None

    stackable = []
    for team, players in team_pool.items():
        if len(players) < min_stack:
            continue
        wp = team_win_prob(team)
        if wp is None or (stack_min_win_prob <= wp <= stack_max_win_prob):
            stackable.append(team)

    if not stackable:
        # Fallback: allow all teams with enough players
        stackable = [t for t, ps in team_pool.items() if len(ps) >= min_stack]

    prob = pulp.LpProblem("dk_cbb", pulp.LpMaximize)

    x = {p.id: pulp.LpVariable(f"x_{p.id}", cat="Binary") for p in pool}
    z = {t: pulp.LpVariable(f"z_{t}", cat="Binary") for t in stackable}

    score_fn = (lambda p: p.our_leverage or 0) if mode == "gpp" else (lambda p: p.our_proj or 0)
    prob += pulp.lpSum(score_fn(p) * x[p.id] for p in pool)

    # Core constraints
    prob += pulp.lpSum(x[p.id] for p in pool) == ROSTER_SIZE
    prob += pulp.lpSum(p.salary * x[p.id] for p in pool) <= SALARY_CAP
    prob += pulp.lpSum(x[p.id] for p in pool if p.is_g_eligible) >= MIN_G
    prob += pulp.lpSum(x[p.id] for p in pool if p.is_f_eligible) >= MIN_F

    # Primary stack: at least one team has >= min_stack players
    for t in stackable:
        team_players = [p for p in pool if p.team_abbrev == t]
        prob += (
            pulp.lpSum(x[p.id] for p in team_players) - min_stack * z[t] >= 0,
            f"stack_{t}",
        )
    prob += pulp.lpSum(z[t] for t in stackable) >= 1

    # Bring-back: if team T is primary stack, require >= bring_back players
    # from T's opponent in the same game.
    if bring_back > 0:
        for t in stackable:
            opp = opponent_map.get(t)
            if not opp:
                continue
            opp_players = [p for p in pool if p.team_abbrev == opp]
            if len(opp_players) < bring_back:
                continue
            # sum(opp_players selected) - bring_back * z_T >= 0
            prob += (
                pulp.lpSum(x[p.id] for p in opp_players) - bring_back * z[t] >= 0,
                f"bringback_{t}",
            )

    # Max players per team (prevents one non-stack team from filling all filler slots).
    # For the primary-stack team: allowed up to ROSTER_SIZE when z[t]=1, else capped.
    # For non-stackable teams: hard cap at max_filler_per_team.
    for team, tplayers in team_pool.items():
        if team in stackable:
            prob += (
                pulp.lpSum(x[p.id] for p in tplayers)
                <= max_filler_per_team + (ROSTER_SIZE - max_filler_per_team) * z[team],
                f"maxteam_{team}",
            )
        else:
            prob += (
                pulp.lpSum(x[p.id] for p in tplayers) <= max_filler_per_team,
                f"maxteam_{team}",
            )

    # Forced inclusions (minimum-exposure guarantee for top-projected players)
    if forced:
        for pid in forced:
            if pid in x:
                prob += x[pid] == 1, f"forced_{pid}"

    # Exposure cap
    for p in pool:
        if exposure_count.get(p.id, 0) >= max_exposure:
            prob += x[p.id] == 0

    # Diversity: at most ROSTER_SIZE-2 overlap with any previous lineup
    for i, prev_set in enumerate(previous):
        prev_players = [p for p in pool if p.id in prev_set]
        prob += (
            pulp.lpSum(x[p.id] for p in prev_players) <= ROSTER_SIZE - 2,
            f"div_{i}",
        )

    status = prob.solve(pulp.PULP_CBC_CMD(msg=0, timeLimit=15))
    if pulp.LpStatus[prob.status] != "Optimal":
        return None

    selected = [p for p in pool if pulp.value(x[p.id]) == 1]
    if len(selected) != ROSTER_SIZE:
        return None

    slots = assign_positions(selected)
    if slots is None:
        return None

    # Identify the stacked team
    stack_team = None
    for t in stackable:
        if pulp.value(z[t]) is not None and pulp.value(z[t]) > 0.5:
            stack_team = t
            break

    return Lineup(
        players=selected,
        slots=slots,
        total_salary=sum(p.salary for p in selected),
        proj_fpts=sum(p.our_proj or 0 for p in selected),
        leverage=sum(p.our_leverage or 0 for p in selected),
        stack_team=stack_team,
    )


# ── Multi-lineup generation ──────────────────────────────────


def optimize(
    pool: list[DkPlayer],
    n: int,
    mode: str = "gpp",
    min_stack: int = 3,
    bring_back: int = 1,
    max_exposure_pct: float = 0.6,
    stack_min_win_prob: float = DEFAULT_STACK_MIN_WIN_PROB,
    stack_max_win_prob: float = DEFAULT_STACK_MAX_WIN_PROB,
    max_filler_per_team: int = 3,
    min_exposure_pct: float = 0.10,
    min_exposure_top_k: int = 5,
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

    # Show which teams qualify for primary stacking
    opponent_map = build_game_pairs(eligible)
    team_pool: dict[str, list[DkPlayer]] = defaultdict(list)
    for p in eligible:
        team_pool[p.team_abbrev].append(p)

    print(f"\n-- Stackable teams (win prob {stack_min_win_prob:.0%}-{stack_max_win_prob:.0%}) --")
    any_stackable = False
    for team, players in sorted(team_pool.items()):
        if len(players) < min_stack:
            continue
        wp_vals = [p.win_prob for p in players if p.win_prob is not None]
        wp = sum(wp_vals) / len(wp_vals) if wp_vals else None
        in_range = wp is not None and stack_min_win_prob <= wp <= stack_max_win_prob
        opp = opponent_map.get(team, "?")
        marker = "  [PRIMARY]" if in_range else "  [skip - outside win-prob range]"
        wp_str = f"{wp*100:.0f}%" if wp is not None else "N/A"
        print(f"  {team:<8} vs {opp:<8}  win_prob={wp_str:<5}  n_eligible={len(players)}{marker}")
        if in_range:
            any_stackable = True

    if not any_stackable:
        print("  NOTE: No teams in win-prob range — allowing all teams as primary stacks")

    print(f"\nGenerating {n} lineups from {len(eligible)} eligible players")
    print(f"  mode={mode}, stack>={min_stack}, bring-back>={bring_back}, "
          f"max_exp={max_exposure_pct:.0%}, max_filler={max_filler_per_team}, "
          f"min_exp={min_exposure_pct:.0%}(top{min_exposure_top_k})")

    max_exp_count = math.ceil(n * max_exposure_pct)
    min_exp_count = math.ceil(n * min_exposure_pct) if min_exposure_pct > 0 else 0
    # Top-K players by our_proj for minimum-exposure guarantee
    top_k = sorted(eligible, key=lambda p: p.our_proj or 0, reverse=True)[:min_exposure_top_k]

    exposure_count: dict[int, int] = {p.id: 0 for p in eligible}
    previous: list[set[int]] = []
    lineups: list[Lineup] = []

    t0 = time.time()
    for i in range(n):
        # Force top-K players that have fallen below minimum exposure
        forced: set[int] = set()
        if min_exp_count > 0:
            lineups_remaining = n - i
            for p in top_k:
                needed = min_exp_count - exposure_count.get(p.id, 0)
                if needed > 0 and needed >= lineups_remaining:
                    forced.add(p.id)

        lineup = solve_one(
            eligible, mode, min_stack, bring_back,
            stack_min_win_prob, stack_max_win_prob,
            max_exp_count, exposure_count, previous,
            max_filler_per_team=max_filler_per_team,
            forced=forced or None,
        )
        if lineup is None:
            print(f"  Stopped at lineup {i+1}: no more feasible lineups")
            break
        lineups.append(lineup)
        previous.append({p.id for p in lineup.players})
        for p in lineup.players:
            exposure_count[p.id] = exposure_count.get(p.id, 0) + 1

        if (i + 1) % 10 == 0:
            print(f"  {i+1}/{n} lineups  ({time.time() - t0:.1f}s)")

    print(f"Generated {len(lineups)} lineups in {time.time() - t0:.1f}s")
    return lineups


# ── DB persistence ───────────────────────────────────────────


def save_lineups(db, slate_id: int, strategy: str, lineups: list[Lineup]) -> None:
    """Upsert generated lineups into dk_lineups (idempotent per strategy)."""
    # Clear previous run for this slate+strategy so re-runs are clean
    db.execute(
        "DELETE FROM dk_lineups WHERE slate_id = %s AND strategy = %s",
        (slate_id, strategy),
    )
    rows = [
        (
            slate_id,
            strategy,
            i,
            ",".join(str(p.id) for p in lu.players),
            lu.total_salary,
            lu.proj_fpts,
            lu.leverage,
            lu.stack_team,
        )
        for i, lu in enumerate(lineups, 1)
    ]
    db.execute_many(
        """
        INSERT INTO dk_lineups
            (slate_id, strategy, lineup_num, player_ids, total_salary, proj_fpts, leverage, stack_team)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (slate_id, strategy, lineup_num) DO UPDATE SET
            player_ids   = EXCLUDED.player_ids,
            total_salary = EXCLUDED.total_salary,
            proj_fpts    = EXCLUDED.proj_fpts,
            leverage     = EXCLUDED.leverage,
            stack_team   = EXCLUDED.stack_team
        """,
        rows,
    )
    print(f"Saved {len(lineups)} lineups to dk_lineups (slate={slate_id}, strategy='{strategy}')")


# ── Reports ──────────────────────────────────────────────────


def print_stack_report(lineups: list[Lineup]) -> None:
    stack_counts: dict[str, int] = defaultdict(int)
    for lu in lineups:
        if lu.stack_team:
            stack_counts[lu.stack_team] += 1

    print(f"\n-- Stack distribution ({len(lineups)} lineups) --")
    for team, cnt in sorted(stack_counts.items(), key=lambda x: -x[1]):
        pct = 100 * cnt / len(lineups)
        bar = "#" * int(pct / 2)
        print(f"  {team:<8}  {cnt:>3} lineups  {pct:>5.1f}%  {bar}")


def print_exposure_report(lineups: list[Lineup], pool: list[DkPlayer], top_n: int = 20) -> None:
    counts: dict[int, int] = {}
    for lu in lineups:
        for p in lu.players:
            counts[p.id] = counts.get(p.id, 0) + 1

    player_map = {p.id: p for p in pool}
    sorted_counts = sorted(counts.items(), key=lambda x: -x[1])

    print(f"\n-- Exposure Report (top {top_n}) --------------------------")
    print(f"  {'Player':<28} {'Team':<8} {'Sal':>6}  {'Count':>5}  {'Exp%':>6}")
    print("  " + "-" * 56)
    for pid, cnt in sorted_counts[:top_n]:
        p = player_map[pid]
        pct = 100 * cnt / len(lineups)
        print(f"  {p.name:<28} {p.team_abbrev:<8} ${p.salary}  {cnt:>5}  {pct:>5.1f}%")


# ── DK multi-entry export ────────────────────────────────────


def build_filled_csv(lineups: list[Lineup], entry_template_path: str) -> str:
    slot_order = G_SLOTS + F_SLOTS + UTIL_SLOTS

    with open(entry_template_path, encoding="utf-8-sig") as f:
        reader = list(csv.reader(f))

    header = reader[0]
    entry_rows = [r for r in reader[1:] if r and r[0].strip().isdigit()]

    out_rows = [header]
    for i, lineup in enumerate(lineups):
        entry = list(entry_rows[i % len(entry_rows)]) if entry_rows else [""] * 12
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


# ── Main ─────────────────────────────────────────────────────


def run(
    entries_path: str,
    out_path: str,
    n: int = 100,
    mode: str = "gpp",
    min_stack: int = 3,
    bring_back: int = 1,
    max_exposure: float = 0.6,
    stack_min_win_prob: float = DEFAULT_STACK_MIN_WIN_PROB,
    stack_max_win_prob: float = DEFAULT_STACK_MAX_WIN_PROB,
    slate_date: str | None = None,
    strategy: str | None = None,
    save: bool = False,
    max_filler_per_team: int = 3,
    min_exposure_pct: float = 0.10,
    min_exposure_top_k: int = 5,
) -> None:
    config = load_config()
    db = DatabaseManager(config.database_url)

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

    rows = db.execute(
        """
        SELECT
            dp.id, dp.dk_player_id, dp.name, dp.team_abbrev, dp.game_info,
            dp.eligible_positions, dp.salary,
            dp.our_proj, dp.our_leverage, dp.linestar_proj, dp.proj_own_pct,
            CASE WHEN bm.team_a_id = dp.team_id THEN bm.model_prob_a
                 WHEN bm.team_b_id = dp.team_id THEN 1 - bm.model_prob_a
                 ELSE NULL END AS win_prob
        FROM dk_players dp
        LEFT JOIN bracket_matchups bm ON bm.id = dp.matchup_id
        WHERE dp.slate_id = %s AND dp.salary > 0
        ORDER BY dp.our_leverage DESC NULLS LAST
        """,
        (slate["id"],),
    )

    pool = [
        DkPlayer(
            id=r["id"],
            dk_player_id=r["dk_player_id"],
            name=r["name"],
            team_abbrev=r["team_abbrev"],
            game_key=(r["game_info"] or "").split()[0],
            eligible_positions=r["eligible_positions"],
            salary=r["salary"],
            win_prob=r["win_prob"],
            our_proj=r["our_proj"],
            our_leverage=r["our_leverage"],
            linestar_proj=r["linestar_proj"],
            proj_own_pct=r["proj_own_pct"],
        )
        for r in rows
    ]
    print(f"Loaded {len(pool)} players from slate")

    lineups = optimize(
        pool, n, mode, min_stack, bring_back, max_exposure,
        stack_min_win_prob, stack_max_win_prob,
        max_filler_per_team, min_exposure_pct, min_exposure_top_k,
    )
    if not lineups:
        print("No lineups generated.")
        return

    print_stack_report(lineups)
    print_exposure_report(lineups, pool)

    avg_sal = sum(lu.total_salary for lu in lineups) / len(lineups)
    avg_proj = sum(lu.proj_fpts for lu in lineups) / len(lineups)
    avg_lev = sum(lu.leverage for lu in lineups) / len(lineups)
    print(f"\n-- Summary ----------------------------------------------")
    print(f"  Lineups generated : {len(lineups)}")
    print(f"  Avg salary used   : ${avg_sal:,.0f}")
    print(f"  Avg proj FPTS     : {avg_proj:.1f}")
    print(f"  Avg leverage score: {avg_lev:.1f}")

    csv_content = build_filled_csv(lineups, entries_path)
    with open(out_path, "w", encoding="utf-8", newline="") as f:
        f.write(csv_content)
    print(f"\nSaved {len(lineups)} lineups -> {out_path}")

    if save:
        label = strategy or f"{mode}_stack{min_stack}"
        save_lineups(db, slate["id"], label, lineups)


if __name__ == "__main__":
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="Generate DK CBB lineups")
    parser.add_argument("--entries", required=True, help="DK multi-entry template CSV")
    parser.add_argument("--out", required=True, help="Output CSV path")
    parser.add_argument("--n", type=int, default=100)
    parser.add_argument("--mode", choices=["gpp", "cash"], default="gpp")
    parser.add_argument("--stack", type=int, default=3, help="Min players from same team")
    parser.add_argument("--bring-back", type=int, default=1,
                        help="Min players from opponent of stacked team (0=disabled)")
    parser.add_argument("--exposure", type=float, default=0.6)
    parser.add_argument("--stack-min-prob", type=float, default=DEFAULT_STACK_MIN_WIN_PROB,
                        help="Min win prob to allow as primary stack")
    parser.add_argument("--stack-max-prob", type=float, default=DEFAULT_STACK_MAX_WIN_PROB,
                        help="Max win prob to allow as primary stack (blowout filter)")
    parser.add_argument("--slate-date")
    parser.add_argument("--strategy", default=None,
                        help="Label for this run in dk_lineups (e.g. 'basic', 'stacked')")
    parser.add_argument("--save", action="store_true",
                        help="Save lineups to dk_lineups table for post-slate comparison")
    parser.add_argument("--max-filler-per-team", type=int, default=3,
                        help="Max players from any non-stack team (default 3)")
    parser.add_argument("--min-exposure", type=float, default=0.10,
                        help="Min exposure for top-K projected players (default 0.10 = 10%%)")
    parser.add_argument("--min-exposure-top-k", type=int, default=5,
                        help="Apply min-exposure guarantee to top K players by projection (default 5)")
    args = parser.parse_args()
    run(
        args.entries, args.out, args.n, args.mode, args.stack,
        args.bring_back, args.exposure,
        args.stack_min_prob, args.stack_max_prob,
        args.slate_date, args.strategy, args.save,
        args.max_filler_per_team, args.min_exposure, args.min_exposure_top_k,
    )
