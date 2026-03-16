"""Import the official 2026 NCAA Tournament bracket.

Source: NCAA official bracket PDF, Selection Sunday March 15, 2026.

First Four games (March 17-18 in Dayton):
  16: UMBC vs Howard       -> winner plays #1 Michigan (Midwest)
  16: Prairie View A&M vs Lehigh -> winner plays #1 Florida (South)
  11: Texas vs NC State    -> winner plays #6 BYU (West)
  11: SMU vs Miami (Ohio)  -> winner plays #6 Tennessee (Midwest)

This script imports the 60 definite teams. First Four winners
must be added after their games (March 17-18) before generating
R64 matchups.

Usage:
    python -m ingest.bracket_2026
    python -m ingest.bracket_2026 --first-four  (after First Four games)
"""

from __future__ import annotations

import sys

from config import load_config
from db.database import DatabaseManager
from db.queries import get_bracket
from ingest.bracket import import_bracket


# Official 2026 NCAA Tournament bracket (60 definite teams)
BRACKET_2026 = {
    "East": [
        (1, "Duke"),
        (2, "UConn"),
        (3, "Michigan St."),
        (4, "Kansas"),
        (5, "St. John's"),
        (6, "Louisville"),
        (7, "UCLA"),
        (8, "Ohio St."),
        (9, "TCU"),
        (10, "UCF"),
        (11, "South Florida"),
        (12, "Northern Iowa"),
        (13, "Cal Baptist"),
        (14, "North Dakota St."),
        (15, "Furman"),
        (16, "Siena"),
    ],
    "West": [
        (1, "Arizona"),
        (2, "Purdue"),
        (3, "Gonzaga"),
        (4, "Arkansas"),
        (5, "Wisconsin"),
        (6, "BYU"),
        (7, "Miami (FL)"),
        (8, "Villanova"),
        (9, "Utah St."),
        (10, "Missouri"),
        # (11, TBD) — NC State vs Texas First Four winner
        (12, "High Point"),
        (13, "Hawaii"),
        (14, "Kennesaw St."),
        (15, "Queens"),
        (16, "Long Island"),
    ],
    "South": [
        (1, "Florida"),
        (2, "Houston"),
        (3, "Illinois"),
        (4, "Nebraska"),
        (5, "Vanderbilt"),
        (6, "North Carolina"),
        (7, "Saint Mary's"),
        (8, "Clemson"),
        (9, "Iowa"),
        (10, "Texas A&M"),
        (11, "VCU"),
        (12, "McNeese"),
        (13, "Troy"),
        (14, "Penn"),
        (15, "Idaho"),
        # (16, TBD) — Lehigh vs Prairie View A&M First Four winner
    ],
    "Midwest": [
        (1, "Michigan"),
        (2, "Iowa St."),
        (3, "Virginia"),
        (4, "Alabama"),
        (5, "Texas Tech"),
        (6, "Tennessee"),
        (7, "Kentucky"),
        (8, "Georgia"),
        (9, "Saint Louis"),
        (10, "Santa Clara"),
        # (11, TBD) — SMU vs Miami (Ohio) First Four winner
        (12, "Akron"),
        (13, "Hofstra"),
        (14, "Wright St."),
        (15, "Tennessee St."),
        # (16, TBD) — Howard vs UMBC First Four winner
    ],
}

# First Four matchups — add winners after games on March 17-18
FIRST_FOUR = {
    "West": [(11, "NC State", "Texas")],         # winner plays #6 BYU
    "South": [(16, "Lehigh", "Prairie View A&M")],  # winner plays #1 Florida
    "Midwest": [
        (11, "SMU", "Miami (Ohio)"),              # winner plays #6 Tennessee
        (16, "Howard", "UMBC"),                   # winner plays #1 Michigan
    ],
}


def add_first_four_winner(
    db: DatabaseManager,
    season: int,
    region: str,
    seed: int,
    winner_name: str,
) -> None:
    """Add a First Four winner to the bracket."""
    from ingest.bracket import import_bracket
    data = {region: [(seed, winner_name)]}
    count = import_bracket(db, season, data)
    if count:
        print(f"Added First Four winner: #{seed} {winner_name} -> {region}")


if __name__ == "__main__":
    config = load_config()
    db = DatabaseManager(config.database_url)
    season = config.model.current_season

    args = sys.argv[1:]

    if args and args[0] == "--first-four":
        # Interactive: add First Four winners
        print("First Four Results — enter winner team name for each:")
        print()
        for region, matchups in FIRST_FOUR.items():
            for seed, team_a, team_b in matchups:
                print(f"  {region} #{seed}: {team_a} vs {team_b}")
                winner = input(f"    Winner? [{team_a}/{team_b}]: ").strip()
                if winner:
                    add_first_four_winner(db, season, region, seed, winner)
        print("\nDone. Check bracket with: python -m ingest.bracket")
    else:
        # Import the 60 definite teams
        existing = get_bracket(db, season)
        if existing:
            print(f"Existing bracket found for {season} ({len(existing)} teams)")
            print("Clearing old bracket and importing real 2026 bracket...")
            db.execute(
                "DELETE FROM tournament_bracket WHERE season = %s",
                (season,),
            )
            print(f"  Deleted {len(existing)} old entries")

        print(f"Importing 2026 NCAA Tournament bracket...")
        count = import_bracket(db, season, BRACKET_2026)

        if count:
            print(f"\nImported {count}/60 definite teams (4 First Four slots pending)")
            print("\nFirst Four games (March 17-18):")
            for region, matchups in FIRST_FOUR.items():
                for seed, team_a, team_b in matchups:
                    print(f"  {region} #{seed}: {team_a} vs {team_b}")
            print("\nAfter First Four, run: python -m ingest.bracket_2026 --first-four")
