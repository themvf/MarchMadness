"""Google News RSS team news tracker for tournament teams.

Fetches recent news articles for each tournament team, scores them by
injury/impact keywords, and stores high-signal articles in the team_news table.
"""

from __future__ import annotations

import sys
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import quote_plus

import requests

from config import load_config
from db.database import DatabaseManager
from db.queries import insert_team_news

RSS_BASE = "https://news.google.com/rss/search?q={query}&hl=en-US&gl=US&ceid=US:en"

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)

# Teams whose canonical name is ambiguous outside basketball context
AMBIGUOUS_NAMES = {
    "Ohio", "Troy", "Rice", "Army", "Navy", "Portland", "Denver",
    "Buffalo", "Maine", "Delaware", "Vermont", "Idaho", "Montana",
    "Nevada", "Hawaii", "Pacific", "Liberty", "Marshall", "Miami (FL)",
    "Miami (OH)", "Georgia", "Houston", "Long Island",
}

# ── Keyword tiers ──────────────────────────────────────────

TIER_1 = [  # 30 pts — definitive status changes
    "ruled out", "will not play", "out for", "out indefinitely",
    "season ending", "torn acl", "suspended", "dismissed",
]
TIER_2 = [  # 20 pts — likely impact
    "questionable", "doubtful", "game-time decision", "day-to-day",
    "limited", "did not practice", "will miss", "dnp",
]
TIER_3 = [  # 10 pts — injury mentions
    "injury", "injured", "ankle", "knee", "concussion", "hamstring",
    "shoulder", "fracture", "sprain", "strain", "sidelined",
]
TIER_4 = [  # 5 pts — soft signals
    "probable", "expected to play", "return", "cleared",
    "practicing", "back at practice",
]


def score_article(title: str) -> tuple[int, list[str]]:
    """Score an article title by injury/impact keywords.

    Returns (score 0-100, list of matched keywords).
    """
    lower = title.lower()
    score = 0
    matched = []

    for kw in TIER_1:
        if kw in lower:
            score += 30
            matched.append(kw)
    for kw in TIER_2:
        if kw in lower:
            score += 20
            matched.append(kw)
    for kw in TIER_3:
        if kw in lower:
            score += 10
            matched.append(kw)
    for kw in TIER_4:
        if kw in lower:
            score += 5
            matched.append(kw)

    return min(score, 100), matched


def build_search_query(canonical_name: str, odds_api_name: str) -> str:
    """Build a Google News RSS search query for a team."""
    base = odds_api_name or f"{canonical_name} basketball"

    if canonical_name in AMBIGUOUS_NAMES:
        base = f"NCAA {base}"

    keywords = "injury OR out OR suspended OR questionable"
    return f'"{base}" basketball ({keywords}) when:2d'


def fetch_rss_feed(
    query: str, session: requests.Session, timeout: int = 10, max_retries: int = 3,
) -> list[dict]:
    """Fetch and parse a Google News RSS feed."""
    url = RSS_BASE.format(query=quote_plus(query))

    for attempt in range(max_retries):
        try:
            resp = session.get(url, timeout=timeout)
            if resp.status_code == 429:
                wait = 2 ** attempt
                print(f"    Rate limited, waiting {wait}s...")
                time.sleep(wait)
                continue
            resp.raise_for_status()
            return parse_rss_items(resp.text)
        except requests.RequestException as e:
            if attempt == max_retries - 1:
                print(f"    Failed after {max_retries} attempts: {e}")
                return []
            time.sleep(1)

    return []


def parse_rss_items(xml_text: str) -> list[dict]:
    """Parse RSS XML into list of article dicts."""
    items = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return items

    for item in root.iter("item"):
        title_el = item.find("title")
        link_el = item.find("link")
        pub_date_el = item.find("pubDate")
        source_el = item.find("source")

        if title_el is None or link_el is None:
            continue

        published_at = None
        if pub_date_el is not None and pub_date_el.text:
            try:
                published_at = parsedate_to_datetime(pub_date_el.text)
                if published_at.tzinfo is None:
                    published_at = published_at.replace(tzinfo=timezone.utc)
            except (ValueError, TypeError):
                pass

        items.append({
            "title": title_el.text or "",
            "url": link_el.text or "",
            "source": source_el.text if source_el is not None else "",
            "published_at": published_at,
        })

    return items


def ingest_all_tournament_news(
    db: DatabaseManager, season: int = 2026, dry_run: bool = False,
) -> dict:
    """Fetch news for all tournament teams."""
    bracket = db.execute("""
        SELECT tb.team_id, t.name, t.odds_api_name, t.short_name, t.conference
        FROM tournament_bracket tb
        JOIN teams t ON t.team_id = tb.team_id
        WHERE tb.season = %s
    """, (season,))

    if not bracket:
        print("No tournament bracket found — nothing to fetch")
        return {"teams": 0, "articles": 0, "high_impact": 0}

    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})

    total_articles = 0
    total_high_impact = 0

    for i, team in enumerate(bracket):
        query = build_search_query(team["name"], team["odds_api_name"])

        if dry_run:
            print(f"  [{i+1}/{len(bracket)}] {team['name']}: {query}")
            continue

        articles = fetch_rss_feed(query, session)
        stored = 0

        for article in articles:
            score, keywords = score_article(article["title"])
            if score == 0:
                continue

            pub_at = (
                article["published_at"].isoformat()
                if article["published_at"]
                else None
            )

            inserted = insert_team_news(
                db, team_id=team["team_id"],
                title=article["title"], url=article["url"],
                source=article["source"], published_at=pub_at,
                impact_score=score, matched_keywords=",".join(keywords),
            )
            if inserted:
                stored += 1
                if score >= 30:
                    total_high_impact += 1

        if stored > 0:
            print(f"  {team['name']}: {stored} articles stored")
        total_articles += stored

        # Polite delay between teams
        if i < len(bracket) - 1:
            time.sleep(0.5)

    session.close()

    print(f"\nFetched news for {len(bracket)} teams: "
          f"{total_articles} articles stored, {total_high_impact} high-impact")

    return {
        "teams": len(bracket),
        "articles": total_articles,
        "high_impact": total_high_impact,
    }


def cleanup_old_news(db: DatabaseManager, days: int = 7) -> int:
    """Remove articles older than N days."""
    result = db.execute(
        f"DELETE FROM team_news WHERE fetched_at < NOW() - INTERVAL '{days} days' RETURNING id"
    )
    return len(result)


# ── CLI ────────────────────────────────────────────────────

if __name__ == "__main__":
    config = load_config()
    db = DatabaseManager(config.database_url)
    season = config.model.current_season
    args = sys.argv[1:]

    if not args:
        print(f"Fetching news for all tournament teams (season {season})...")
        result = ingest_all_tournament_news(db, season)

    elif args[0] == "--dry-run":
        print(f"DRY RUN — showing queries for season {season}:")
        ingest_all_tournament_news(db, season, dry_run=True)

    elif args[0] == "--cleanup":
        days = int(args[1]) if len(args) > 1 else 7
        removed = cleanup_old_news(db, days)
        print(f"Removed {removed} articles older than {days} days")

    else:
        print("Usage:")
        print("  python -m ingest.news              # fetch all tournament teams")
        print("  python -m ingest.news --dry-run     # show queries without DB writes")
        print("  python -m ingest.news --cleanup 7   # remove articles older than 7 days")
        sys.exit(1)
