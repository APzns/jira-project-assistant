"""config.py — Centralized application configuration using pydantic-settings.

All environment variables are validated on startup. Type errors and missing
required values raise immediately instead of surfacing as obscure runtime
failures.
"""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


_ENV_PATH = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    """Application-wide settings, loaded from environment variables and .env."""

    model_config = SettingsConfigDict(
        env_file=str(_ENV_PATH) if _ENV_PATH.exists() else None,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- Database ---
    database_url: str = ""

    # --- Authentication ---
    basic_auth_user: str = "demo"
    basic_auth_pass: str = ""  # Required in production; empty default fails auth safely.

    # --- AI / LLM ---
    gemini_api_key: str = ""

    # --- Runtime ---
    log_level: str = "INFO"
    testing: bool = False
    mock_llm: bool = False


@lru_cache
def get_settings() -> Settings:
    """Return a cached Settings instance (parsed once, reused everywhere)."""
    return Settings()
