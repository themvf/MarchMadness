"""Ingest DraftKings salary CSV + LineStar projections CSV into dk_players.

Usage:
    python -m ingest.dk_slate --dk DKSalaries.csv --linestar LineStar.csv
    python -m ingest.dk_slate --dk DKSalaries.csv --linestar LineStar.csv --date 2026-03-22

This merges both CSVs by player name + salary, then for each player:
  1. Matches team_abbrev → team_id via our teams table (fuzzy + manual overrides)
  2. Finds the active bracket_matchup for that team
  3. Loads torvik_ratings for team + opponent
  4. Fuzzy-matches player name → player_stats within the same team
  5. Computes our independent projection (pace / defense / blowout adjusted)
  6. Computes GPP leverage (low ownership × model edge over Vegas)
  7. Saves everything to dk_slates + dk_players

Expected match rate: 85-95% (some LineStar name variants differ from DK).
"""

from __future__ import annotations

import argparse
import csv
import io
import logging
import re
import sys
from datetime import datetime

from rapidfuzz import fuzz, process

from config import load_config
from db.database import DatabaseManager
from db.queries import (
    get_bracket_matchups,
    get_dk_players,
    upsert_dk_player,
    upsert_dk_slate,
)
from ingest.torvik import build_team_id_cache
from model.dfs_projections import compute_leverage, compute_our_projection

logger = logging.getLogger(__name__)

# ── Manual DK abbreviation overrides ────────────────────────
# DK uses short 3-6 char team codes that don't always match canonical names.
DK_ABBREV_OVERRIDES: dict[str, str] = {
    "DUKE": "Duke",
    "TCU": "TCU",
    "KU": "Kansas",
    "KSAS": "Kansas",
    "STJ": "St. John's",
    "STJN": "St. John's",
    "STJS": "St. John's",
    "CONN": "Connecticut",
    "CCONN": "Connecticut",
    "UCONN": "Connecticut",
    "MICH": "Michigan",
    "MICH ST": "Michigan State",
    "MSU": "Michigan State",
    "LOU": "Louisville",
    "UL": "Louisville",
    "UCLA": "UCLA",
    "TTU": "Texas Tech",
    "STL": "Saint Louis",
    "SLU": "Saint Louis",
    "UVA": "Virginia",
    "VIRG": "Virginia",
    "ISU": "Iowa State",
    "IOWA ST": "Iowa State",
    "UK": "Kentucky",
    "VAN": "Vanderbilt",
    "VAND": "Vanderbilt",
    "IOWA": "Iowa",
    "NEB": "Nebraska",
    "VCU": "VCU",
    "IL": "Illinois",
    "ILL": "Illinois",
    "TXAM": "Texas A&M",
    "TA&M": "Texas A&M",
    "AZ": "Arizona",
    "HOU": "Houston",
    "UH": "Houston",
    "TEX": "Texas",
    "UTST": "Utah State",
    "USU": "Utah State",
    "HPT": "High Point",
    "HIGHP": "High Point",
    "HIGH PT": "High Point",
    "GONZ": "Gonzaga",
    "ARK": "Arkansas",
    "PUR": "Purdue",
    "MIA": "Miami FL",
    "MIAF": "Miami FL",
    "MIAFL": "Miami FL",
    "ALA": "Alabama",
    "SNTLS": "Saint Louis",
    "SNLOU": "Saint Louis",
}


# ── CSV Parsers ─────────────────────────────────────────────


def parse_dk_csv(content: str) -> list[dict]:
    """Parse DraftKings salary CSV.

    Columns: Position, Name+ID, Name, ID, Roster Position, Salary,
             Game Info, TeamAbbrev, AvgPointsPerGame
    """
    players = []
    reader = csv.DictReader(io.StringIO(content))
    for row in reader:
        name = (row.get("Name") or "").strip()
        if not name:
            continue
        dk_id_str = (row.get("ID") or "").strip()
        if not dk_id_str:
            continue
        salary_str = (row.get("Salary") or "0").replace("$", "").replace(",", "").strip()
        players.append({
            "name": name,
            "dk_id": int(dk_id_str),
            "team_abbrev": (row.get("TeamAbbrev") or "").strip().upper(),
            "eligible_positions": (row.get("Roster Position") or "UTIL").strip(),
            "salary": int(salary_str) if salary_str.isdigit() else 0,
            "game_info": (row.get("Game Info") or "").strip(),
            "avg_fpts_dk": _safe_float(row.get("AvgPointsPerGame")),
        })
    return players


def parse_linestar_csv(content: str) -> dict[tuple, dict]:
    """Parse LineStar CSV into a lookup map keyed by (name_lower, salary_int).

    Columns (positional): Pos, Team(blank/logo), Player, Salary($X),
                          projOwn%, actualOwn%, Diff, Proj
    Filters out true DNPs (Proj=0 AND projOwn%=0).
    """
    lookup: dict[tuple, dict] = {}
    reader = csv.reader(io.StringIO(content))
    for i, row in enumerate(reader):
        if i == 0 or len(row) < 8:
            continue  # skip header
        player_name = row[2].strip() if len(row) > 2 else ""
        salary_str = row[3].strip().replace("$", "").replace(",", "") if len(row) > 3 else "0"
        proj_own_str = row[4].strip().replace("%", "") if len(row) > 4 else "0"
        proj_str = row[7].strip() if len(row) > 7 else "0"
        if not player_name:
            continue
        proj = _safe_float(proj_str) or 0.0
        proj_own = _safe_float(proj_own_str) or 0.0
        if proj == 0.0 and proj_own == 0.0:
            continue  # true DNP
        salary = int(salary_str) if salary_str.isdigit() else 0
        key = (player_name.lower(), salary)
        lookup[key] = {"linestar_proj": proj, "proj_own_pct": proj_own}
    return lookup


# ── Team ID Matching ─────────────────────────────────────────


def match_team_id(abbrev: str, cache: dict[str, int]) -> int | None:
    """Resolve DK team abbreviation to team_id using overrides + fuzzy match."""
    abbrev_upper = abbrev.strip().upper()

    # 1. Manual override
    canonical = DK_ABBREV_OVERRIDES.get(abbrev_upper)
    if canonical:
        tid = cache.get(canonical.lower())
        if tid:
            return tid

    # 2. Direct cache lookup (case-insensitive)
    tid = cache.get(abbrev_upper.lower())
    if tid:
        return tid

    # 3. Fuzzy match against all cached names (score >= 70 threshold)
    result = process.extractOne(
        abbrev_upper.lower(),
        list(cache.keys()),
        scorer=fuzz.token_sort_ratio,
        score_cutoff=70,
    )
    if result:
        return cache[result[0]]

    return None


# ── Player Stat Matching ────────────────────────────────────


def match_player_stats(dk_name: str, candidates: list[dict]) -> dict | None:
    """Fuzzy-match a DK player name to player_stats within the same team.

    We use token_sort_ratio which handles name order differences
    (e.g. "CJ Fredrick" vs "C.J. Fredrick").
    """
    if not candidates:
        return None
    names = [p["name"] for p in candidates]
    result = process.extractOne(
        dk_name,
        names,
        scorer=fuzz.token_sort_ratio,
        score_cutoff=75,
    )
    if result:
        idx = names.index(result[0])
        return candidates[idx]
    return None


# ── CSV Merge + Projection Pipeline ─────────────────────────


def build_player_pool(
    db: DatabaseManager,
    dk_players: list[dict],
    linestar_map: dict[tuple, dict],
    season: int = 2026,
) -> list[dict]:
    """Merge DK CSV, LineStar CSV, and DB data into a complete player pool.

    Returns enriched player dicts ready for upsert into dk_players table.
    """
    # Load all teams into a name→team_id cache (single DB query)
    team_cache = build_team_id_cache(db)

    # Load all active bracket matchups for this season
    matchups = db.execute(
        """
        SELECT id, team_a_id, team_b_id, model_prob_a, vegas_prob_a
        FROM bracket_matchups
        WHERE season = %s AND winner_id IS NULL
        """,
        (season,),
    )
    matchup_by_team: dict[int, dict] = {}
    for m in matchups:
        matchup_by_team[m["team_a_id"]] = m
        matchup_by_team[m["team_b_id"]] = m

    # Load torvik ratings for all teams this season
    ratings = db.execute(
        "SELECT team_id, adj_tempo, adj_oe, adj_de FROM torvik_ratings WHERE season = %s",
        (season,),
    )
    ratings_by_team: dict[int, dict] = {r["team_id"]: r for r in ratings}

    # Load all player stats for tournament teams only
    tournament_team_ids = list(
        {m["team_a_id"] for m in matchups} | {m["team_b_id"] for m in matchups}
    )
    if tournament_team_ids:
        placeholders = ",".join(["%s"] * len(tournament_team_ids))
        player_stats = db.execute(
            f"""
            SELECT name, team_id, min_pct, usage_rate, ppg, rpg, apg,
                   stl_pct, blk_pct, tov_pct
            FROM player_stats
            WHERE season = %s AND team_id IN ({placeholders})
            """,
            [season] + tournament_team_ids,
        )
    else:
        player_stats = []

    players_by_team: dict[int, list[dict]] = {}
    for ps in player_stats:
        tid = ps["team_id"]
        players_by_team.setdefault(tid, []).append(ps)

    # Process each DK player
    enriched = []
    matched_linestar = 0
    matched_team = 0
    matched_stats = 0

    for p in dk_players:
        result = dict(p)  # copy

        # --- LineStar merge (exact name+salary, then fuzzy name) ---
        ls_key = (p["name"].lower(), p["salary"])
        ls_data = linestar_map.get(ls_key)
        if ls_data is None:
            # Try fuzzy name match confirmed by salary
            for (ls_name, ls_sal), ls_info in linestar_map.items():
                if ls_sal == p["salary"] and fuzz.token_sort_ratio(p["name"].lower(), ls_name) >= 85:
                    ls_data = ls_info
                    break
        if ls_data:
            result.update(ls_data)
            matched_linestar += 1
        else:
            result["linestar_proj"] = None
            result["proj_own_pct"] = None

        # --- Team ID match ---
        team_id = match_team_id(p["team_abbrev"], team_cache)
        result["team_id"] = team_id
        if team_id:
            matched_team += 1

        # --- Matchup lookup ---
        matchup = matchup_by_team.get(team_id) if team_id else None
        result["matchup_id"] = matchup["id"] if matchup else None

        # --- Win probabilities ---
        win_prob = None
        vegas_win_prob = None
        if matchup and team_id:
            if matchup["team_a_id"] == team_id:
                win_prob = matchup["model_prob_a"]
                vegas_win_prob = matchup["vegas_prob_a"]
            else:
                win_prob = (1 - matchup["model_prob_a"]) if matchup["model_prob_a"] is not None else None
                vegas_win_prob = (1 - matchup["vegas_prob_a"]) if matchup["vegas_prob_a"] is not None else None

        # --- Player stat match ---
        stats = match_player_stats(p["name"], players_by_team.get(team_id or -1, []))

        # --- Our projection ---
        our_proj = None
        if stats and matchup and team_id:
            team_rating = ratings_by_team.get(team_id, {})
            opp_id = (
                matchup["team_b_id"]
                if matchup["team_a_id"] == team_id
                else matchup["team_a_id"]
            )
            opp_rating = ratings_by_team.get(opp_id, {})
            if win_prob is not None:
                our_proj = compute_our_projection(stats, team_rating, opp_rating, win_prob)
                if our_proj:
                    matched_stats += 1

        result["our_proj"] = our_proj

        # --- Leverage ---
        # Use our_proj when available; fall back to linestar_proj so players
        # without a stat match (can't compute our_proj) are still visible to
        # the GPP optimizer rather than silently excluded.
        # If LineStar marks the player OUT, zero leverage so optimizer excludes them.
        is_out = result.get("is_out", False)
        proj_for_leverage = 0 if is_out else (our_proj or result.get("linestar_proj"))
        our_leverage = None
        if proj_for_leverage and result.get("proj_own_pct") is not None:
            our_leverage = compute_leverage(
                proj_for_leverage,
                result["proj_own_pct"],
                win_prob,
                vegas_win_prob,
            )
        result["our_leverage"] = our_leverage

        enriched.append(result)

    n = len(dk_players)
    print(f"  {n} DK players processed")
    print(f"  LineStar match: {matched_linestar}/{n} ({100*matched_linestar//n if n else 0}%)")
    print(f"  Team resolved:  {matched_team}/{n}")
    print(f"  Stats matched:  {matched_stats}/{n}")
    return enriched


# ── Main entry point ────────────────────────────────────────


def _parse_slate_date(game_info: str) -> str | None:
    """Extract date from 'TCU@DUKE 03/21/2026 05:15PM ET' → '2026-03-21'."""
    m = re.search(r"(\d{2}/\d{2}/\d{4})", game_info)
    if m:
        return datetime.strptime(m.group(1), "%m/%d/%Y").strftime("%Y-%m-%d")
    return None


def _safe_float(val) -> float | None:
    if not val:
        return None
    try:
        return float(str(val).strip())
    except (ValueError, TypeError):
        return None


def run(
    dk_path: str | None = None,
    linestar_path: str | None = None,
    draft_group_id: int | None = None,
    contest_id: int | None = None,
    linestar_api: bool = False,
    dnn_cookie: str | None = None,
    date_override: str | None = None,
    season: int = 2026,
) -> None:
    """Main pipeline: fetch/parse DK data → compute projections → save to DB.

    DK player source (one required):
        dk_path        — path to manually downloaded DK salary CSV
        draft_group_id — fetch from DK API using draftGroupId
        contest_id     — resolve to draftGroupId via API, then fetch

    LineStar source (optional, choose one):
        linestar_path  — path to LineStar projections CSV
        linestar_api   — fetch from LineStar API using DNN_COOKIE env var
                         (requires draft_group_id to be resolved first)
        If omitted, linestar_proj and proj_own_pct will be NULL for all players.
    """
    config = load_config()
    db = DatabaseManager(config.database_url)

    # ── DK player source ─────────────────────────────────────
    dgid: int | None = None
    if draft_group_id or contest_id:
        from ingest.dk_api import fetch_dk_players, fetch_draft_group_id as _resolve_dgid
        dgid = draft_group_id or _resolve_dgid(contest_id)
        dk_players = fetch_dk_players(dgid)
        print(f"API: {len(dk_players)} players fetched from draftGroupId {dgid}")
    elif dk_path:
        with open(dk_path, encoding="utf-8-sig") as f:
            dk_players = parse_dk_csv(f.read())
        print(f"CSV: {len(dk_players)} DK players parsed")
    else:
        raise ValueError("Provide --dk, --draft-group-id, or --contest-id")

    # ── LineStar source (optional) ───────────────────────────
    if linestar_path:
        with open(linestar_path, encoding="utf-8-sig") as f:
            ls_content = f.read()
        linestar_map = parse_linestar_csv(ls_content)
        print(f"LineStar CSV: {len(linestar_map)} entries parsed")
    elif linestar_api:
        if not dgid:
            raise ValueError(
                "--linestar-api requires --draft-group-id or --contest-id "
                "(so the draftGroupId is known to cross-reference with LineStar's slate list)"
            )
        from ingest.linestar_fetch import fetch_linestar_for_draft_group
        import os
        cookie = dnn_cookie or os.environ.get("DNN_COOKIE", "")
        print("LineStar API: fetching projections + ownership...")
        linestar_map = fetch_linestar_for_draft_group(dgid, dnn_cookie=cookie)
        print(f"LineStar API: {len(linestar_map)} entries fetched")
    else:
        linestar_map = {}
        print("LineStar: not provided — linestar_proj and proj_own_pct will be NULL")

    # Determine slate date
    slate_date = date_override
    if not slate_date:
        for p in dk_players:
            d = _parse_slate_date(p.get("game_info", ""))
            if d:
                slate_date = d
                break
    if not slate_date:
        slate_date = datetime.now().strftime("%Y-%m-%d")
    print(f"Slate date: {slate_date}")

    # Compute game count
    game_keys = {
        re.match(r"([^0-9]+)", p["game_info"].split()[0]).group(1).strip()
        for p in dk_players
        if p.get("game_info")
    }
    game_count = len(game_keys)

    # Upsert slate
    slate_id = upsert_dk_slate(db, slate_date, game_count)
    print(f"Slate ID: {slate_id}")

    # Build enriched pool
    pool = build_player_pool(db, dk_players, linestar_map, season)

    # Save to DB
    saved = 0
    for p in pool:
        upsert_dk_player(
            db,
            slate_id=slate_id,
            dk_player_id=p["dk_id"],
            name=p["name"],
            team_abbrev=p["team_abbrev"],
            eligible_positions=p["eligible_positions"],
            salary=p["salary"],
            team_id=p.get("team_id"),
            matchup_id=p.get("matchup_id"),
            game_info=p.get("game_info"),
            avg_fpts_dk=p.get("avg_fpts_dk"),
            linestar_proj=p.get("linestar_proj"),
            proj_own_pct=p.get("proj_own_pct"),
            our_proj=p.get("our_proj"),
            our_leverage=p.get("our_leverage"),
        )
        saved += 1

    print(f"Saved {saved} players to slate {slate_id} ({slate_date})")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    parser = argparse.ArgumentParser(
        description="Ingest DK + LineStar DFS data",
        epilog=(
            "DK source (one required):\n"
            "  --dk               manually downloaded DK salary CSV\n"
            "  --draft-group-id   fetch from DK API (no CSV needed)\n"
            "  --contest-id       resolve draftGroupId from contestId, then fetch\n\n"
            "Examples:\n"
            "  # Classic CSV workflow:\n"
            "  python -m ingest.dk_slate --dk DKSalaries.csv --linestar LineStar.csv\n\n"
            "  # API workflow (no DK CSV download needed):\n"
            "  python -m ingest.dk_slate --draft-group-id 144324 --linestar LineStar.csv\n\n"
            "  # API workflow with contest ID from DK lobby URL:\n"
            "  python -m ingest.dk_slate --contest-id 189058648 --linestar LineStar.csv\n\n"
            "  # Fully automated (no CSV files at all — own% will be NULL):\n"
            "  python -m ingest.dk_slate --draft-group-id 144324\n\n"
            "  # Fully automated WITH LineStar projections + ownership:\n"
            "  python -m ingest.dk_slate --draft-group-id 144324 --linestar-api\n"
            "  # (requires DNN_COOKIE=<your .DOTNETNUKE cookie> in .env)\n"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    # DK player source — mutually exclusive, one required
    dk_source = parser.add_mutually_exclusive_group(required=True)
    dk_source.add_argument("--dk", help="Path to DraftKings salary CSV")
    dk_source.add_argument(
        "--draft-group-id", type=int, metavar="ID",
        help="DK draftGroupId — fetch player pool from API (no CSV needed)",
    )
    dk_source.add_argument(
        "--contest-id", type=int, metavar="ID",
        help="DK contestId — resolves to draftGroupId, then fetches from API",
    )

    parser.add_argument("--linestar", help="Path to LineStar projections CSV (optional)")
    parser.add_argument(
        "--linestar-api", action="store_true",
        help=(
            "Fetch LineStar projections + ownership via API instead of CSV. "
            "Requires DNN_COOKIE env var (your LineStar .DOTNETNUKE session cookie). "
            "Must be used with --draft-group-id or --contest-id."
        ),
    )
    parser.add_argument(
        "--dnn-cookie",
        default=None,
        help="Override DNN_COOKIE env var — value of .DOTNETNUKE session cookie",
    )
    parser.add_argument("--date", help="Slate date override (YYYY-MM-DD)")
    parser.add_argument("--season", type=int, default=2026)
    args = parser.parse_args()

    run(
        dk_path=args.dk,
        linestar_path=args.linestar,
        draft_group_id=args.draft_group_id,
        contest_id=args.contest_id,
        linestar_api=args.linestar_api,
        dnn_cookie=args.dnn_cookie,
        date_override=args.date,
        season=args.season,
    )
