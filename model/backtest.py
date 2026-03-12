"""Leave-One-Season-Out (LOSO) backtesting for tournament prediction.

For each historical season (2021-2025):
  1. Train the model on ALL other seasons (no data leakage)
  2. Predict tournament-window games from the held-out season
  3. Evaluate accuracy, log-loss, and Brier score

This is the gold standard for evaluating overfitting: if the model
has memorized patterns instead of learning generalizable signals,
tournament accuracy will drop sharply vs. CV accuracy.
"""

from __future__ import annotations

import logging
from collections import defaultdict

import numpy as np
import pandas as pd
from sklearn.metrics import accuracy_score, brier_score_loss, log_loss
from xgboost import XGBClassifier

from config import load_config
from db.database import DatabaseManager
from features.matchup_builder import (
    FEATURE_COLS,
    TOURNAMENT_FEATURE_COLS,
    build_multi_season_dataset,
    build_training_dataset,
)

logger = logging.getLogger(__name__)

# NCAA Tournament start dates (First Four) per season
# All tournament games are neutral-site
TOURNEY_START = {
    2021: "2021-03-18",  # Indianapolis bubble
    2022: "2022-03-15",
    2023: "2023-03-14",
    2024: "2024-03-19",
    2025: "2025-03-18",
}


def get_tournament_games(
    db: DatabaseManager, df: pd.DataFrame, season: int
) -> pd.DataFrame:
    """Filter a season's dataset to tournament-window games.

    Uses neutral-site games after the First Four start date.
    Queries actual game_date from the DB for reliable filtering.
    Includes NCAA tournament + some NIT games (~85 vs 67 NCAA).
    """
    start_date = TOURNEY_START.get(season)
    if start_date is None:
        return pd.DataFrame()

    # Query game IDs for neutral-site games in the tournament window
    tourney_game_ids = db.execute(
        """
        SELECT game_id FROM games
        WHERE season = %s
          AND is_neutral_site = TRUE
          AND game_date >= %s
        """,
        (season, start_date),
    )
    valid_ids = {r["game_id"] for r in tourney_game_ids}

    mask = df["game_id"].isin(valid_ids)
    return df[mask].copy()


def run_loso_backtest(
    db: DatabaseManager,
    seasons: list[int],
    feature_cols: list[str] = FEATURE_COLS,
    use_sample_weights: bool = False,
    label: str = "Base Model",
) -> dict:
    """Run Leave-One-Season-Out backtesting.

    For each season in `seasons`, train on all OTHER seasons and
    test on that season's tournament-window games.

    Args:
        use_sample_weights: If True, weight neutral-site games 2x in training.
        label: Display label for the model being tested.
    """
    print("=" * 60)
    print(f"LOSO BACKTESTING: {label}")
    print("=" * 60)

    # Pre-build all season datasets
    print("\nBuilding datasets for all seasons...")
    season_dfs = {}
    for season in seasons:
        df = build_training_dataset(db, season)
        season_dfs[season] = df
        print(f"  {season}: {len(df)} total games")

    results = {}
    all_predictions = []

    for holdout in seasons:
        print(f"\n{'-' * 60}")
        print(f"HOLDOUT SEASON: {holdout}")
        print(f"{'-' * 60}")

        # Training set: all seasons except holdout
        train_frames = [season_dfs[s] for s in seasons if s != holdout]
        train_df = pd.concat(train_frames, ignore_index=True)

        # Test set: tournament-window games from holdout season
        test_df = get_tournament_games(db, season_dfs[holdout], holdout)

        if test_df.empty:
            print(f"  No tournament games found for {holdout}, skipping")
            continue

        # Filter features
        available_cols = [c for c in feature_cols if c in train_df.columns]
        X_train = train_df[available_cols].values
        y_train = train_df["label"].values
        X_test = test_df[available_cols].values
        y_test = test_df["label"].values

        print(f"  Train: {len(X_train):,} games from {len(train_frames)} seasons")
        print(f"  Test:  {len(X_test)} tournament-window games")

        # Train model (same hyperparameters as production)
        model = XGBClassifier(
            n_estimators=300,
            max_depth=3,
            learning_rate=0.03,
            min_child_weight=10,
            subsample=0.8,
            colsample_bytree=0.75,
            gamma=0.15,
            reg_alpha=0.2,
            reg_lambda=1.5,
            objective="binary:logistic",
            eval_metric="logloss",
            random_state=42,
            n_jobs=-1,
        )
        # Optionally weight neutral-site games more heavily
        if use_sample_weights and "is_neutral" in train_df.columns:
            weights = np.ones(len(y_train))
            weights[train_df["is_neutral"].values == 1] = 2.0
            model.fit(X_train, y_train, sample_weight=weights)
        else:
            model.fit(X_train, y_train)

        # Predict
        y_prob = model.predict_proba(X_test)[:, 1]
        y_pred = model.predict(X_test)

        # Metrics
        acc = accuracy_score(y_test, y_pred)
        ll = log_loss(y_test, y_prob)
        brier = brier_score_loss(y_test, y_prob)

        results[holdout] = {
            "n_test": len(y_test),
            "accuracy": acc,
            "log_loss": ll,
            "brier": brier,
            "n_train": len(X_train),
        }

        print(f"\n  Results for {holdout}:")
        print(f"    Accuracy:  {acc:.4f} ({sum(y_pred == y_test)}/{len(y_test)})")
        print(f"    Log-loss:  {ll:.4f}")
        print(f"    Brier:     {brier:.4f}")

        # Also test on ALL games in holdout season (not just tournament)
        X_all = season_dfs[holdout][available_cols].values
        y_all = season_dfs[holdout]["label"].values
        y_prob_all = model.predict_proba(X_all)[:, 1]
        y_pred_all = model.predict(X_all)
        acc_all = accuracy_score(y_all, y_pred_all)
        ll_all = log_loss(y_all, y_prob_all)
        print(f"    Full-season accuracy: {acc_all:.4f} ({sum(y_pred_all == y_all)}/{len(y_all)})")
        print(f"    Full-season log-loss: {ll_all:.4f}")

        results[holdout]["full_accuracy"] = acc_all
        results[holdout]["full_logloss"] = ll_all

        # Store individual predictions for calibration analysis
        for i in range(len(y_test)):
            all_predictions.append({
                "season": holdout,
                "y_true": y_test[i],
                "y_prob": y_prob[i],
                "y_pred": y_pred[i],
            })

    # Summary
    print(f"\n{'=' * 60}")
    print("AGGREGATE RESULTS")
    print(f"{'=' * 60}")

    if results:
        accs = [r["accuracy"] for r in results.values()]
        lls = [r["log_loss"] for r in results.values()]
        briers = [r["brier"] for r in results.values()]
        full_accs = [r["full_accuracy"] for r in results.values()]
        total_test = sum(r["n_test"] for r in results.values())

        print(f"\nTournament-window games ({total_test} total):")
        print(f"  Mean accuracy:  {np.mean(accs):.4f} (range: {min(accs):.4f} - {max(accs):.4f})")
        print(f"  Mean log-loss:  {np.mean(lls):.4f} (range: {min(lls):.4f} - {max(lls):.4f})")
        print(f"  Mean Brier:     {np.mean(briers):.4f}")

        print(f"\nFull-season holdout accuracy:")
        print(f"  Mean: {np.mean(full_accs):.4f} (range: {min(full_accs):.4f} - {max(full_accs):.4f})")

        # Calibration check on pooled predictions
        preds_df = pd.DataFrame(all_predictions)
        if len(preds_df) > 0:
            pooled_acc = accuracy_score(preds_df["y_true"], preds_df["y_pred"])
            pooled_ll = log_loss(preds_df["y_true"], preds_df["y_prob"])
            pooled_brier = brier_score_loss(preds_df["y_true"], preds_df["y_prob"])
            print(f"\nPooled tournament metrics:")
            print(f"  Accuracy:  {pooled_acc:.4f}")
            print(f"  Log-loss:  {pooled_ll:.4f}")
            print(f"  Brier:     {pooled_brier:.4f}")

            # Calibration by probability bucket
            print(f"\nCalibration (predicted vs actual win rate):")
            preds_df["bucket"] = pd.cut(preds_df["y_prob"], bins=[0, 0.3, 0.4, 0.5, 0.6, 0.7, 1.0])
            cal = preds_df.groupby("bucket", observed=True).agg(
                n=("y_true", "count"),
                mean_prob=("y_prob", "mean"),
                actual_rate=("y_true", "mean"),
            )
            for _, row in cal.iterrows():
                diff = abs(row["actual_rate"] - row["mean_prob"])
                marker = "!!" if diff > 0.10 else "ok"
                print(f"  Predicted {row['mean_prob']:.2f} -> Actual {row['actual_rate']:.2f}  (n={int(row['n']):3d})  [{marker}]")

    return results


if __name__ == "__main__":
    config = load_config()
    db = DatabaseManager(config.database_url)

    seasons = [2021, 2022, 2023, 2024, 2025]

    # Run LOSO with base model (30 features, no weighting)
    base_results = run_loso_backtest(
        db, seasons,
        feature_cols=FEATURE_COLS,
        use_sample_weights=False,
        label="Base Model (30 features)",
    )

    print("\n\n")

    # Run LOSO with tournament model (33 features + neutral weighting)
    tourney_results = run_loso_backtest(
        db, seasons,
        feature_cols=TOURNAMENT_FEATURE_COLS,
        use_sample_weights=True,
        label="Tournament Model (33 features + neutral weighting)",
    )

    # Side-by-side comparison
    print("\n\n")
    print("=" * 60)
    print("HEAD-TO-HEAD COMPARISON")
    print("=" * 60)
    print(f"\n{'Season':<8} {'Base Acc':>10} {'Tourney Acc':>12} {'Base LL':>10} {'Tourney LL':>12}")
    print("-" * 54)
    for s in seasons:
        if s in base_results and s in tourney_results:
            ba = base_results[s]["accuracy"]
            ta = tourney_results[s]["accuracy"]
            bl = base_results[s]["log_loss"]
            tl = tourney_results[s]["log_loss"]
            better_a = "<" if ta > ba else ">"
            better_l = "<" if tl < bl else ">"
            print(f"{s:<8} {ba:>9.4f} {better_a} {ta:>10.4f}   {bl:>9.4f} {better_l} {tl:>10.4f}")

    # Aggregates
    b_accs = [base_results[s]["accuracy"] for s in seasons if s in base_results]
    t_accs = [tourney_results[s]["accuracy"] for s in seasons if s in tourney_results]
    b_lls = [base_results[s]["log_loss"] for s in seasons if s in base_results]
    t_lls = [tourney_results[s]["log_loss"] for s in seasons if s in tourney_results]
    print("-" * 54)
    print(f"{'Mean':<8} {np.mean(b_accs):>9.4f}   {np.mean(t_accs):>10.4f}   {np.mean(b_lls):>9.4f}   {np.mean(t_lls):>10.4f}")
