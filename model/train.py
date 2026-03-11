"""Train XGBoost model for game outcome prediction.

Uses matchup features (efficiency differentials, four factors, etc.)
to predict the probability that team A wins. Trained on historical
game data with cross-validation for hyperparameter tuning.

The model outputs a probability (0-1) representing team A's chance
of winning. For tournament simulation, this is used directly as the
win probability for each matchup.
"""

from __future__ import annotations

import logging
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import brier_score_loss, log_loss, accuracy_score
from sklearn.model_selection import cross_val_score
from xgboost import XGBClassifier

from config import AppConfig, MODELS_DIR
from db.database import DatabaseManager
from features.matchup_builder import (
    FEATURE_COLS,
    build_training_dataset,
    build_multi_season_dataset,
)

logger = logging.getLogger(__name__)


def train_model(
    df: pd.DataFrame,
    feature_cols: list[str] = FEATURE_COLS,
    model_path: Path | None = None,
) -> tuple[XGBClassifier, dict[str, float]]:
    """Train an XGBoost classifier on matchup features.

    Args:
        df: Training DataFrame with feature columns and 'label'.
        feature_cols: List of feature column names to use.
        model_path: Optional path to save the trained model.

    Returns:
        (trained_model, metrics_dict)
    """
    # Filter to features that exist in the data
    available_cols = [c for c in feature_cols if c in df.columns]
    X = df[available_cols].values
    y = df["label"].values

    print(f"Training on {len(X)} samples, {len(available_cols)} features")

    # XGBoost tuned for 30-feature enhanced model (v2)
    # Conservative config: shallower trees + stronger regularization
    # prevents overfitting to player-derived features while
    # capturing their signal for tournament prediction
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

    # Cross-validation
    cv_scores = cross_val_score(model, X, y, cv=5, scoring="neg_log_loss")
    cv_logloss = -cv_scores.mean()
    print(f"5-fold CV log-loss: {cv_logloss:.4f} (+/- {cv_scores.std():.4f})")

    cv_acc = cross_val_score(model, X, y, cv=5, scoring="accuracy")
    print(f"5-fold CV accuracy: {cv_acc.mean():.4f} (+/- {cv_acc.std():.4f})")

    # Train on full dataset
    model.fit(X, y)

    # Evaluate on training data (for calibration reference)
    y_prob = model.predict_proba(X)[:, 1]
    y_pred = model.predict(X)

    metrics = {
        "cv_logloss": cv_logloss,
        "cv_accuracy": cv_acc.mean(),
        "train_accuracy": accuracy_score(y, y_pred),
        "train_logloss": log_loss(y, y_prob),
        "train_brier": brier_score_loss(y, y_prob),
        "n_samples": len(X),
        "n_features": len(available_cols),
    }

    # Feature importance
    importances = dict(zip(available_cols, model.feature_importances_))
    sorted_imp = sorted(importances.items(), key=lambda x: -x[1])
    print("\nFeature importance (top 10):")
    for feat, imp in sorted_imp[:10]:
        print(f"  {feat:20s} {imp:.4f}")

    # Save model
    if model_path is None:
        model_path = MODELS_DIR / "xgb_game_predictor.joblib"
    joblib.dump({"model": model, "features": available_cols, "metrics": metrics}, model_path)
    print(f"\nModel saved to {model_path}")

    return model, metrics


def load_model(model_path: Path | None = None) -> tuple[XGBClassifier, list[str]]:
    """Load a trained model and its feature list."""
    if model_path is None:
        model_path = MODELS_DIR / "xgb_game_predictor.joblib"
    data = joblib.load(model_path)
    return data["model"], data["features"]


def predict_matchup(
    model: XGBClassifier,
    features: list[str],
    matchup_features: dict[str, float],
) -> float:
    """Predict win probability for team A given matchup features.

    Returns probability that team A wins (0-1).
    """
    X = np.array([[matchup_features.get(f, 0.0) for f in features]])
    return float(model.predict_proba(X)[0, 1])


if __name__ == "__main__":
    from config import load_config

    config = load_config()
    db = DatabaseManager(config.database_url)

    # Train on all available seasons (2022-current) for maximum generalization
    all_seasons = config.model.training_seasons + [config.model.current_season]
    print(f"Building multi-season dataset ({all_seasons[0]}-{all_seasons[-1]})...")
    df = build_multi_season_dataset(db, all_seasons)

    if df.empty:
        print("No training data available.")
        exit(1)

    print(f"\nDataset: {len(df):,} games, home win rate: {df['label'].mean():.3f}")
    print()

    model, metrics = train_model(df)

    print("\nMetrics:")
    for k, v in metrics.items():
        if isinstance(v, float):
            print(f"  {k}: {v:.4f}")
        else:
            print(f"  {k}: {v}")
