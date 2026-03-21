"""Ingest DraftKings results CSV → actual_fpts in dk_players.

DK posts a results CSV after each slate completes. It has the same format
as the salary CSV plus an FPTS column (sometimes called "Total Points").

Usage:
    python -m ingest.dk_results --results DKResults_3_21_2026.csv
    python -m ingest.dk_results --results DKResults_3_21_2026.csv --slate-date 2026-03-21

Matches players by name (fuzzy) + salary against the most recent slate
(or the slate matching --slate-date). Updates actual_fpts in dk_players.

Expected update rate: ~95%+ (DK name variants are consistent within a slate).
"""

from __future__ import annotations

import argparse
import csv
import io
import logging

from rapidfuzz import fuzz, process

from config import load_config
from db.database import DatabaseManager

logger = logging.getLogger(__name__)


def parse_dk_results_csv(content: str) -> list[dict]:
    """Parse DK results CSV.

    Columns include all salary CSV columns plus one of:
      FPTS | Total Points | ActualFpts
    Returns list of {name, salary, actual_fpts}.
    """
    reader = csv.DictReader(io.StringIO(content))
    players = []
    for row in reader:
        name = (row.get("Name") or "").strip()
        if not name:
            continue
        salary_str = (row.get("Salary") or "0").replace("$", "").replace(",", "").strip()
        salary = int(salary_str) if salary_str.isdigit() else 0

        # DK uses different column names across different exports
        fpts_str = (
            row.get("FPTS")
            or row.get("Total Points")
            or row.get("ActualFpts")
            or row.get("Actual FPTS")
            or "0"
        ).strip()
        try:
            actual_fpts = float(fpts_str) if fpts_str else None
        except ValueError:
            actual_fpts = None

        if actual_fpts is not None:
            players.append({"name": name, "salary": salary, "actual_fpts": actual_fpts})
    return players


def run(results_path: str, slate_date: str | None = None) -> None:
    config = load_config()
    db = DatabaseManager(config.database_url)

    with open(results_path, encoding="utf-8-sig") as f:
        content = f.read()

    result_players = parse_dk_results_csv(content)
    if not result_players:
        print("ERROR: No players with FPTS found. Check column names in results CSV.")
        return
    print(f"Parsed {len(result_players)} players from results CSV")

    # Find the target slate
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
    slate_id = slate["id"]
    print(f"Targeting slate {slate_id} ({slate['slate_date']})")

    # Load all players for this slate
    pool = db.execute(
        "SELECT id, name, salary FROM dk_players WHERE slate_id = %s", (slate_id,)
    )
    pool_names = [p["name"] for p in pool]

    updated = 0
    unmatched = []

    for result_p in result_players:
        # Exact match first (name + salary)
        exact = next(
            (p for p in pool if p["name"] == result_p["name"] and p["salary"] == result_p["salary"]),
            None,
        )
        if exact:
            db.execute(
                "UPDATE dk_players SET actual_fpts = %s WHERE id = %s",
                (result_p["actual_fpts"], exact["id"]),
            )
            updated += 1
            continue

        # Fuzzy name match (same salary preferred, but not required)
        same_salary = [p for p in pool if p["salary"] == result_p["salary"]]
        candidates = same_salary if same_salary else pool
        candidate_names = [p["name"] for p in candidates]

        match = process.extractOne(
            result_p["name"],
            candidate_names,
            scorer=fuzz.token_sort_ratio,
            score_cutoff=80,
        )
        if match:
            player = candidates[candidate_names.index(match[0])]
            db.execute(
                "UPDATE dk_players SET actual_fpts = %s WHERE id = %s",
                (result_p["actual_fpts"], player["id"]),
            )
            updated += 1
        else:
            unmatched.append(result_p["name"])

    n = len(result_players)
    print(f"Updated: {updated}/{n} ({100 * updated // n if n else 0}%)")
    if unmatched:
        print(f"Unmatched ({len(unmatched)}):")
        for name in unmatched[:10]:
            print(f"  {name}")

    # Print quick accuracy summary
    stats = db.execute_one(
        """
        SELECT
            COUNT(*) FILTER (WHERE actual_fpts IS NOT NULL AND our_proj IS NOT NULL) AS n_our,
            AVG(ABS(our_proj - actual_fpts)) FILTER (WHERE actual_fpts IS NOT NULL AND our_proj IS NOT NULL) AS our_mae,
            AVG(our_proj - actual_fpts) FILTER (WHERE actual_fpts IS NOT NULL AND our_proj IS NOT NULL) AS our_bias,
            COUNT(*) FILTER (WHERE actual_fpts IS NOT NULL AND linestar_proj IS NOT NULL) AS n_ls,
            AVG(ABS(linestar_proj - actual_fpts)) FILTER (WHERE actual_fpts IS NOT NULL AND linestar_proj IS NOT NULL) AS ls_mae,
            AVG(linestar_proj - actual_fpts) FILTER (WHERE actual_fpts IS NOT NULL AND linestar_proj IS NOT NULL) AS ls_bias
        FROM dk_players
        WHERE slate_id = %s
        """,
        (slate_id,),
    )
    if stats and stats["n_our"]:
        print(f"\n── Accuracy (n={stats['n_our']}) ─────────────")
        print(f"  Our model  — MAE: {stats['our_mae']:.2f}  Bias: {stats['our_bias']:+.2f}")
        if stats["n_ls"]:
            print(f"  LineStar   — MAE: {stats['ls_mae']:.2f}  Bias: {stats['ls_bias']:+.2f}")
            winner = "Our model" if stats["our_mae"] < stats["ls_mae"] else "LineStar"
            diff = abs(stats["our_mae"] - stats["ls_mae"])
            print(f"  Winner: {winner} by {diff:.2f} pts/player")

    update_lineup_actuals(db, slate_id)


def update_lineup_actuals(db, slate_id: int) -> None:
    """Sum actual_fpts for each saved lineup's players and store in dk_lineups.actual_fpts.

    Called automatically after player actuals are updated. Safe to re-run.
    """
    lineups = db.execute(
        "SELECT id, player_ids FROM dk_lineups WHERE slate_id = %s", (slate_id,)
    )
    if not lineups:
        return

    updated = 0
    for lineup in lineups:
        ids = [int(x) for x in lineup["player_ids"].split(",") if x.strip()]
        if not ids:
            continue
        placeholders = ",".join(["%s"] * len(ids))
        result = db.execute_one(
            f"SELECT SUM(actual_fpts) AS total FROM dk_players "
            f"WHERE id IN ({placeholders}) AND actual_fpts IS NOT NULL",
            ids,
        )
        if result and result["total"] is not None:
            db.execute(
                "UPDATE dk_lineups SET actual_fpts = %s WHERE id = %s",
                (result["total"], lineup["id"]),
            )
            updated += 1

    print(f"Lineup actuals updated: {updated}/{len(lineups)}")

    # Print strategy comparison
    comparison = db.execute(
        """
        SELECT
            strategy,
            COUNT(*) AS n,
            AVG(proj_fpts) AS avg_proj,
            AVG(actual_fpts) AS avg_actual
        FROM dk_lineups
        WHERE slate_id = %s AND actual_fpts IS NOT NULL
        GROUP BY strategy
        ORDER BY avg_actual DESC NULLS LAST
        """,
        (slate_id,),
    )
    if comparison:
        print(f"\n-- Strategy Comparison ({'slate_id=' + str(slate_id)}) --")
        print(f"  {'Strategy':<12}  {'N':>4}  {'AvgProj':>8}  {'AvgActual':>10}")
        print("  " + "-" * 38)
        for row in comparison:
            avg_actual = f"{row['avg_actual']:.1f}" if row["avg_actual"] else "pending"
            print(
                f"  {row['strategy']:<12}  {row['n']:>4}  "
                f"{row['avg_proj']:>8.1f}  {avg_actual:>10}"
            )


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="Ingest DK results CSV → actual_fpts")
    parser.add_argument("--results", required=True, help="Path to DK results CSV")
    parser.add_argument("--slate-date", help="Slate date (YYYY-MM-DD), defaults to most recent")
    args = parser.parse_args()
    run(args.results, args.slate_date)
