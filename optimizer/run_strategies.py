"""Run all DFS lineup strategies for the current slate in one command.

Generates three strategy variants in sequence, saves each to dk_lineups,
and optionally writes filled upload CSVs if --entries is provided.

Strategies (NCAA CBB default):
  gpp_standard   Win prob 25-82%.  Safe stacks, avoids blowout/bust risk.
  upset_stack    Win prob 12-38%.  Underdog teams; high upside if they win.
  value_leverage No stack.         Pure leverage maximization — baseline.

The three strategies are the core A/B/C test for learning which approach
generates the most GPP value across slates. Results accumulate in dk_lineups
and are visible in the /dfs web dashboard after running dk_results.py.

Usage:
    # Save all three strategies + write upload CSVs:
    python -m optimizer.run_strategies \\
        --entries DKEntries-3_22_2026.csv \\
        --out-dir "C:\\CollegeBasketballDFS" \\
        --n 20 --save

    # Save only (no CSV output):
    python -m optimizer.run_strategies --n 20 --save

    # Custom lineup counts per strategy:
    python -m optimizer.run_strategies --n 15 --n-upset 10 --n-value 10 --save

    # Different sport (future):
    python -m optimizer.run_strategies --sport nba --n 20 --save

After each slate:
    python -m ingest.dk_results --results contest-standings-XXXXXX.csv
    → populates actual_fpts, prints cross-strategy comparison automatically
"""

from __future__ import annotations

import argparse
import logging
import os
from dataclasses import dataclass

from config import load_config
from db.database import DatabaseManager
from optimizer.lineup_optimizer import (
    DkPlayer,
    Lineup,
    build_filled_csv,
    optimize,
    print_exposure_report,
    print_stack_report,
    save_lineups,
)
from optimizer.sport_config import NCAA_CBB, SPORT_CONFIGS, SportConfig

logger = logging.getLogger(__name__)


@dataclass
class StrategyConfig:
    """Parameters for one optimizer run."""

    name: str
    description: str
    n: int
    mode: str = "gpp"
    min_stack: int = 3
    bring_back: int = 1
    max_exposure_pct: float = 0.60
    max_filler_per_team: int = 3
    min_exposure_pct: float = 0.10
    min_exposure_top_k: int = 5
    no_stack: bool = False
    stack_min_win_prob: float = 0.25
    stack_max_win_prob: float = 0.82


def build_default_strategies(
    sport: SportConfig,
    n_standard: int,
    n_upset: int,
    n_value: int,
) -> list[StrategyConfig]:
    """Return the three default strategies for a sport.

    gpp_standard  — chalk-adjacent stacks in the 25-82% win-prob window.
    upset_stack   — underdog stacks in the 12-38% win-prob window.
    value_leverage — no stack, pure leverage maximization (baseline).
    """
    return [
        StrategyConfig(
            name="gpp_standard",
            description="Standard GPP: stacks from 25-82% win-prob teams",
            n=n_standard,
            stack_min_win_prob=sport.default_stack_min_win_prob,
            stack_max_win_prob=sport.default_stack_max_win_prob,
        ),
        StrategyConfig(
            name="upset_stack",
            description="Upset GPP: stacks from underdog (12-38% win-prob) teams",
            n=n_upset,
            stack_min_win_prob=sport.upset_stack_min_win_prob,
            stack_max_win_prob=sport.upset_stack_max_win_prob,
        ),
        StrategyConfig(
            name="value_leverage",
            description="Value baseline: no stack, pure leverage across all players",
            n=n_value,
            no_stack=True,
            bring_back=0,
        ),
    ]


def load_pool(db: DatabaseManager, slate_date: str | None = None) -> tuple[dict, list[DkPlayer]]:
    """Load player pool from DB for the most recent (or specified) slate."""
    if slate_date:
        slate = db.execute_one(
            "SELECT id, slate_date FROM dk_slates WHERE slate_date = %s", (slate_date,)
        )
    else:
        slate = db.execute_one(
            "SELECT id, slate_date FROM dk_slates ORDER BY slate_date DESC LIMIT 1"
        )
    if not slate:
        raise RuntimeError("No slate found. Run ingest.dk_slate first.")

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
    return slate, pool


def run_strategy(
    strategy: StrategyConfig,
    pool: list[DkPlayer],
) -> list[Lineup]:
    """Run optimizer for a single strategy config. Returns generated lineups."""
    print(f"\n{'='*60}")
    print(f"Strategy: {strategy.name}")
    print(f"  {strategy.description}")
    print(f"{'='*60}")

    lineups = optimize(
        pool=pool,
        n=strategy.n,
        mode=strategy.mode,
        min_stack=strategy.min_stack,
        bring_back=strategy.bring_back,
        max_exposure_pct=strategy.max_exposure_pct,
        stack_min_win_prob=strategy.stack_min_win_prob,
        stack_max_win_prob=strategy.stack_max_win_prob,
        max_filler_per_team=strategy.max_filler_per_team,
        min_exposure_pct=strategy.min_exposure_pct,
        min_exposure_top_k=strategy.min_exposure_top_k,
        no_stack=strategy.no_stack,
    )
    if lineups:
        print_stack_report(lineups)
        print_exposure_report(lineups, pool, top_n=10)
        avg_sal = sum(lu.total_salary for lu in lineups) / len(lineups)
        avg_proj = sum(lu.proj_fpts for lu in lineups) / len(lineups)
        avg_lev = sum(lu.leverage for lu in lineups) / len(lineups)
        print(f"\n  Lineups: {len(lineups)}  Avg salary: ${avg_sal:,.0f}  "
              f"Avg proj: {avg_proj:.1f}  Avg leverage: {avg_lev:.1f}")
    else:
        print(f"  No lineups generated.")
    return lineups


def run(
    entries_path: str | None,
    out_dir: str | None,
    n_standard: int,
    n_upset: int,
    n_value: int,
    slate_date: str | None,
    save: bool,
    sport_name: str,
) -> None:
    config = load_config()
    db = DatabaseManager(config.database_url)

    sport = SPORT_CONFIGS.get(sport_name, NCAA_CBB)
    strategies = build_default_strategies(sport, n_standard, n_upset, n_value)

    slate, pool = load_pool(db, slate_date)
    print(f"Slate: {slate['slate_date']} (id={slate['id']}) — {len(pool)} players loaded")

    results: dict[str, list[Lineup]] = {}

    for strat in strategies:
        lineups = run_strategy(strat, pool)
        results[strat.name] = lineups

        if save and lineups:
            save_lineups(db, slate["id"], strat.name, lineups)

        if entries_path and out_dir and lineups:
            fname = f"DKLineups_{slate['slate_date']}_{strat.name}.csv"
            out_path = os.path.join(out_dir, fname)
            csv_content = build_filled_csv(lineups, entries_path)
            with open(out_path, "w", encoding="utf-8", newline="") as f:
                f.write(csv_content)
            print(f"  Saved CSV → {out_path}")

    # Cross-strategy summary
    print(f"\n{'='*60}")
    print(f"SUMMARY — {slate['slate_date']}")
    print(f"{'='*60}")
    print(f"  {'Strategy':<18}  {'N':>4}  {'AvgProj':>8}  {'AvgLev':>8}")
    print(f"  {'-'*42}")
    for strat in strategies:
        lus = results.get(strat.name, [])
        if lus:
            avg_proj = sum(lu.proj_fpts for lu in lus) / len(lus)
            avg_lev = sum(lu.leverage for lu in lus) / len(lus)
            print(f"  {strat.name:<18}  {len(lus):>4}  {avg_proj:>8.1f}  {avg_lev:>8.1f}")
        else:
            print(f"  {strat.name:<18}  {'0':>4}  {'—':>8}  {'—':>8}")

    total = sum(len(v) for v in results.values())
    print(f"\n  Total lineups generated: {total}")
    if save:
        print(f"  Saved to dk_lineups as: {', '.join(s.name for s in strategies)}")
    print(f"\n  After the slate: python -m ingest.dk_results --results contest-standings.csv")
    print(f"  to populate actual FPTS and compare strategy performance.")


if __name__ == "__main__":
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(message)s")
    parser = argparse.ArgumentParser(
        description="Run all DFS strategies for the current slate",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--entries", default=None,
                        help="DK multi-entry template CSV (optional)")
    parser.add_argument("--out-dir", default=None,
                        help="Directory to write filled CSV files (requires --entries)")
    parser.add_argument("--n", type=int, default=20,
                        help="Lineups for gpp_standard (default 20)")
    parser.add_argument("--n-upset", type=int, default=None,
                        help="Lineups for upset_stack (default = same as --n)")
    parser.add_argument("--n-value", type=int, default=None,
                        help="Lineups for value_leverage (default = same as --n)")
    parser.add_argument("--slate-date", default=None,
                        help="Slate date YYYY-MM-DD (default: most recent)")
    parser.add_argument("--save", action="store_true",
                        help="Save all lineups to dk_lineups table")
    parser.add_argument("--sport", default="ncaa_cbb",
                        choices=list(SPORT_CONFIGS.keys()),
                        help="Sport config to use (default: ncaa_cbb)")
    args = parser.parse_args()

    n_upset = args.n_upset if args.n_upset is not None else args.n
    n_value = args.n_value if args.n_value is not None else args.n

    run(
        entries_path=args.entries,
        out_dir=args.out_dir,
        n_standard=args.n,
        n_upset=n_upset,
        n_value=n_value,
        slate_date=args.slate_date,
        save=args.save,
        sport_name=args.sport,
    )
