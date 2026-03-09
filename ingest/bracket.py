"""Import tournament bracket data.

After Selection Sunday (March 15), the bracket can be imported from:
  1. Manual input (dict of region -> list of (seed, team_name) pairs)
  2. Future: scrape from NCAA.com or ESPN

For testing before the bracket is released, `generate_projected_bracket()`
creates a bracket from the top 64 teams by Torvik rating.
"""

from __future__ import annotations

from db.database import DatabaseManager
from db.queries import upsert_bracket_entry, get_bracket
from ingest.team_mappings import resolve_team_id
from ingest.torvik import build_team_id_cache, resolve_from_cache


def import_bracket(
    db: DatabaseManager,
    season: int,
    bracket_data: dict[str, list[tuple[int, str]]],
) -> int:
    """Import bracket from a structured dict.

    Args:
        bracket_data: {region_name: [(seed, team_name), ...]}
            e.g. {"East": [(1, "Duke"), (2, "Alabama"), ...]}

    Returns number of teams imported.
    """
    team_cache = build_team_id_cache(db)
    count = 0
    position = 0

    for region, teams in bracket_data.items():
        for seed, team_name in teams:
            team_id = resolve_from_cache(team_cache, team_name)
            if not team_id:
                print(f"  WARNING: Could not resolve '{team_name}'")
                continue

            position += 1
            upsert_bracket_entry(
                db,
                season=season,
                team_id=team_id,
                seed=seed,
                region=region,
                bracket_position=position,
            )
            count += 1

    print(f"Imported {count} teams into bracket for {season}")
    return count


def generate_projected_bracket(db: DatabaseManager, season: int) -> int:
    """Generate a projected bracket from Torvik ratings.

    Takes the top 64 teams by AdjEM and assigns them to 4 regions
    with proper seeding (1-16 per region). Uses serpentine assignment
    to balance regions.

    This is an approximation for testing before the real bracket drops.
    """
    # Get top 64 teams by AdjEM
    top_teams = db.execute(
        """
        SELECT tr.team_id, t.name, tr.adj_em, tr.rank
        FROM torvik_ratings tr
        JOIN teams t ON t.team_id = tr.team_id
        WHERE tr.season = %s
        ORDER BY tr.adj_em DESC
        LIMIT 64
        """,
        (season,),
    )

    if len(top_teams) < 64:
        print(f"Only {len(top_teams)} teams with ratings — need 64")
        return 0

    regions = ["East", "West", "South", "Midwest"]

    # Serpentine seeding: seed 1s get teams 1-4, seed 2s get teams 5-8 (reversed), etc.
    bracket_data: dict[str, list[tuple[int, str]]] = {r: [] for r in regions}

    for seed in range(1, 17):
        start_idx = (seed - 1) * 4
        seed_group = top_teams[start_idx:start_idx + 4]

        # Alternate direction for balance
        if seed % 2 == 0:
            seed_group = list(reversed(seed_group))

        for i, team in enumerate(seed_group):
            bracket_data[regions[i]].append((seed, team["name"]))

    return import_bracket(db, season, bracket_data)


if __name__ == "__main__":
    from config import load_config

    config = load_config()
    db = DatabaseManager(config.database_url)
    season = config.model.current_season

    # Check if bracket already exists
    existing = get_bracket(db, season)
    if existing:
        print(f"Bracket already exists for {season} ({len(existing)} teams)")
        print("Delete existing bracket? (y/n)")
        # For non-interactive use, just show the bracket
        print("\nCurrent bracket:")
        for row in existing:
            print(f"  {row['region']:8s} #{row['seed']:2d} {row['name']}")
        exit(0)

    print(f"Generating projected bracket for {season}...")
    count = generate_projected_bracket(db, season)

    if count:
        bracket = get_bracket(db, season)
        print(f"\nProjected bracket ({len(bracket)} teams):")
        for region in ["East", "West", "South", "Midwest"]:
            print(f"\n  {region}:")
            region_teams = [r for r in bracket if r["region"] == region]
            for r in region_teams:
                print(f"    #{r['seed']:2d} {r['name']}")
