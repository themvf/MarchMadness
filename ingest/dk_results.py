"""Ingest DraftKings results → actual_fpts + actual_own_pct in dk_players.

Supports two file formats:

1. DK Salary-style results CSV (simple):
   Columns: Position, Name+ID, Name, ID, ..., Salary, ..., FPTS
   Usage: python -m ingest.dk_results --results DKResults_3_21_2026.csv

2. DK Contest Standings CSV (richer — includes actual ownership):
   Columns: Rank, EntryId, ..., Lineup, , Player, Roster Position, %Drafted, FPTS
   Usage: python -m ingest.dk_results --results contest-standings-189023744.csv

The standings format is preferred when available — it includes actual %Drafted
which is required for ownership model training.

Expected match rate: ~95%+ (DK name variants are consistent within a slate).
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


def detect_format(content: str) -> str:
    """Return 'standings' or 'results' based on CSV header."""
    first_line = content.split("\n")[0]
    if "EntryId" in first_line or "%Drafted" in first_line:
        return "standings"
    return "results"


def parse_contest_standings_csv(content: str) -> list[dict]:
    """Parse DK post-contest standings CSV.

    The right-side columns (8-10) contain per-player data sorted by ownership:
      Player | Roster Position | %Drafted | FPTS

    Each player appears exactly once. Returns list of
    {name, actual_fpts, actual_own_pct}.
    """
    reader = csv.reader(io.StringIO(content))
    next(reader)  # skip header
    players: dict[str, dict] = {}
    for row in reader:
        if len(row) < 11:
            continue
        name = row[7].strip()
        if not name:
            continue
        own_str = row[9].strip().replace("%", "")
        fpts_str = row[10].strip()
        try:
            actual_fpts = float(fpts_str)
            actual_own_pct = float(own_str)
            if name not in players:  # first occurrence wins (they repeat)
                players[name] = {
                    "name": name,
                    "actual_fpts": actual_fpts,
                    "actual_own_pct": actual_own_pct,
                }
        except ValueError:
            pass
    return list(players.values())


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

    fmt = detect_format(content)
    if fmt == "standings":
        result_players = parse_contest_standings_csv(content)
        print(f"Detected format: contest standings (includes actual ownership)")
    else:
        result_players = parse_dk_results_csv(content)
        print(f"Detected format: results CSV")

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
        own_pct = result_p.get("actual_own_pct")
        r_salary = result_p.get("salary")

        # Exact match: name + salary (salary only available in results format)
        exact = next(
            (
                p for p in pool
                if p["name"] == result_p["name"]
                and (r_salary is None or p["salary"] == r_salary)
            ),
            None,
        )

        if exact:
            db.execute(
                "UPDATE dk_players SET actual_fpts = %s, actual_own_pct = %s WHERE id = %s",
                (result_p["actual_fpts"], own_pct, exact["id"]),
            )
            updated += 1
            continue

        # Fuzzy name match — standings format has no salary, so match by name only
        has_salary = result_p.get("salary") is not None
        same_salary = [p for p in pool if p["salary"] == result_p.get("salary")] if has_salary else []
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
                "UPDATE dk_players SET actual_fpts = %s, actual_own_pct = %s WHERE id = %s",
                (result_p["actual_fpts"], own_pct, player["id"]),
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
        print(f"\n-- FPTS Accuracy (n={stats['n_our']}) --------")
        print(f"  Our model  -- MAE: {stats['our_mae']:.2f}  Bias: {stats['our_bias']:+.2f}")
        if stats["n_ls"]:
            print(f"  LineStar   -- MAE: {stats['ls_mae']:.2f}  Bias: {stats['ls_bias']:+.2f}")
            winner = "Our model" if stats["our_mae"] < stats["ls_mae"] else "LineStar"
            diff = abs(stats["our_mae"] - stats["ls_mae"])
            print(f"  Winner: {winner} by {diff:.2f} pts/player")

    # Ownership accuracy (only populated from standings format)
    own_stats = db.execute_one(
        """
        SELECT
            COUNT(*) FILTER (WHERE actual_own_pct IS NOT NULL AND proj_own_pct IS NOT NULL) AS n,
            AVG(ABS(proj_own_pct - actual_own_pct))
                FILTER (WHERE actual_own_pct IS NOT NULL AND proj_own_pct IS NOT NULL) AS mae,
            AVG(proj_own_pct - actual_own_pct)
                FILTER (WHERE actual_own_pct IS NOT NULL AND proj_own_pct IS NOT NULL) AS bias,
            CORR(proj_own_pct, actual_own_pct)
                FILTER (WHERE actual_own_pct IS NOT NULL AND proj_own_pct IS NOT NULL) AS corr
        FROM dk_players WHERE slate_id = %s
        """,
        (slate_id,),
    )
    if own_stats and own_stats["n"]:
        print(f"\n-- Ownership Accuracy (n={own_stats['n']}) ---")
        print(f"  MAE:  {own_stats['mae']:.2f}%  Bias: {own_stats['bias']:+.2f}%")
        print(f"  Corr: {own_stats['corr']:.3f}  (1.0 = perfect rank-order)")

    update_lineup_actuals(db, slate_id)
    print_value_misses(db, slate_id)


def print_value_misses(db, slate_id: int, fpts_threshold: float = 30.0, own_threshold: float = 15.0) -> None:
    """Report high-scoring low-owned players that we missed entirely.

    Flags players where:
      - actual_fpts >= fpts_threshold  (boom game)
      - proj_own_pct < own_threshold   (low projected ownership → should have been leverage)
      - Not in ANY of our saved dk_lineups for this slate

    This is the core feedback loop for the leverage model: if these players
    were projectable AND low-owned, our leverage score should have surfaced them.
    """
    # Get all player IDs that appear in at least one of our lineups
    lineup_player_sets = db.execute(
        "SELECT player_ids FROM dk_lineups WHERE slate_id = %s", (slate_id,)
    )
    if not lineup_player_sets:
        return  # no lineups saved, nothing to compare

    our_player_ids: set[int] = set()
    for row in lineup_player_sets:
        for pid_str in (row["player_ids"] or "").split(","):
            pid_str = pid_str.strip()
            if pid_str.isdigit():
                our_player_ids.add(int(pid_str))

    # Query value-miss candidates
    misses = db.execute(
        """
        SELECT
            name,
            team_abbrev,
            salary,
            our_proj,
            linestar_proj,
            proj_own_pct,
            actual_fpts,
            actual_own_pct,
            our_leverage,
            id
        FROM dk_players
        WHERE slate_id = %s
          AND actual_fpts >= %s
          AND (proj_own_pct IS NULL OR proj_own_pct < %s)
          AND actual_fpts IS NOT NULL
        ORDER BY actual_fpts DESC
        """,
        (slate_id, fpts_threshold, own_threshold),
    )

    if not misses:
        print(f"\n-- Value Misses: none (no player scored ≥{fpts_threshold} with <{own_threshold}% proj own)")
        return

    # Split into missed vs captured
    missed = [p for p in misses if p["id"] not in our_player_ids]
    captured = [p for p in misses if p["id"] in our_player_ids]

    print(f"\n-- Value Misses (actual ≥{fpts_threshold:.0f} FPTS, proj own <{own_threshold:.0f}%) --")
    print(f"  {len(captured)} captured in our lineups, {len(missed)} missed entirely\n")

    if missed:
        print(f"  {'Name':<22} {'Team':>5}  {'Sal':>6}  {'OurProj':>8}  {'LSProj':>8}  {'ProjOwn':>8}  {'ActOwn':>7}  {'ActFPTS':>8}  {'Leverage':>9}")
        print("  " + "-" * 95)
        for p in missed:
            our_proj_s = f"{p['our_proj']:.1f}" if p["our_proj"] is not None else "  N/A"
            ls_proj_s  = f"{p['linestar_proj']:.1f}" if p["linestar_proj"] is not None else "  N/A"
            proj_own_s = f"{p['proj_own_pct']:.1f}%" if p["proj_own_pct"] is not None else "  N/A"
            act_own_s  = f"{p['actual_own_pct']:.1f}%" if p["actual_own_pct"] is not None else "  N/A"
            lev_s      = f"{p['our_leverage']:.2f}" if p["our_leverage"] is not None else "  N/A"
            print(
                f"  {p['name']:<22} {p['team_abbrev']:>5}  ${p['salary']:>5}  "
                f"{our_proj_s:>8}  {ls_proj_s:>8}  {proj_own_s:>8}  {act_own_s:>7}  "
                f"{p['actual_fpts']:>8.1f}  {lev_s:>9}"
            )

    if captured:
        names = ", ".join(p["name"] for p in captured)
        print(f"\n  Captured (appeared in ≥1 lineup): {names}")


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
