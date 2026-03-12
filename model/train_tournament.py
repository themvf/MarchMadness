"""Train tournament-tuned XGBoost model.

This is a separate model optimized for neutral-site tournament prediction.
Key differences from the base model:

1. Location-aware features: away_win_pct, neutral_win_pct, home_dependency
   - Teams that perform well away from home are better tournament picks
   - Home-dependent teams are penalized (tournament = all neutral)

2. Sample weighting: neutral-site games weighted 2x, away games 1.5x
   - Training distribution shifts toward what tournaments look like
   - Home games are down-weighted (less relevant for March)

3. Saved separately so both models can predict the 2026 tournament
   for A/B comparison after results are known.
"""

from __future__ import annotations

import logging
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import accuracy_score, brier_score_loss, log_loss
from sklearn.model_selection import cross_val_score
from xgboost import XGBClassifier

from config import AppConfig, MODELS_DIR
from db.database import DatabaseManager
from features.matchup_builder import (
    TOURNAMENT_FEATURE_COLS,
    build_multi_season_dataset,
)

logger = logging.getLogger(__name__)


def compute_sample_weights(df: pd.DataFrame) -> np.ndarray:
    """Assign higher weights to neutral-site and away games.

    Tournament games are all neutral-site, so we want the model
    to focus on patterns that predict well in that context.

    Weights:
      - Neutral-site games: 2.0x (match tournament conditions)
      - Away perspective:   1.5x (no home advantage, closer to neutral)
      - Home games:         1.0x (still useful but least relevant)

    Since we don't track home/away in the training features directly,
    we use is_neutral as the primary signal.
    """
    weights = np.ones(len(df))
    if "is_neutral" in df.columns:
        weights[df["is_neutral"] == 1] = 2.0
    return weights


def train_tournament_model(
    df: pd.DataFrame,
    feature_cols: list[str] = TOURNAMENT_FEATURE_COLS,
    model_path: Path | None = None,
) -> tuple[XGBClassifier, dict[str, float]]:
    """Train a tournament-tuned XGBoost classifier.

    Uses location-aware features and sample weights that emphasize
    neutral-site game patterns.
    """
    available_cols = [c for c in feature_cols if c in df.columns]
    X = df[available_cols].values
    y = df["label"].values
    weights = compute_sample_weights(df)

    print(f"Training tournament model on {len(X)} samples, {len(available_cols)} features")
    print(f"  Neutral-site games (2x weight): {int((weights == 2.0).sum())}")
    print(f"  Regular games (1x weight): {int((weights == 1.0).sum())}")

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

    # Cross-validation (without sample weights for fair comparison)
    cv_scores = cross_val_score(model, X, y, cv=5, scoring="neg_log_loss")
    cv_logloss = -cv_scores.mean()
    print(f"5-fold CV log-loss: {cv_logloss:.4f} (+/- {cv_scores.std():.4f})")

    cv_acc = cross_val_score(model, X, y, cv=5, scoring="accuracy")
    print(f"5-fold CV accuracy: {cv_acc.mean():.4f} (+/- {cv_acc.std():.4f})")

    # Train on full dataset WITH sample weights
    model.fit(X, y, sample_weight=weights)

    # Evaluate on training data
    y_prob = model.predict_proba(X)[:, 1]
    y_pred = model.predict(X)

    # Evaluate specifically on neutral-site games
    neutral_mask = df["is_neutral"] == 1 if "is_neutral" in df.columns else np.zeros(len(df), dtype=bool)
    if neutral_mask.sum() > 0:
        y_neut = y[neutral_mask]
        y_prob_neut = y_prob[neutral_mask]
        y_pred_neut = y_pred[neutral_mask]
        neut_acc = accuracy_score(y_neut, y_pred_neut)
        neut_ll = log_loss(y_neut, y_prob_neut)
        print(f"\nNeutral-site train accuracy: {neut_acc:.4f} ({neutral_mask.sum()} games)")
        print(f"Neutral-site train log-loss: {neut_ll:.4f}")
    else:
        neut_acc = None
        neut_ll = None

    metrics = {
        "cv_logloss": cv_logloss,
        "cv_accuracy": cv_acc.mean(),
        "train_accuracy": accuracy_score(y, y_pred),
        "train_logloss": log_loss(y, y_prob),
        "train_brier": brier_score_loss(y, y_prob),
        "neutral_accuracy": neut_acc,
        "neutral_logloss": neut_ll,
        "n_samples": len(X),
        "n_features": len(available_cols),
        "model_type": "tournament",
    }

    # Feature importance
    importances = dict(zip(available_cols, model.feature_importances_))
    sorted_imp = sorted(importances.items(), key=lambda x: -x[1])
    print("\nFeature importance (top 15):")
    for feat, imp in sorted_imp[:15]:
        print(f"  {feat:30s} {imp:.4f}")

    # Save model
    if model_path is None:
        model_path = MODELS_DIR / "xgb_tournament_predictor.joblib"
    joblib.dump({
        "model": model,
        "features": available_cols,
        "metrics": metrics,
        "model_type": "tournament",
    }, model_path)
    print(f"\nTournament model saved to {model_path}")

    return model, metrics


if __name__ == "__main__":
    from config import load_config

    config = load_config()
    db = DatabaseManager(config.database_url)

    # Train on all available seasons
    all_seasons = config.model.training_seasons + [config.model.current_season]
    print(f"Building multi-season dataset ({all_seasons[0]}-{all_seasons[-1]})...")
    df = build_multi_season_dataset(db, all_seasons)

    if df.empty:
        print("No training data available.")
        exit(1)

    print(f"\nDataset: {len(df):,} games, home win rate: {df['label'].mean():.3f}")
    print()

    model, metrics = train_tournament_model(df)

    print("\nMetrics:")
    for k, v in metrics.items():
        if isinstance(v, float):
            print(f"  {k}: {v:.4f}")
        elif v is not None:
            print(f"  {k}: {v}")
