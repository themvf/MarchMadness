"""DraftKings API client — fetch slate/player data without manual CSV download.

Public endpoints (no auth required):
  GET /contests/v1/contests/{contestId}
      → returns draftGroupId, contest name, start time

  GET /draftgroups/v1/draftgroups/{draftGroupId}/draftables
      → full player pool with salaries, positions, projections

CBB roster slot IDs:
  515 = G primary slot
  516 = F primary slot
  517 = UTIL slot (every player eligible)

Each player appears once per eligible slot:
  G player    → slots [515, 517] → eligible_positions "G/UTIL"
  F player    → slots [516, 517] → eligible_positions "F/UTIL"
  G/F player  → slots [515, 516, 517] → eligible_positions "G/F/UTIL"

Returns dicts in the same format as parse_dk_csv() so the dk_slate.py
projection + save pipeline works without modification.

Usage (as a standalone module — usually imported by dk_slate.py):
    from ingest.dk_api import fetch_dk_players, fetch_draft_group_id

    # Option A: pass draftGroupId directly (from DK lobby URL)
    players = fetch_dk_players(144324)

    # Option B: resolve from contestId
    dgid = fetch_draft_group_id(189058648)
    players = fetch_dk_players(dgid)
"""

from __future__ import annotations

import logging
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any

import requests

logger = logging.getLogger(__name__)

# Stat attribute ID for DK's projected FPTS (AvgPointsPerGame equivalent)
_PROJ_STAT_ID = 279

# US/Eastern offset for March–November (EDT = UTC-4)
_ET_OFFSET = timedelta(hours=-4)

_TIMEOUT = 15
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/123.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
}


# ── Public API ────────────────────────────────────────────────


def fetch_draft_group_id(contest_id: int) -> int:
    """Resolve a DK contestId → draftGroupId.

    Get the contestId from the DK lobby URL:
      https://www.draftkings.com/contest/draftteam/{contestId}

    Args:
        contest_id: integer contest ID visible in the DK lobby URL.

    Returns:
        draftGroupId to pass to fetch_dk_players().

    Raises:
        requests.HTTPError: on API failure.
        KeyError: if response structure is unexpected.
    """
    url = f"https://api.draftkings.com/contests/v1/contests/{contest_id}"
    resp = requests.get(url, headers=_HEADERS, timeout=_TIMEOUT)
    resp.raise_for_status()
    data = resp.json()
    # API returns {"contestDetail": {..., "draftGroupId": 144324, ...}}
    dgid: int = data["contestDetail"]["draftGroupId"]
    logger.info("Contest %d → draftGroupId %d", contest_id, dgid)
    return dgid


def fetch_dk_players(draft_group_id: int) -> list[dict]:
    """Fetch the full player pool from DK API for a given draftGroupId.

    Returns a list of player dicts in the same format as parse_dk_csv():
        {
            "name":               str,
            "dk_id":              int,    # draftableId (primary position slot)
            "team_abbrev":        str,    # uppercase, e.g. "ISU"
            "eligible_positions": str,    # "G/UTIL", "F/UTIL", "G/F/UTIL"
            "salary":             int,    # dollars
            "game_info":          str,    # "UK@ISU 03/22/2026 02:45PM ET"
            "avg_fpts_dk":        float | None,  # DK's own FPTS projection
        }

    De-duplication: each player appears once per eligible roster slot in the
    raw API response. We take the entry with the lowest rosterSlotId as
    canonical (the primary-position entry), which matches what DK's salary
    CSV exports.

    Args:
        draft_group_id: DK draftGroupId (from DK lobby URL or fetch_draft_group_id()).

    Raises:
        requests.HTTPError: on API failure.
    """
    url = (
        f"https://api.draftkings.com/draftgroups/v1/draftgroups"
        f"/{draft_group_id}/draftables"
    )
    resp = requests.get(url, headers=_HEADERS, timeout=_TIMEOUT)
    resp.raise_for_status()

    data: dict[str, Any] = resp.json()
    raw: list[dict] = data.get("draftables", [])

    # Group all slot-entries by playerId so we can pick the canonical one
    by_player: dict[int, list[dict]] = defaultdict(list)
    for entry in raw:
        by_player[entry["playerId"]].append(entry)

    players = []
    for player_id, entries in by_player.items():
        # Sort by rosterSlotId ascending; lowest = primary position slot
        entries_sorted = sorted(entries, key=lambda e: e["rosterSlotId"])
        canonical = entries_sorted[0]

        # Derive eligible_positions: "G" → "G/UTIL", "F" → "F/UTIL", "G/F" → "G/F/UTIL"
        position = canonical.get("position", "UTIL")
        eligible_positions = f"{position}/UTIL" if position != "UTIL" else "UTIL"

        # Extract DK's own projection (stat attribute id=279)
        avg_fpts_dk: float | None = None
        for attr in canonical.get("draftStatAttributes", []):
            if attr.get("id") == _PROJ_STAT_ID:
                try:
                    avg_fpts_dk = float(attr["value"])
                except (ValueError, TypeError):
                    pass
                break

        players.append({
            "name": canonical.get("displayName", ""),
            "dk_id": canonical["draftableId"],
            "team_abbrev": (canonical.get("teamAbbreviation") or "").upper(),
            "eligible_positions": eligible_positions,
            "salary": canonical.get("salary", 0),
            "game_info": _format_game_info(canonical.get("competition", {})),
            "avg_fpts_dk": avg_fpts_dk,
        })

    logger.info("Fetched %d players from draftGroupId %d", len(players), draft_group_id)
    return players


# ── Helpers ───────────────────────────────────────────────────


def _format_game_info(competition: dict) -> str:
    """Format a competition dict to match the DK CSV game_info format.

    Input:  {"name": "UK @ ISU", "startTime": "2026-03-22T18:45:00.0000000Z"}
    Output: "UK@ISU 03/22/2026 02:45PM ET"

    The date portion is what the pipeline uses for slate_date detection;
    the time string is informational only.
    """
    name = competition.get("name", "")
    name_compact = name.replace(" @ ", "@").replace(" ", "")

    start_time = competition.get("startTime", "")
    if not start_time:
        return name_compact

    try:
        dt_utc = datetime.fromisoformat(start_time.replace("Z", "+00:00"))
        dt_et = dt_utc + _ET_OFFSET
        date_str = dt_et.strftime("%m/%d/%Y")
        # "02:45PM" format (leading zero kept to match DK CSV style)
        time_str = dt_et.strftime("%I:%M%p")
        return f"{name_compact} {date_str} {time_str} ET"
    except (ValueError, AttributeError):
        return name_compact
