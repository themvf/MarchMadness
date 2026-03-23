"""LineStar API client — fetch projections + ownership without manual CSV download.

LineStar is built on DotNetNuke CMS. The relevant endpoints are:

  GET /DesktopModules/DailyFantasyApi/API/Fantasy/GetPeriodInformation
      → no auth required; returns {PeriodId, Name, ...} for today/current slate
      → used to bootstrap the periodId when none is known

  GET /DesktopModules/DailyFantasyApi/API/Fantasy/GetSalariesV5
      ?periodId={periodId}&site=1&sport=4
      → full projection + ownership payload (may require .DOTNETNUKE session cookie)
      → response body: JSON with {SalaryContainerJson (embedded JSON string),
                                   Ownership.Projected {contestTypeId: [{SalaryId, Owned}]},
                                   Periods [...], Slates [...]}

  GET /DesktopModules/DailyFantasyApi/API/Fantasy/GetFastUpdateV2
      ?periodId={periodId}&site=1&sport=4
      → lightweight live-ownership refresh (4.9 kB), call every 30–60 s pre-lock

Parameters (site / sport):
  site=1  → DraftKings
  sport=4 → College Basketball (CBB)

SalaryContainerJson.Salaries[] fields used:
  Id      → SalaryId (foreign key into Ownership.Projected)
  Name    → player display name (matches DK salary CSV)
  SAL     → DK salary in dollars
  POS     → position ("G", "F")
  PP      → LineStar projection (FPTS) — this is the key number
  GI      → game info string (e.g. "UK@ISU 11:45 AM")
  PTEAM   → player's team abbreviation
  IS      → injury status (1=injured, 3=GTD, 0=healthy)
  STAT    → player status (4=out, 0=active)

Ownership.Projected structure:
  {contestTypeId: [{SalaryId: int, PlayerId: int, Owned: float, DoubleUp: float}]}
  contestTypeId "6" = large GPP; we average all contest types present.

Slates cross-reference:
  [{PeriodId: 1261, DfsSlateId: 144324, Games: 8, Players: 240}]
  DfsSlateId = DK draftGroupId — this bridges the two systems.

Returns dicts compatible with dk_slate.py merge pipeline:
  (name_lower, salary_int) → {linestar_proj, proj_own_pct}

Usage:
    from ingest.linestar_fetch import fetch_linestar_for_draft_group

    # Requires DNN_COOKIE env var (or explicit dnn_cookie parameter)
    linestar_map = fetch_linestar_for_draft_group(dk_draft_group_id=144324)

    # Then use in dk_slate.py merge:
    merged = merge_csvs(dk_players, linestar_map)
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

import requests

logger = logging.getLogger(__name__)

_BASE = "https://www.linestarapp.com"
_TIMEOUT = 20

# LineStar site/sport IDs for DraftKings CBB
_SITE = 1   # DraftKings
_SPORT = 4  # College Basketball

# Player status codes that mean "do not use"
_OUT_STATS = {4}     # STAT=4 means out
_OUT_IS    = {1}     # IS=1 means injured/out (3=GTD, keep those)


# ── Public API ─────────────────────────────────────────────────────────────────


def fetch_linestar_for_draft_group(
    dk_draft_group_id: int,
    dnn_cookie: str | None = None,
) -> dict[tuple, dict]:
    """Fetch LineStar projections + ownership for a DK draft group.

    Automatically discovers the LineStar periodId by cross-referencing the
    DK draftGroupId through the Slates array.

    Args:
        dk_draft_group_id: DK draftGroupId (integer from DK lobby URL).
        dnn_cookie: Value of the .DOTNETNUKE session cookie. If None, reads
                    from the DNN_COOKIE environment variable.

    Returns:
        Dict keyed by (player_name_lower, salary_int) → {linestar_proj, proj_own_pct}
        Compatible with dk_slate.parse_linestar_csv() output format.

    Raises:
        ValueError: if no matching slate is found for the draftGroupId.
        requests.HTTPError: on API failure.
    """
    cookie = dnn_cookie or os.environ.get("DNN_COOKIE", "")

    # Step 1: Bootstrap — find today's periodId via GetPeriodInformation
    period_id = _get_period_id_for_draft_group(dk_draft_group_id, cookie)
    logger.info(
        "Resolved draftGroupId %d → LineStar periodId %d",
        dk_draft_group_id, period_id,
    )

    # Step 2: Fetch full salary + ownership data
    data = _fetch_salaries_v5(period_id, cookie)

    # Step 3: Parse projections from SalaryContainerJson.Salaries
    players = _parse_salaries(data)

    # Step 4: Build ownership lookup from Ownership.Projected
    ownership = _parse_ownership(data)

    # Step 5: Join and build linestar_map
    linestar_map = _build_linestar_map(players, ownership)
    logger.info(
        "LineStar: %d players with projections for periodId %d",
        len(linestar_map), period_id,
    )
    return linestar_map


def fetch_live_ownership(
    dk_draft_group_id: int,
    dnn_cookie: str | None = None,
) -> dict[int, float]:
    """Fetch live pre-lock ownership % from GetFastUpdateV2.

    Returns dict: {salary_id → owned_pct}. Call 30–60 s before slate lock
    to get the most current public ownership.
    """
    cookie = dnn_cookie or os.environ.get("DNN_COOKIE", "")
    period_id = _get_period_id_for_draft_group(dk_draft_group_id, cookie)

    url = f"{_BASE}/DesktopModules/DailyFantasyApi/API/Fantasy/GetFastUpdateV2"
    params = {"periodId": period_id, "site": _SITE, "sport": _SPORT}
    resp = _get(url, params, cookie)

    # Response: {Ownership: {Projected: {contestTypeId: [{SalaryId, Owned}]}}}
    ownership_raw = resp.get("Ownership", {}).get("Projected", {})
    return _average_ownership_by_salary_id(ownership_raw)


# ── Internal helpers ───────────────────────────────────────────────────────────


def _get_period_id_for_draft_group(dk_draft_group_id: int, cookie: str) -> int:
    """Discover the LineStar periodId that maps to the given DK draftGroupId.

    Strategy:
      1. Call GetPeriodInformation (no periodId needed) to get recent periodIds.
      2. For each candidate periodId (most recent first), check if its Slates
         array contains an entry with DfsSlateId == dk_draft_group_id.
      3. Return the first match.

    GetPeriodInformation is typically public (no auth), so this step works even
    if GetSalariesV5 requires a session cookie.
    """
    # GetPeriodInformation returns a list of recent/upcoming period entries
    url = f"{_BASE}/DesktopModules/DailyFantasyApi/API/Fantasy/GetPeriodInformation"
    params = {"site": _SITE, "sport": _SPORT}

    try:
        resp = _get(url, params, cookie="")   # try without auth first
    except requests.HTTPError:
        resp = _get(url, params, cookie)      # retry with auth

    periods: list[dict] = resp if isinstance(resp, list) else resp.get("Periods", [])

    if not periods:
        raise ValueError(
            "GetPeriodInformation returned no periods — "
            "check site/sport parameters or LineStar availability."
        )

    # Periods are ordered most-recent-first; check each until we find the slate
    for period in periods[:10]:  # limit scan to 10 most recent
        pid = period.get("PeriodId") or period.get("Id")
        if not pid:
            continue
        try:
            data = _fetch_salaries_v5(pid, cookie)
        except requests.HTTPError:
            continue

        slates: list[dict] = data.get("Slates", [])
        for slate in slates:
            if slate.get("DfsSlateId") == dk_draft_group_id:
                return int(pid)

    raise ValueError(
        f"No LineStar slate found for DK draftGroupId {dk_draft_group_id}. "
        "The slate may not be available on LineStar yet, or the draftGroupId is wrong."
    )


def _fetch_salaries_v5(period_id: int, cookie: str) -> dict[str, Any]:
    """Call GetSalariesV5 and return the parsed JSON response dict."""
    url = f"{_BASE}/DesktopModules/DailyFantasyApi/API/Fantasy/GetSalariesV5"
    params = {"periodId": period_id, "site": _SITE, "sport": _SPORT}
    return _get(url, params, cookie)


def _parse_salaries(data: dict[str, Any]) -> list[dict]:
    """Extract player list from SalaryContainerJson embedded JSON string.

    Returns list of dicts with: id, name, salary, position, proj, team, is_out.
    """
    scj = data.get("SalaryContainerJson", "{}")
    if not scj:
        return []

    try:
        container = json.loads(scj)
    except json.JSONDecodeError as exc:
        logger.warning("Failed to parse SalaryContainerJson: %s", exc)
        return []

    players = []
    for p in container.get("Salaries", []):
        stat = p.get("STAT", 0)
        is_val = p.get("IS", 0)
        # Skip definite scratches (STAT=4=out or IS=1=injured)
        is_out = (stat in _OUT_STATS) or (is_val in _OUT_IS)

        proj = _safe_float(p.get("PP"))
        if proj is None:
            proj = 0.0

        players.append({
            "id":       p["Id"],          # SalaryId — foreign key to Ownership
            "name":     p.get("Name", "").strip(),
            "salary":   int(p.get("SAL", 0)),
            "position": p.get("POS", ""),
            "proj":     proj,
            "team":     p.get("PTEAM", ""),
            "is_out":   is_out,
        })
    return players


def _parse_ownership(data: dict[str, Any]) -> dict[int, float]:
    """Build {salary_id → avg_ownership_pct} from Ownership.Projected.

    Ownership.Projected = {contestTypeId: [{SalaryId, PlayerId, Owned, ...}]}
    We average across all contest types to get a blended ownership estimate.
    """
    ownership_raw = data.get("Ownership", {}).get("Projected", {})
    return _average_ownership_by_salary_id(ownership_raw)


def _average_ownership_by_salary_id(ownership_raw: dict) -> dict[int, float]:
    """Average ownership % across all contest types, keyed by SalaryId."""
    totals: dict[int, float] = {}
    counts: dict[int, int] = {}

    for _contest_type, entries in ownership_raw.items():
        if not isinstance(entries, list):
            continue
        for entry in entries:
            sid = entry.get("SalaryId")
            owned = _safe_float(entry.get("Owned"))
            if sid is not None and owned is not None:
                totals[sid] = totals.get(sid, 0.0) + owned
                counts[sid] = counts.get(sid, 0) + 1

    return {
        sid: totals[sid] / counts[sid]
        for sid in totals
    }


def _build_linestar_map(
    players: list[dict],
    ownership: dict[int, float],
) -> dict[tuple, dict]:
    """Join projections + ownership, return dk_slate-compatible lookup map.

    Key: (player_name_lower, salary_int)
    Value: {linestar_proj: float, proj_own_pct: float}

    Filters out true DNPs: proj=0 AND own%=0 AND is_out=True.
    """
    linestar_map: dict[tuple, dict] = {}

    for p in players:
        proj = p["proj"]
        own_pct = ownership.get(p["id"], 0.0)

        # Include injured/out players with proj=0 so re-fetches overwrite stale
        # DB values. The optimizer's score > 0 filter handles exclusion.
        key = (p["name"].lower(), p["salary"])
        linestar_map[key] = {
            "linestar_proj":  proj,
            "proj_own_pct":   own_pct,
            "is_out":         p["is_out"],
        }

    return linestar_map


def _get(url: str, params: dict, cookie: str) -> Any:
    """Make a GET request with optional DNN session cookie."""
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/123.0.0.0 Safari/537.36"
        ),
        "Accept": "application/json",
        "Referer": "https://www.linestarapp.com/DesktopModules/DailyFantasyApi/",
    }
    if cookie:
        headers["Cookie"] = f".DOTNETNUKE={cookie}"

    resp = requests.get(url, params=params, headers=headers, timeout=_TIMEOUT)
    resp.raise_for_status()
    return resp.json()


def _safe_float(val: Any) -> float | None:
    if val is None:
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


# ── CLI ────────────────────────────────────────────────────────────────────────


if __name__ == "__main__":
    import argparse

    logging.basicConfig(
        level=logging.INFO,
        format="%(levelname)s %(name)s: %(message)s",
    )

    parser = argparse.ArgumentParser(
        description="Fetch LineStar projections + ownership for a DK draft group."
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--draft-group-id", type=int,
        help="DK draftGroupId (from DK lobby URL or dk_api.py)",
    )
    parser.add_argument(
        "--cookie",
        default=os.environ.get("DNN_COOKIE", ""),
        help="Value of .DOTNETNUKE session cookie (default: DNN_COOKIE env var)",
    )
    args = parser.parse_args()

    result = fetch_linestar_for_draft_group(
        dk_draft_group_id=args.draft_group_id,
        dnn_cookie=args.cookie,
    )

    print(f"Fetched {len(result)} players from LineStar")
    top = sorted(result.items(), key=lambda x: x[1]["linestar_proj"], reverse=True)[:10]
    print("\nTop 10 by projection:")
    print(f"  {'Name':<30} {'Salary':>7}  {'Proj':>6}  {'Own%':>6}")
    print("  " + "-" * 54)
    for (name, salary), vals in top:
        print(
            f"  {name:<30} ${salary:>6}  "
            f"{vals['linestar_proj']:>6.2f}  "
            f"{vals['proj_own_pct']:>5.1f}%"
        )
