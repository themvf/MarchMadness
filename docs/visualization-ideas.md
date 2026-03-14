# Data Visualization Ideas

## Available Data
- 8 database tables: teams, torvik_ratings (22 cols), games, vegas_odds, tournament_bracket, simulation_results, player_stats (41 cols), team_profiles (11 derived metrics), bracket_matchups, public_picks
- Recharts v3.8.0 installed but unused across all 11 pages
- All current pages are plain HTML tables

## 1. "War Room" — Efficiency Scatter Plot [BUILD FIRST]
Interactive scatter: AdjOE (x) vs AdjDE (y, inverted). Every team = dot with logo.
- Quadrants: elite both / offense-only / defense-only / bad both
- Dot size = Barthag, color = conference
- Tournament teams get highlighted borders
- Click for full team profile
- Data: `getTeamRatings()` — already exists

## 2. "Chalk vs Chaos" — Public Picks vs Model [BUILD SECOND]
Public pick % (ESPN) overlaid against model advancement %.
- Divergence bar chart: bars go left (public overvalues) or right (model overvalues)
- Shows where masses are wrong — contrarian bracket value
- Data: `public_picks` table (collected but never displayed) + `simulation_results`

## 3. "Bracket X-Ray" — Sankey/Flow Diagram
Probability mass flowing through bracket rounds.
- 64 teams enter left, band width = advancement probability
- Narrows/widens through R64 -> R32 -> S16 -> E8 -> F4 -> NCG -> Champion
- Data: `simulation_results.advancement_pct`

## 4. "Team DNA" — Radar Charts
Spider charts comparing team profiles across 6-8 dimensions.
- AdjOE, AdjDE, Tempo, Experience, Star Concentration, Depth, 3PT Rate, FT Reliability
- Select 2-3 teams to overlay
- Data: `torvik_ratings` + `team_profiles`

## 5. "Path of Destruction" — Tournament Path Difficulty
Horizontal segmented bar per team showing expected opponent strength per round.
- Uses `simulation_results.path_difficulty` (stored but never displayed)
- Shows which 1-seeds have a cakewalk vs gauntlet
