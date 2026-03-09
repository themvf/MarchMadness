# March Madness Strategy

## Stack
- **Python backend**: Data ingestion, feature engineering, XGBoost model, Monte Carlo simulation
- **Database**: Neon PostgreSQL (shared between Python and Next.js)
- **Frontend**: Next.js on Vercel (web/ subdirectory)
- **Deployment**: GitHub → Vercel (auto-deploy)

## Key Rules
- All changes must be pushed to Git
- Test before publishing
- Only use API data (no mock data)
- Team IDs: Every team has a unique `team_id` in the `teams` table with mapping columns for each data source (torvik_name, ncaa_name, odds_api_name)

## Data Sources
- **Torvik ratings**: barttorvik.com/trank.php (scrape or CSV fallback)
- **Game data**: NCAA API (ncaa-api.henrygd.me)
- **Vegas odds**: The Odds API (sport key: basketball_ncaab)
- **Public picks**: ESPN Tournament Challenge (after bracket release)

## Database
- Neon PostgreSQL via psycopg2 (Python) and @neondatabase/serverless + Drizzle (Next.js)
- Tables: teams, torvik_ratings, games, vegas_odds, tournament_bracket, public_picks, simulation_results

## Running
- Python ingestion: `python -m ingest.torvik`, `python -m ingest.games`, etc.
- Model training: `python -m model.train`
- Simulation: `python -m simulation.tournament`
- Tests: `pytest tests/`
- Next.js dev: `cd web && npm run dev`
