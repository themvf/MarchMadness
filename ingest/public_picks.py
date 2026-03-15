"""Ingest public pick percentages from ESPN Tournament Challenge.

ESPN publishes aggregate pick rates showing what percentage of brackets
have each team advancing to each round. This data is essential for
bracket pool strategy — teams the public overvalues (high pick % but
low model probability) should be faded; undervalued teams create
contrarian leverage.

The data must be collected after Selection Sunday when millions of
brackets are submitted. ESPN doesn't provide a clean public API, so
this script supports multiple input methods:

  1. JSON file with team pick percentages
  2. Manual dict entry (for quick updates)

JSON format:
  {
    "source": "espn",
    "teams": [
      {"name": "Duke", "R64": 0.99, "R32": 0.85, "S16": 0.62, "E8": 0.41, "F4": 0.28, "Champion": 0.15},
      {"name": "Houston", "R64": 0.98, "R32": 0.88, ...},
      ...
    ]
  }

Usage:
    python -m ingest.public_picks --file picks.json
    python -m ingest.public_picks --show
"""

from __future__ import annotations

import json
import logging
import sys
from pathlib import Path

from config import load_config
from db.database import DatabaseManager
from db.queries import upsert_public_pick
from ingest.team_mappings import resolve_team_id

logger = logging.getLogger(__name__)

ROUNDS = ["R64", "R32", "S16", "E8", "F4", "NCG", "Champion"]


def ingest_from_json(
    db: DatabaseManager,
    season: int,
    json_path: str,
) -> int:
    """Load public pick percentages from a JSON file."""
    path = Path(json_path)
    if not path.exists():
        print(f"File not found: {json_path}")
        return 0

    with open(path) as f:
        data = json.load(f)

    source = data.get("source", "espn")
    teams_data = data.get("teams", [])
    if not teams_data:
        print("No teams found in JSON")
        return 0

    count = 0
    for team in teams_data:
        name = team.get("name")
        if not name:
            continue

        # Resolve team ID
        team_id = resolve_team_id(db, name, "torvik")
        if not team_id:
            # Try as NCAA name
            team_id = resolve_team_id(db, name, "ncaa")
        if not team_id:
            print(f"  Could not resolve team: {name}")
            continue

        for round_name in ROUNDS:
            pct = team.get(round_name)
            if pct is not None:
                # Accept both 0-1 and 0-100 formats
                if pct > 1:
                    pct = pct / 100.0
                upsert_public_pick(db, season, team_id, round_name, pct, source)
                count += 1

        print(f"  {name}: {sum(1 for r in ROUNDS if team.get(r) is not None)} rounds")

    print(f"\nIngested {count} pick entries for {len(teams_data)} teams")
    return count


def show_picks(db: DatabaseManager, season: int) -> None:
    """Display current public pick data."""
    rows = db.execute(
        """
        SELECT pp.round, t.name, tb.seed, tb.region, pp.pick_pct, pp.source
        FROM public_picks pp
        JOIN teams t ON t.team_id = pp.team_id
        LEFT JOIN tournament_bracket tb
            ON tb.team_id = pp.team_id AND tb.season = pp.season
        WHERE pp.season = %s
        ORDER BY CASE pp.round
            WHEN 'R64' THEN 1 WHEN 'R32' THEN 2 WHEN 'S16' THEN 3
            WHEN 'E8' THEN 4 WHEN 'F4' THEN 5 WHEN 'NCG' THEN 6
            WHEN 'Champion' THEN 7 ELSE 8 END,
            pp.pick_pct DESC
        """,
        (season,),
    )

    if not rows:
        print("No public pick data found")
        return

    current_round = None
    for row in rows:
        if row["round"] != current_round:
            current_round = row["round"]
            print(f"\n{'=' * 50}")
            print(f"  {current_round}")
            print(f"{'=' * 50}")

        seed_str = f"#{row['seed']:2d}" if row.get("seed") else "   "
        region = row.get("region", "")[:4] if row.get("region") else ""
        print(
            f"  {seed_str} {region:4s} {row['name']:<25s} "
            f"{row['pick_pct'] * 100:5.1f}%  ({row['source']})"
        )


if __name__ == "__main__":
    config = load_config()
    db = DatabaseManager(config.database_url)
    season = config.model.current_season

    args = sys.argv[1:]

    if not args:
        print("Usage:")
        print("  python -m ingest.public_picks --file picks.json")
        print("  python -m ingest.public_picks --show")
        sys.exit(0)

    if args[0] == "--file":
        if len(args) < 2:
            print("Usage: --file PATH_TO_JSON")
            sys.exit(1)
        print(f"Ingesting public picks from {args[1]}...")
        count = ingest_from_json(db, season, args[1])

    elif args[0] == "--show":
        show_picks(db, season)

    else:
        print(f"Unknown command: {args[0]}")
        sys.exit(1)
