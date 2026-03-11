"""Team-level features derived from player stats.

Aggregates individual player advanced stats into team-level metrics
that capture roster composition, depth, experience, and vulnerability
patterns not visible in team-level efficiency ratings alone.

Features computed per team:
  - experience_idx:         Minutes-weighted class score (Sr=4, Jr=3, So=2, Fr=1)
  - star_concentration:     Top 2 scorers' PPG share of rotation total (%)
  - depth_gap:              Starter ORtg minus bench ORtg
  - ft_reliability:         Usage-weighted FT% across rotation
  - three_pt_rate:          3FGA as % of total FGA
  - tov_discipline:         Minutes-weighted avg TOV% (lower = better)
  - scoring_balance:        Number of 10+ PPG scorers in rotation
  - guard_quality:          Best PG's (AST% - TOV%) * ORtg / 100 composite
  - freshman_minutes_pct:   Freshman minutes as % of rotation total
  - rebound_concentration:  Top rebounder's RPG share of rotation total (%)
"""

from __future__ import annotations

import logging
from collections import defaultdict
from typing import Any

from db.database import DatabaseManager

logger = logging.getLogger(__name__)

# Neutral defaults when player data is unavailable
NEUTRAL_DEFAULTS = {
    "experience_idx": 2.5,
    "star_concentration": 35.0,
    "depth_gap": 0.0,
    "ft_reliability": 0.72,
    "three_pt_rate": 40.0,
    "tov_discipline": 15.0,
    "scoring_balance": 3.0,
    "guard_quality": 0.0,
    "freshman_minutes_pct": 20.0,
    "rebound_concentration": 25.0,
}

PLAYER_FEATURE_NAMES = list(NEUTRAL_DEFAULTS.keys())

CLASS_WEIGHT = {"Sr": 4, "Jr": 3, "So": 2, "Fr": 1}


def _safe_avg(values: list[float]) -> float | None:
    """Average of non-None values, or None if empty."""
    clean = [v for v in values if v is not None]
    return sum(clean) / len(clean) if clean else None


def _compute_single_team(players: list[dict]) -> dict[str, float]:
    """Compute player-derived features for one team's roster."""
    # Sort by minutes played (descending)
    rotation = sorted(players, key=lambda p: -(p["min_pct"] or 0))

    # Key players: > 20% of available minutes
    key_players = [p for p in rotation if (p["min_pct"] or 0) > 20]
    starters = [p for p in rotation if (p["min_pct"] or 0) > 50]
    bench = [p for p in rotation if 20 < (p["min_pct"] or 0) <= 50]

    if not key_players:
        return dict(NEUTRAL_DEFAULTS)

    # ── Experience Index ─────────────────────────────────────
    total_min = sum(p["min_pct"] or 0 for p in key_players)
    if total_min > 0:
        experience_idx = sum(
            (p["min_pct"] or 0) * CLASS_WEIGHT.get(p["class"] or "", 2)
            for p in key_players
        ) / total_min
    else:
        experience_idx = 2.5

    # ── Star Concentration ───────────────────────────────────
    by_ppg = sorted(key_players, key=lambda p: -(p["ppg"] or 0))
    top2_ppg = sum(p["ppg"] or 0 for p in by_ppg[:2])
    total_ppg = sum(p["ppg"] or 0 for p in by_ppg[:8])
    star_concentration = (top2_ppg / max(total_ppg, 0.1)) * 100

    # ── Depth Gap ────────────────────────────────────────────
    starter_ortg = _safe_avg([p["ortg"] for p in starters])
    bench_ortg = _safe_avg([p["ortg"] for p in bench])
    if starter_ortg is not None and bench_ortg is not None:
        depth_gap = starter_ortg - bench_ortg
    else:
        depth_gap = 0.0

    # ── Free Throw Reliability (usage-weighted) ──────────────
    ft_eligible = [p for p in key_players if (p["fta"] or 0) > 20 and p["ft_pct"] is not None]
    if ft_eligible:
        total_usg = sum(p["usage_rate"] or 1 for p in ft_eligible)
        ft_reliability = sum(
            (p["ft_pct"] or 0) * (p["usage_rate"] or 1)
            for p in ft_eligible
        ) / max(total_usg, 0.1)
    else:
        ft_reliability = 0.72

    # ── Three-Point Rate ─────────────────────────────────────
    total_3fga = sum(p["threefga"] or 0 for p in key_players)
    total_2fga = sum(p["twofga"] or 0 for p in key_players)
    total_fga = total_3fga + total_2fga
    three_pt_rate = (total_3fga / max(total_fga, 1)) * 100

    # ── Turnover Discipline (minutes-weighted) ───────────────
    tov_players = [p for p in key_players if p["tov_pct"] is not None]
    if tov_players and total_min > 0:
        tov_discipline = sum(
            (p["min_pct"] or 0) * (p["tov_pct"] or 15)
            for p in tov_players
        ) / sum(p["min_pct"] or 0 for p in tov_players)
    else:
        tov_discipline = 15.0

    # ── Scoring Balance ──────────────────────────────────────
    scoring_balance = len([p for p in key_players if (p["ppg"] or 0) >= 10])

    # ── Guard Quality ────────────────────────────────────────
    guards = [
        p for p in key_players
        if p["position"] and any(
            tag in p["position"]
            for tag in ("PG", "Combo G", "Scoring PG")
        )
    ]
    if guards:
        # Composite: (AST% - TOV%) scaled by offensive efficiency
        best = max(
            guards,
            key=lambda p: (
                ((p["ast_pct"] or 0) - (p["tov_pct"] or 15))
                * (p["ortg"] or 100) / 100
            ),
        )
        guard_quality = (
            ((best["ast_pct"] or 0) - (best["tov_pct"] or 15))
            * (best["ortg"] or 100) / 100
        )
    else:
        guard_quality = 0.0

    # ── Freshman Minutes % ───────────────────────────────────
    fr_min = sum(p["min_pct"] or 0 for p in key_players if p["class"] == "Fr")
    freshman_minutes_pct = (fr_min / max(total_min, 0.1)) * 100

    # ── Rebound Concentration ────────────────────────────────
    total_rpg = sum(p["rpg"] or 0 for p in key_players)
    top_rpg = max((p["rpg"] or 0) for p in key_players) if key_players else 0
    rebound_concentration = (top_rpg / max(total_rpg, 0.1)) * 100

    return {
        "experience_idx": round(experience_idx, 3),
        "star_concentration": round(star_concentration, 1),
        "depth_gap": round(depth_gap, 1),
        "ft_reliability": round(ft_reliability, 4),
        "three_pt_rate": round(three_pt_rate, 1),
        "tov_discipline": round(tov_discipline, 1),
        "scoring_balance": scoring_balance,
        "guard_quality": round(guard_quality, 2),
        "freshman_minutes_pct": round(freshman_minutes_pct, 1),
        "rebound_concentration": round(rebound_concentration, 1),
    }


def compute_all_team_player_features(
    db: DatabaseManager, season: int
) -> dict[int, dict[str, float]]:
    """Compute player-derived features for ALL teams in a season.

    Returns:
        Dict of team_id -> {feature_name: value}
    """
    rows = db.execute(
        """
        SELECT team_id, name, class, height, position, games,
               min_pct, ortg, usage_rate, efg, ts_pct,
               orb_pct, drb_pct, ast_pct, tov_pct,
               ftm, fta, ft_pct, twofgm, twofga, twofg_pct,
               threefgm, threefga, threefg_pct,
               blk_pct, stl_pct, ftr, obpm, drtg,
               ppg, rpg, apg
        FROM player_stats
        WHERE season = %s
        """,
        (season,),
    )

    # Group by team
    team_players: dict[int, list[dict]] = defaultdict(list)
    for row in rows:
        team_players[row["team_id"]].append(dict(row))

    # Compute features per team
    result = {}
    for team_id, players in team_players.items():
        result[team_id] = _compute_single_team(players)

    logger.info(
        f"Computed player features for {len(result)} teams (season {season})"
    )
    return result


if __name__ == "__main__":
    from config import load_config

    config = load_config()
    db = DatabaseManager(config.database_url)

    features = compute_all_team_player_features(db, config.model.current_season)

    # Show top 20 teams by Torvik rank with their player features
    ratings = db.execute(
        """
        SELECT tr.team_id, t.name, tr.rank
        FROM torvik_ratings tr
        JOIN teams t ON t.team_id = tr.team_id
        WHERE tr.season = %s
        ORDER BY tr.rank
        LIMIT 20
        """,
        (config.model.current_season,),
    )

    print(f"\nPlayer-Derived Features for Top 20 Teams ({config.model.current_season})")
    print(
        f"{'Team':20s} | {'Exp':>4} | {'Star%':>5} | {'Depth':>5} | {'FT%':>5} "
        f"| {'3Rate':>5} | {'TOV%':>5} | {'Bal':>3} | {'Guard':>5} | {'Fr%':>4} | {'Reb%':>4}"
    )
    print("-" * 100)

    for r in ratings:
        f = features.get(r["team_id"], NEUTRAL_DEFAULTS)
        print(
            f"{r['name']:20s} | {f['experience_idx']:4.1f} | {f['star_concentration']:5.1f} "
            f"| {f['depth_gap']:+5.1f} | {f['ft_reliability']:5.3f} | {f['three_pt_rate']:5.1f} "
            f"| {f['tov_discipline']:5.1f} | {f['scoring_balance']:3.0f} | {f['guard_quality']:+5.1f} "
            f"| {f['freshman_minutes_pct']:4.1f} | {f['rebound_concentration']:4.1f}"
        )
