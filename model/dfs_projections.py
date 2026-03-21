"""DFS projection model for NCAA tournament players.

Computes independent DraftKings fantasy point projections using:
  - Per-minute stat rates from player_stats (ppg, rpg, apg, stl_pct, blk_pct, tov_pct)
  - Pace context from torvik_ratings (adj_tempo for team + opponent)
  - Defensive difficulty from opponent torvik_ratings (adj_de)
  - Blowout risk from bracket_matchups.model_prob_a (win probability)

This is entirely independent of LineStar projections. The LineStar projection
is shown alongside as a second opinion — the delta between the two is the key
signal for identifying mispriced players.

DraftKings CBB scoring:
  PTS × 1.0 | REB × 1.25 | AST × 1.5 | STL × 2.0 | BLK × 2.0 | TOV × -0.5
"""

from __future__ import annotations

LEAGUE_AVG_TEMPO = 68.5
LEAGUE_AVG_ADJE = 100.0


def compute_our_projection(
    player: dict,
    team: dict,
    opponent: dict,
    win_prob: float,
) -> float | None:
    """Compute our DFS projection for a player.

    Args:
        player: player_stats row — ppg, rpg, apg, min_pct, usage_rate,
                stl_pct, blk_pct, tov_pct fields required.
        team:   torvik_ratings row for player's team — adj_tempo, adj_de.
        opponent: torvik_ratings row for opponent — adj_tempo, adj_de.
        win_prob: model win probability for player's team (0-1).

    Returns:
        Projected DK fantasy points, or None if insufficient data.
    """
    min_pct = player.get("min_pct") or 0
    if min_pct < 5:
        return None  # skip bench players with negligible minutes

    avg_minutes = min_pct * 40 / 100
    if avg_minutes <= 0:
        return None

    ppg = player.get("ppg") or 0.0
    rpg = player.get("rpg") or 0.0
    apg = player.get("apg") or 0.0
    stl_pct = player.get("stl_pct") or 0.0
    blk_pct = player.get("blk_pct") or 0.0
    tov_pct = player.get("tov_pct") or 0.0
    usage_rate = player.get("usage_rate") or 20.0

    team_tempo = team.get("adj_tempo") or LEAGUE_AVG_TEMPO
    opp_tempo = opponent.get("adj_tempo") or LEAGUE_AVG_TEMPO
    opp_de = opponent.get("adj_de") or LEAGUE_AVG_ADJE

    # Pace adjustment: faster games = more possessions = more stats opportunities
    game_tempo = (team_tempo + opp_tempo) / 2
    pace_factor = game_tempo / LEAGUE_AVG_TEMPO

    # Defensive adjustment: lower opponent AdjDE = weaker defense = easier to score
    def_factor = LEAGUE_AVG_ADJE / opp_de

    # Blowout risk: winning big → starters pulled early
    # Scales from 0% reduction at 75% win prob to 12.5% reduction at 100% win prob
    blowout_factor = 1.0 - max(0.0, (win_prob - 0.75) * 0.5)
    proj_minutes = avg_minutes * blowout_factor

    # Per-minute rates × projected minutes (with pace/defense adjustments)
    proj_pts = (ppg / avg_minutes) * proj_minutes * def_factor
    proj_reb = (rpg / avg_minutes) * proj_minutes * pace_factor
    proj_ast = (apg / avg_minutes) * proj_minutes * def_factor

    # Rate-based steals and blocks (fraction of team possessions)
    team_poss = game_tempo * 2
    proj_stl = (stl_pct / 100) * team_poss * (proj_minutes / 40)
    proj_blk = (blk_pct / 100) * team_poss * (proj_minutes / 40)

    # Turnover rate relative to usage
    player_poss = team_poss * (usage_rate / 100)
    proj_tov = (tov_pct / 100) * player_poss * (proj_minutes / 40)

    fpts = (
        proj_pts * 1.0
        + proj_reb * 1.25
        + proj_ast * 1.5
        + proj_stl * 2.0
        + proj_blk * 2.0
        - proj_tov * 0.5
    )
    return round(fpts, 2)


def compute_leverage(
    our_proj: float,
    proj_own_pct: float,
    our_win_prob: float | None = None,
    vegas_win_prob: float | None = None,
    contrarian_factor: float = 0.7,
) -> float:
    """Compute GPP leverage score for a player.

    Combines projected FPTS, projected ownership (lower = more leverage),
    and our model's edge over Vegas (mispriced upside). Players on teams
    where our model sees more value than Vegas calibrated for will be
    systematically underowned relative to their true expected production.

    Args:
        our_proj:        Our projected DK FPTS.
        proj_own_pct:    Projected ownership % (0–100).
        our_win_prob:    Our model's win probability for player's team (0–1).
        vegas_win_prob:  Vegas implied win probability (0–1).
        contrarian_factor: Ownership discount exponent (0.7 = moderate contrarian).

    Returns:
        Leverage score (higher = better GPP play).
    """
    own_fraction = max(0.0, min(1.0, proj_own_pct / 100))
    base = our_proj * (1 - own_fraction) ** contrarian_factor

    if our_win_prob is not None and vegas_win_prob is not None and vegas_win_prob > 0:
        edge = max(0.0, our_win_prob - vegas_win_prob)
        base *= 1 + edge * 2

    return round(base, 3)
