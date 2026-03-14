# Automated Tournament Progression

## Context
The bracket matchups system is fully built (table, Python CLI, web page). But every step of the tournament lifecycle currently requires manual CLI commands — recording 32+ individual results per round, advancing rounds, refreshing data, fetching odds. The user said: **"I don't want to do anything manually. Everything should be automatic."**

The automation must: detect completed games from Barttorvik data → match to bracket matchups → record winners → detect round completion → refresh data → generate next-round matchups → fetch odds for upcoming games. All without human intervention.

**Key constraint:** Python operations (XGBoost model, Barttorvik scraping) can't run on Vercel. Data writes directly to Neon PostgreSQL, so no git push is needed for the frontend to reflect changes.

## Architecture: GitHub Actions Cron + Python Orchestrator

**Why GitHub Actions?** Runs on schedule, no local machine dependency, free tier has 2,000 min/month (we'd use ~100 min total for the tournament), has secrets management, produces visible run logs. The user's machine doesn't need to be on.

**Rejected alternatives:**
- Windows Task Scheduler — requires machine to be always on; defeats "automatic"
- APScheduler — needs a persistent process; no recovery if it crashes

## Files to Create

| File | Purpose |
|------|---------|
| `automation/__init__.py` | Package init (empty) |
| `automation/tournament_orchestrator.py` | Core orchestration engine (~200 lines) |
| `.github/workflows/tournament.yml` | GitHub Actions cron schedule |

## Files to Modify

| File | Change |
|------|--------|
| `db/queries.py` | Add `find_game_by_teams_and_date_range()` query |
| `.gitignore` | Allow committing `data/models/*.joblib` (338KB model) |

## Existing Code Reused (no changes)

- `ingest/bracket_matchups.py` — `refresh_data()`, `generate_matchups()`, `update_all()`, `fetch_tournament_odds()`, `ROUNDS`
- `db/queries.py` — `get_bracket_matchups()`, `update_matchup_result()`, `upsert_bracket_matchup()`
- `ingest/torvik.py` — `ingest_season()` for refreshing game data
- `ingest/odds.py` — `OddsApiClient` for fetching Vegas lines
- `config.py` — `load_config()`, `AppConfig` for env vars

## Step 1: New Query — `db/queries.py`

Add `find_game_by_teams_and_date_range()`:

```python
def find_game_by_teams_and_date_range(
    db: DatabaseManager, season: int,
    team_a_id: int, team_b_id: int,
    date_from: date, date_to: date,
) -> dict | None:
    """Find a completed game between two teams within a date range.
    Matches regardless of home/away orientation (tournament = neutral site).
    """
    return db.execute_one("""
        SELECT game_id, home_team_id, away_team_id,
               home_score, away_score, game_date
        FROM games
        WHERE season = %s
          AND game_date BETWEEN %s AND %s
          AND home_score IS NOT NULL AND away_score IS NOT NULL
          AND (
            (home_team_id = %s AND away_team_id = %s)
            OR (home_team_id = %s AND away_team_id = %s)
          )
        LIMIT 1
    """, (season, date_from, date_to, team_a_id, team_b_id, team_b_id, team_a_id))
```

## Step 2: Orchestrator — `automation/tournament_orchestrator.py`

### 2a. Tournament schedule config

```python
TOURNAMENT_SCHEDULE = {
    "R64": {"dates": [date(2026, 3, 19), date(2026, 3, 20)], "next": "R32"},
    "R32": {"dates": [date(2026, 3, 21), date(2026, 3, 22)], "next": "S16"},
    "S16": {"dates": [date(2026, 3, 26), date(2026, 3, 27)], "next": "E8"},
    "E8":  {"dates": [date(2026, 3, 28), date(2026, 3, 29)], "next": "F4"},
    "F4":  {"dates": [date(2026, 4, 4)],                      "next": "NCG"},
    "NCG": {"dates": [date(2026, 4, 6)],                      "next": None},
}
```

### 2b. Core functions

**`get_current_round(db, season) -> str | None`** — Walks rounds in order. Returns the round that still has unresolved matchups, or `None` if tournament is complete. If a round has no matchups yet, returns the previous round (it needs advancing).

**`detect_and_record_results(db, season, round_name) -> int`** — The key automation piece:
1. Get unresolved matchups for the round (`winner_id IS NULL`)
2. For each, query `find_game_by_teams_and_date_range()` using the round's date range
3. If game found: determine winner from scores, orient `score_a`/`score_b` to match `team_a`/`team_b`, call `update_matchup_result()`
4. Return count of newly recorded results

Score orientation logic (critical — bracket uses seed order, games use home/away):
```python
if game["home_team_id"] == matchup["team_a_id"]:
    score_a, score_b = game["home_score"], game["away_score"]
else:
    score_a, score_b = game["away_score"], game["home_score"]
winner_id = matchup["team_a_id"] if score_a > score_b else matchup["team_b_id"]
```

**`is_round_complete(db, season, round_name) -> bool`** — All matchups have `winner_id` set.

**`advance_round(db, season, completed_round) -> int`** — Calls `refresh_data(db, season)` then `generate_matchups(db, season, next_round)`.

**`should_fetch_odds(round_name) -> bool`** — Returns True if today is the day before or day of any game date in the round's schedule.

**`fetch_odds_for_round(db, season, round_name, config) -> int`** — Fetches odds for future/today game dates in the round.

### 2c. Main orchestrator — `run_orchestrator(db, season, config) -> dict`

Single entry point called by GitHub Actions. Returns a JSON status report.

```
1. Refresh game data from Barttorvik (ingest_season) — picks up new results
2. Determine current round
3. Detect and record results for current round
4. If round complete AND next round matchups don't exist:
   → advance_round() (refresh data + generate matchups)
   → update current_round pointer
5. If upcoming matchups need odds AND timing is right:
   → fetch_odds_for_round()
6. Recompute model predictions (update_all) — keeps predictions fresh
7. Return report with all actions taken
```

### 2d. CLI entry point

```python
if __name__ == "__main__":
    config = load_config()
    db = DatabaseManager(config.database_url)
    report = run_orchestrator(db, config.model.current_season, config)
    print(json.dumps(report, indent=2))
    sys.exit(1 if report["errors"] else 0)
```

## Step 3: GitHub Actions — `.github/workflows/tournament.yml`

```yaml
name: Tournament Progression
on:
  schedule:
    - cron: '0 12,14,16,18,20,22,0,2,4 * * *'  # Every 2h, 8AM-midnight ET
  workflow_dispatch: {}  # Manual trigger
jobs:
  progress:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.13'
          cache: 'pip'
      - run: pip install -r requirements.txt
      - run: python -m automation.tournament_orchestrator
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          ODDS_API_KEY: ${{ secrets.ODDS_API_KEY }}
```

**Schedule rationale:** Every 2 hours during active hours. Games take ~2 hours; Barttorvik updates within 30-60 min of completion. At ~2 min/run, 12 runs/day x 20 tournament days = 480 min total, well within the free 2,000 min/month.

## Step 4: Model file + .gitignore

Remove `data/models/*.joblib` from `.gitignore`. Commit `xgb_game_predictor.joblib` (338KB). GitHub Actions needs the trained model to compute predictions.

## Step 5: One-time GitHub Secrets Setup

Set in GitHub -> Settings -> Secrets:
- `DATABASE_URL` — Neon PostgreSQL connection string
- `ODDS_API_KEY` — The Odds API key

## Edge Cases & Resilience

| Scenario | Handling |
|----------|----------|
| Partial results (half the games played) | Records what's available; `is_round_complete` returns False; next run catches the rest |
| Barttorvik data delay | Game not in DB yet -> `find_game_by_teams_and_date_range` returns None -> skipped -> caught next run |
| Re-run after results already recorded | Only queries `winner_id IS NULL` matchups -> already-recorded matchups are skipped |
| Duplicate round advancement | Checks if next-round matchups already exist before generating |
| Tournament over | `get_current_round` returns None -> logs "complete" -> exits cleanly |
| Neon connection timeout | Action fails -> GitHub retries next cron window (2 hours) |
| Odds API credit conservation | Only fetches on game day +/- 1; skips matchups that already have odds or results |

## Verification

1. `python -m automation.tournament_orchestrator` locally -> prints JSON report, exits 0
2. Push to main -> check GitHub Actions tab -> "Tournament Progression" workflow appears
3. Click "Run workflow" (manual dispatch) -> verify it installs deps, runs orchestrator, exits 0
4. After Selection Sunday: `--generate R64` once -> then the cron handles everything else
5. Monitor GitHub Actions run logs during R64 games -> verify results auto-detected
6. After R64 completes -> verify R32 matchups auto-generated with fresh predictions
