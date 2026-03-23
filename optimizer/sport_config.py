"""Sport configuration for DraftKings DFS lineup optimizer.

Defines roster structure, salary cap, position requirements, and default
stacking parameters for each supported sport. The optimizer is parameterized
by SportConfig so the same ILP core works across NCAA CBB, NBA, and MLB
without code changes — only the config differs.

Supported sports:
  ncaa_cbb    : NCAA College Basketball  (G/G/G/F/F/F/UTIL/UTIL, 8p, $50k)
  nba         : NBA Basketball           (PG/SG/SF/PF/C/G/F/UTIL, 8p, $50k)
  mlb_classic : MLB Classic              (P/P/C/1B/2B/3B/SS/OF/OF/OF, 10p, $50k)
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class SportConfig:
    """Roster and scoring rules for a DraftKings sport/game type.

    Attributes:
        name:               Short identifier used in CLI and DB strategy labels.
        salary_cap:         DraftKings salary cap for this sport/format.
        roster_size:        Total number of players in a lineup.
        slots:              Ordered list of lineup slot names (matches DK upload CSV column order).
        min_position:       {position_letter: minimum_count} — ILP hard minimums per position group.
        slot_eligibility:   {slot_name: [eligible_position_strings]} — a player fills a slot if
                            any of the strings appears in their eligible_positions field.
        stack_type:         "team"  — primary stack is 3+ from the same team (CBB/MLB).
                            "game"  — primary stack spans both teams in the same game (NBA).
        default_stack_min_win_prob: Lower bound of win-prob window for eligible stack teams.
        default_stack_max_win_prob: Upper bound (blowout protection).
        upset_stack_min_win_prob:   Lower bound for upset/underdog stack strategy.
        upset_stack_max_win_prob:   Upper bound for upset strategy.
    """

    name: str
    salary_cap: int
    roster_size: int
    slots: list[str]
    min_position: dict[str, int]
    slot_eligibility: dict[str, list[str]]
    stack_type: str = "team"
    default_stack_min_win_prob: float = 0.25
    default_stack_max_win_prob: float = 0.82
    upset_stack_min_win_prob: float = 0.12
    upset_stack_max_win_prob: float = 0.35


# ── NCAA College Basketball ──────────────────────────────────

NCAA_CBB = SportConfig(
    name="ncaa_cbb",
    salary_cap=50_000,
    roster_size=8,
    slots=["G", "G2", "G3", "F", "F2", "F3", "UTIL", "UTIL2"],
    min_position={"G": 3, "F": 3},
    slot_eligibility={
        "G":     ["G"],
        "G2":    ["G"],
        "G3":    ["G"],
        "F":     ["F"],
        "F2":    ["F"],
        "F3":    ["F"],
        "UTIL":  ["G", "F"],
        "UTIL2": ["G", "F"],
    },
    stack_type="team",
    default_stack_min_win_prob=0.25,
    default_stack_max_win_prob=0.82,
    upset_stack_min_win_prob=0.12,
    upset_stack_max_win_prob=0.38,
)


# ── NBA ─────────────────────────────────────────────────────
# NBA uses game stacks — correlation comes from BOTH teams in a high-total
# game (both offenses are fast/efficient). The "win_prob" window becomes
# a "game total" filter in future: high-total games = better stacks.

NBA = SportConfig(
    name="nba",
    salary_cap=50_000,
    roster_size=8,
    slots=["PG", "SG", "SF", "PF", "C", "G", "F", "UTIL"],
    min_position={"PG": 1, "SG": 1, "SF": 1, "PF": 1, "C": 1},
    slot_eligibility={
        "PG":   ["PG"],
        "SG":   ["SG"],
        "SF":   ["SF"],
        "PF":   ["PF"],
        "C":    ["C"],
        "G":    ["PG", "SG"],
        "F":    ["SF", "PF"],
        "UTIL": ["PG", "SG", "SF", "PF", "C"],
    },
    stack_type="game",       # Stack from same game (both teams)
    default_stack_min_win_prob=0.30,
    default_stack_max_win_prob=0.72,
    upset_stack_min_win_prob=0.15,
    upset_stack_max_win_prob=0.38,
)


# ── MLB Classic ──────────────────────────────────────────────
# MLB batting-order stacks (4-5 consecutive batters) are the dominant
# GPP strategy. The win-prob window maps to "use the favored team's lineup."
# Upset stack = roster the underdog's offense + the favored SP.

MLB_CLASSIC = SportConfig(
    name="mlb_classic",
    salary_cap=50_000,
    roster_size=10,
    slots=["P", "P2", "C", "1B", "2B", "3B", "SS", "OF", "OF2", "OF3"],
    min_position={"P": 2, "C": 1, "1B": 1, "2B": 1, "3B": 1, "SS": 1, "OF": 3},
    slot_eligibility={
        "P":   ["SP", "RP"],
        "P2":  ["SP", "RP"],
        "C":   ["C"],
        "1B":  ["1B"],
        "2B":  ["2B"],
        "3B":  ["3B"],
        "SS":  ["SS"],
        "OF":  ["OF"],
        "OF2": ["OF"],
        "OF3": ["OF"],
    },
    stack_type="team",
    default_stack_min_win_prob=0.35,
    default_stack_max_win_prob=0.72,
    upset_stack_min_win_prob=0.20,
    upset_stack_max_win_prob=0.42,
)


# ── Registry ─────────────────────────────────────────────────

SPORT_CONFIGS: dict[str, SportConfig] = {
    "ncaa_cbb": NCAA_CBB,
    "nba": NBA,
    "mlb_classic": MLB_CLASSIC,
}
