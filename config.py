"""Configuration for March Madness Strategy."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional
import os

from dotenv import load_dotenv

load_dotenv()

PROJECT_DIR = Path(__file__).resolve().parent
DATA_DIR = PROJECT_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)
MODELS_DIR = DATA_DIR / "models"
MODELS_DIR.mkdir(exist_ok=True)


@dataclass
class NcaaApiConfig:
    base_url: str = "https://ncaa-api.henrygd.me"
    timeout_seconds: int = 20
    max_retries: int = 3
    retry_backoff_seconds: float = 0.75


@dataclass
class OddsApiConfig:
    api_key: str = ""
    base_url: str = "https://api.the-odds-api.com/v4"
    sport_key: str = "basketball_ncaab"
    timeout_seconds: int = 20
    max_retries: int = 5
    retry_backoff_seconds: float = 1.0
    min_interval_seconds: float = 0.35

    @classmethod
    def from_env(cls) -> OddsApiConfig:
        return cls(api_key=os.getenv("ODDS_API_KEY", ""))


@dataclass
class TorkvikConfig:
    base_url: str = "https://barttorvik.com"
    csv_fallback_path: Path = field(
        default_factory=lambda: DATA_DIR / "torvik_ratings.csv"
    )


@dataclass
class ModelConfig:
    model_type: str = "xgboost"
    n_simulations: int = 10_000
    training_seasons: list = field(
        default_factory=lambda: [2021, 2022, 2023, 2024, 2025]
    )
    current_season: int = 2026


@dataclass
class AppConfig:
    ncaa_api: NcaaApiConfig = field(default_factory=NcaaApiConfig)
    odds_api: OddsApiConfig = field(default_factory=OddsApiConfig)
    torvik: TorkvikConfig = field(default_factory=TorkvikConfig)
    model: ModelConfig = field(default_factory=ModelConfig)
    database_url: Optional[str] = None

    @classmethod
    def from_env(cls) -> AppConfig:
        return cls(
            odds_api=OddsApiConfig.from_env(),
            database_url=os.getenv("DATABASE_URL"),
        )


def load_config() -> AppConfig:
    """Load configuration from environment variables."""
    return AppConfig.from_env()
