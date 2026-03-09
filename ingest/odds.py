"""Ingest Vegas odds from The Odds API.

Uses sport key 'basketball_ncaab' to fetch spreads, moneylines,
and totals for college basketball games. Adapted from the
CollegeBasketballDFS OddsApiClient pattern.

API docs: https://the-odds-api.com/sports-odds-data/ncaa-basketball-odds.html
"""

from __future__ import annotations

import logging
import math
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import requests

from config import AppConfig
from db.database import DatabaseManager
from db.queries import upsert_vegas_odds
from ingest.team_mappings import resolve_team_id

logger = logging.getLogger(__name__)

try:
    _ET = ZoneInfo("America/New_York")
except ZoneInfoNotFoundError:
    _ET = timezone.utc


def _day_window_utc(game_date: date) -> tuple[str, str]:
    """Convert a date to a UTC time window for the Odds API."""
    start = datetime(game_date.year, game_date.month, game_date.day, tzinfo=_ET)
    end = start + timedelta(days=1)
    fmt = lambda dt: dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    return fmt(start), fmt(end)


def spread_to_probability(spread: float) -> float:
    """Convert point spread to implied win probability.

    Uses logistic model: p = 1 / (1 + exp(-spread / 6))
    A -6 spread implies ~73% win probability.
    """
    return 1 / (1 + math.exp(spread / 6))


def moneyline_to_probability(ml: int) -> float:
    """Convert American moneyline to implied probability."""
    if ml < 0:
        return abs(ml) / (abs(ml) + 100)
    elif ml > 0:
        return 100 / (ml + 100)
    return 0.5


@dataclass
class OddsApiClient:
    """Client for The Odds API with retry logic and rate limiting."""

    api_key: str
    base_url: str = "https://api.the-odds-api.com/v4"
    sport_key: str = "basketball_ncaab"
    timeout_seconds: int = 20
    max_retries: int = 5
    retry_backoff: float = 1.0
    min_interval: float = 0.35

    def __post_init__(self):
        self.session = requests.Session()
        self._last_request = 0.0

    def close(self):
        self.session.close()

    def _throttle(self):
        elapsed = time.monotonic() - self._last_request
        wait = self.min_interval - elapsed
        if wait > 0:
            time.sleep(wait)

    def get(self, path: str, params: dict) -> Any:
        """GET request with retry logic."""
        full_params = {"apiKey": self.api_key, **params}

        for attempt in range(self.max_retries + 1):
            self._throttle()
            try:
                resp = self.session.get(
                    f"{self.base_url}/{path.lstrip('/')}",
                    params=full_params,
                    timeout=self.timeout_seconds,
                )
                self._last_request = time.monotonic()
            except requests.RequestException as e:
                if attempt >= self.max_retries:
                    raise RuntimeError(f"Odds API GET {path} failed: {e}") from e
                time.sleep(self.retry_backoff * (2 ** attempt))
                continue

            if resp.status_code == 429:
                retry_after = float(resp.headers.get("Retry-After", self.retry_backoff))
                if attempt >= self.max_retries:
                    raise RuntimeError(f"Odds API rate limited on {path}")
                time.sleep(max(retry_after, self.retry_backoff * (2 ** attempt)))
                continue

            if resp.status_code >= 500:
                if attempt >= self.max_retries:
                    raise RuntimeError(f"Odds API server error {resp.status_code}")
                time.sleep(self.retry_backoff * (2 ** attempt))
                continue

            if resp.status_code >= 400:
                raise RuntimeError(f"Odds API error {resp.status_code}: {resp.text[:300]}")

            remaining = resp.headers.get("x-requests-remaining", "?")
            logger.info(f"Odds API: {remaining} requests remaining")
            return resp.json()

        raise RuntimeError(f"Odds API GET {path} failed after {self.max_retries} retries")

    def fetch_game_odds(
        self,
        game_date: date,
        regions: str = "us",
        markets: str = "h2h,spreads,totals",
    ) -> list[dict]:
        """Fetch odds for all NCAAB games on a given date."""
        commence_from, commence_to = _day_window_utc(game_date)
        payload = self.get(
            f"sports/{self.sport_key}/odds",
            {
                "regions": regions,
                "markets": markets,
                "oddsFormat": "american",
                "commenceTimeFrom": commence_from,
                "commenceTimeTo": commence_to,
            },
        )
        if not isinstance(payload, list):
            return []
        return payload


def parse_consensus_odds(event: dict) -> dict | None:
    """Extract consensus spread, moneyline, total from a single event.

    Averages across all bookmakers to get a consensus line.
    """
    home_team = event.get("home_team", "")
    away_team = event.get("away_team", "")
    bookmakers = event.get("bookmakers", [])

    if not bookmakers:
        return None

    spreads, home_mls, away_mls, totals = [], [], [], []

    for bk in bookmakers:
        for market in bk.get("markets", []):
            key = market.get("key")
            outcomes = market.get("outcomes", [])

            if key == "spreads":
                for o in outcomes:
                    if o.get("name") == home_team:
                        spreads.append(o.get("point", 0))

            elif key == "h2h":
                for o in outcomes:
                    price = o.get("price", 0)
                    if o.get("name") == home_team:
                        home_mls.append(price)
                    elif o.get("name") == away_team:
                        away_mls.append(price)

            elif key == "totals":
                for o in outcomes:
                    if o.get("name") == "Over":
                        totals.append(o.get("point", 0))

    if not spreads and not home_mls:
        return None

    import statistics
    spread = statistics.median(spreads) if spreads else None
    home_ml = int(statistics.median(home_mls)) if home_mls else None
    away_ml = int(statistics.median(away_mls)) if away_mls else None
    total = statistics.median(totals) if totals else None

    implied_prob = None
    if spread is not None:
        implied_prob = spread_to_probability(spread)
    elif home_ml is not None:
        implied_prob = moneyline_to_probability(home_ml)

    return {
        "home_team": home_team,
        "away_team": away_team,
        "spread": spread,
        "home_ml": home_ml,
        "away_ml": away_ml,
        "total": total,
        "implied_home_prob": implied_prob,
    }


def ingest_odds_for_date(
    db: DatabaseManager, client: OddsApiClient, game_date: date
) -> int:
    """Fetch and store odds for all NCAAB games on a date.

    Matches Odds API team names to our team_id via the mapping matrix,
    then finds the corresponding game_id in our games table.
    """
    events = client.fetch_game_odds(game_date)
    if not events:
        print(f"  No odds events for {game_date}")
        return 0

    stored = 0
    for event in events:
        odds = parse_consensus_odds(event)
        if not odds:
            continue

        # Resolve team IDs
        home_id = resolve_team_id(db, odds["home_team"], "odds")
        away_id = resolve_team_id(db, odds["away_team"], "odds")

        if not home_id or not away_id:
            logger.debug(
                f"Could not resolve: {odds['home_team']} vs {odds['away_team']}"
            )
            continue

        # Find matching game in our database
        date_str = game_date.isoformat()
        game = db.execute_one(
            """
            SELECT game_id FROM games
            WHERE game_date = %s
              AND ((home_team_id = %s AND away_team_id = %s)
                OR (home_team_id = %s AND away_team_id = %s))
            LIMIT 1
            """,
            (date_str, home_id, away_id, away_id, home_id),
        )

        if not game:
            logger.debug(f"No matching game for {odds['home_team']} vs {odds['away_team']} on {date_str}")
            continue

        upsert_vegas_odds(
            db,
            game_id=game["game_id"],
            spread=odds["spread"] or 0,
            total=odds["total"] or 0,
            home_ml=odds["home_ml"] or 0,
            away_ml=odds["away_ml"] or 0,
            implied_home_prob=odds["implied_home_prob"] or 0.5,
        )
        stored += 1

    print(f"  {game_date}: {stored}/{len(events)} games with odds stored")
    return stored


if __name__ == "__main__":
    from config import load_config

    config = load_config()
    if not config.database_url:
        print("ERROR: DATABASE_URL not set")
        exit(1)
    if not config.odds_api.api_key:
        print("ERROR: ODDS_API_KEY not set")
        exit(1)

    db = DatabaseManager(config.database_url)
    client = OddsApiClient(
        api_key=config.odds_api.api_key,
        sport_key=config.odds_api.sport_key,
    )

    # Fetch odds for today's games
    today = date.today()
    print(f"Fetching odds for {today}...")
    count = ingest_odds_for_date(db, client, today)
    print(f"Done: {count} games with odds")
    client.close()
