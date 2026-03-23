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
LEAGUE_AVG_TOTAL = 145.0  # approximate NCAA tournament game total


def compute_our_projection(
    player: dict,
    team: dict,
    opponent: dict,
    win_prob: float,
    vegas_total: float | None = None,
) -> float | None:
    """Compute our DFS projection for a player.

    Args:
        player: player_stats row — ppg, rpg, apg, min_pct, usage_rate,
                stl_pct, blk_pct, tov_pct fields required.
        team:   torvik_ratings row for player's team — adj_tempo, adj_de.
        opponent: torvik_ratings row for opponent — adj_tempo, adj_de.
        win_prob: model win probability for player's team (0-1).
        vegas_total: Vegas over/under for the game (optional). When provided,
                     blended with pace for a more accurate environment signal.

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

    # Vegas total is a direct measure of expected scoring environment (pace + efficiency).
    # Blend 40% pace-derived / 60% Vegas-derived for rebound + possession stats.
    total_factor = (vegas_total / LEAGUE_AVG_TOTAL) if vegas_total else 1.0
    combined_pace = pace_factor * 0.4 + total_factor * 0.6

    # Defensive adjustment: lower opponent AdjDE = weaker defense = easier to score
    def_factor = LEAGUE_AVG_ADJE / opp_de

    # Steeper blowout curve: activates at 70% win prob (not 75%), floored at 0.65.
    # 70% win prob → no reduction; 85% → ~13%; 95% → ~25%; 100% → floor at 65%.
    blowout_factor = max(0.65, 1.0 - max(0.0, (win_prob - 0.70) ** 1.5))
    proj_minutes = avg_minutes * blowout_factor

    # Per-minute rates × projected minutes (with pace/defense adjustments)
    proj_pts = (ppg / avg_minutes) * proj_minutes * def_factor
    proj_reb = (rpg / avg_minutes) * proj_minutes * combined_pace
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
    stl_pct: float = 0.0,
    blk_pct: float = 0.0,
) -> float:
    """Compute GPP leverage score for a player.

    Combines projected FPTS, projected ownership (lower = more leverage),
    our model's edge over Vegas, and a ceiling bonus for high-variance players.

    Args:
        our_proj:          Our projected DK FPTS.
        proj_own_pct:      Projected ownership % (0–100).
        our_win_prob:      Our model's win probability for player's team (0–1).
        vegas_win_prob:    Vegas implied win probability (0–1).
        contrarian_factor: Ownership discount exponent (0.7 = moderate contrarian).
        stl_pct:           Steal % (team-possession rate) — boom-game proxy.
        blk_pct:           Block % (team-possession rate) — boom-game proxy.

    Returns:
        Leverage score (higher = better GPP play).
    """
    own_fraction = max(0.0, min(1.0, proj_own_pct / 100))
    base = our_proj * (1 - own_fraction) ** contrarian_factor

    if our_win_prob is not None and vegas_win_prob is not None and vegas_win_prob > 0:
        edge = max(0.0, our_win_prob - vegas_win_prob)
        base *= 1 + edge * 2

    # Ceiling bonus: players who can boom via high-variance categories (steals/blocks)
    # get a multiplier. stl_pct=4, blk_pct=5 → ~1.09× vs baseline.
    ceiling_bonus = 1.0 + stl_pct * 0.02 + blk_pct * 0.015
    base *= ceiling_bonus

    return round(base, 3)
