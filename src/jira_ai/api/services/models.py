"""models.py — Centralized Gemini model configuration, rate-limit-aware smart routing, and shared client.

Replaces the 3 separate CANDIDATE_MODELS lists and _get_client() singletons that were
scattered across llm.py, assessment/prompts.py, and routes/skills.py.

Distributes requests across all available models to maximize the combined daily
budget (~130 RPD across 5 models on the free tier) instead of hammering a single
model until it 429s.
"""

from __future__ import annotations

import logging
import os
import time
from collections import defaultdict

from google import genai

logger = logging.getLogger("jira_ai")

# ---------------------------------------------------------------------------
# Available models — ordered by preference for each use case
# ---------------------------------------------------------------------------

# All available Gemini models (from API dashboard)
ALL_MODELS = [
    {"name": "gemini-3.5-flash",      "rpm": 5,  "tpm": 250_000, "rpd": 20, "tier": "standard"},
    {"name": "gemini-3.7-flash",      "rpm": 5,  "tpm": 250_000, "rpd": 20, "tier": "standard"},
    {"name": "gemini-3.8-flash",      "rpm": 5,  "tpm": 250_000, "rpd": 20, "tier": "standard"},
    {"name": "gemini-3.6-flash",      "rpm": 5,  "tpm": 250_000, "rpd": 20, "tier": "standard"},
    {"name": "gemini-3.5-flash-lite", "rpm": 15, "tpm": 250_000, "rpd": 50, "tier": "lite"},
]

# For chat / tool-calling (prefer capable models)
CHAT_MODELS = [m["name"] for m in ALL_MODELS if m["tier"] == "standard"] + \
              [m["name"] for m in ALL_MODELS if m["tier"] == "lite"]

# For assessments & skills (structured JSON — lite is sufficient and has higher RPM/RPD)
LITE_FIRST_MODELS = [m["name"] for m in ALL_MODELS if m["tier"] == "lite"] + \
                    [m["name"] for m in ALL_MODELS if m["tier"] == "standard"]

# Retry delay between model attempts (200ms instead of 500ms)
RETRY_DELAY_S = 0.2

# Model rate-limit metadata lookup
_MODEL_LIMITS = {m["name"]: m for m in ALL_MODELS}

# ---------------------------------------------------------------------------
# Usage tracking — lightweight in-memory per-model budget awareness
# ---------------------------------------------------------------------------

_model_usage: dict[str, dict] = defaultdict(lambda: {
    "rpm_window": [],    # timestamps of requests in the last 60 seconds
    "rpd_count": 0,      # requests today
    "rpd_date": "",      # YYYY-MM-DD for daily reset
    "last_error": 0.0,   # timestamp of last error (for backoff)
})


def pick_model(prefer_lite: bool = False) -> str:
    """Pick the best available model based on current rate-limit budget.
    
    Args:
        prefer_lite: If True, prefer lite models first (for structured JSON tasks).
                     If False, prefer standard models first (for chat/tool-calling).
    
    Returns:
        Model name string suitable for client.models.generate_content(model=...).
    """
    candidates = LITE_FIRST_MODELS if prefer_lite else CHAT_MODELS
    today = time.strftime("%Y-%m-%d")
    now = time.time()

    for model_name in candidates:
        usage = _model_usage[model_name]
        limits = _MODEL_LIMITS.get(model_name)
        if not limits:
            continue

        # Reset daily counter on new day
        if usage["rpd_date"] != today:
            usage["rpd_count"] = 0
            usage["rpd_date"] = today

        # Skip if daily budget exhausted (leave 1 request as buffer)
        if usage["rpd_count"] >= limits["rpd"] - 1:
            continue

        # Prune minute window and check RPM
        usage["rpm_window"] = [t for t in usage["rpm_window"] if now - t < 60]
        if len(usage["rpm_window"]) >= limits["rpm"] - 1:
            continue

        # Skip if this model had a recent error (30s backoff)
        if usage["last_error"] and (now - usage["last_error"]) < 30:
            continue

        return model_name

    # All models budget-exhausted — return the least-used one today as best-effort
    logger.warning("All Gemini models near rate limits; using least-loaded model.")
    if not candidates:
        # Safety guard: if candidates list is somehow empty (e.g. bad model config), use the
        # first model in ALL_MODELS as an absolute last resort rather than crashing with ValueError.
        logger.error("pick_model: candidates list is empty — falling back to first model in ALL_MODELS.")
        return ALL_MODELS[0]["name"]
    best = min(candidates, key=lambda m: _model_usage[m]["rpd_count"])
    return best


def record_usage(model_name: str) -> None:
    """Record that a successful request was made to this model."""
    usage = _model_usage[model_name]
    usage["rpm_window"].append(time.time())
    today = time.strftime("%Y-%m-%d")
    if usage["rpd_date"] != today:
        usage["rpd_count"] = 0
        usage["rpd_date"] = today
    usage["rpd_count"] += 1


def record_error(model_name: str) -> None:
    """Record that a request to this model failed (for temporary backoff)."""
    _model_usage[model_name]["last_error"] = time.time()


def get_usage_summary() -> dict:
    """Return a snapshot of per-model usage for debugging / monitoring."""
    today = time.strftime("%Y-%m-%d")
    now = time.time()
    summary = {}
    for m in ALL_MODELS:
        usage = _model_usage[m["name"]]
        rpm_active = len([t for t in usage.get("rpm_window", []) if now - t < 60])
        rpd = usage["rpd_count"] if usage.get("rpd_date") == today else 0
        summary[m["name"]] = {
            "rpm_used": rpm_active,
            "rpm_limit": m["rpm"],
            "rpd_used": rpd,
            "rpd_limit": m["rpd"],
        }
    return summary


# ---------------------------------------------------------------------------
# Shared Gemini client singleton
# ---------------------------------------------------------------------------

_client = None


def get_client() -> genai.Client | None:
    """Return a shared Gemini client singleton, or None if API key is missing."""
    global _client
    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        return None
    if _client is None:
        try:
            timeout_ms = int(os.environ.get("GEMINI_TIMEOUT_MS", "90000"))
            _client = genai.Client(api_key=api_key, http_options={"timeout": timeout_ms})
        except Exception as exc:
            logger.warning("Failed to initialize genai.Client: %s", exc)
            return None
    return _client
