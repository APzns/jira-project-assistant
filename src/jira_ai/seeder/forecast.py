"""
forecast.py — Monte Carlo completion forecast.

Each simulated sprint's velocity is drawn from a normal distribution centered
on the team's historical average completed-points, with an assumed spread
(coefficient of variation) representing normal sprint-to-sprint variation.
This produces a meaningful P50/P80/P95 range even when actual history is thin
(here, only two closed sprints). Seeded for reproducibility.

NOTE: the spread is an ASSUMPTION (VELOCITY_CV) layered on top of the real
average, because two data points cannot establish true variability. The centre
of the forecast comes from real data; the width comes partly from this
assumption.

Two entry points:
  - monte_carlo_from(remaining, pool)  : data-source agnostic core.
  - monte_carlo(data=...)              : synthetic-dataset wrapper.
Both real and synthetic modes call the same simulation engine.
"""

import random
from datetime import date, timedelta

from src.jira_ai.seeder.synthetic_metrics import (
    build_synthetic_dataset, remaining_work_points, velocity_pool,
)

SIMULATIONS = 10_000
SPRINT_DAYS = 14
MAX_SPRINTS = 200          # safety cap against a degenerate low velocity
VELOCITY_CV = 0.20         # assumed sprint-to-sprint variation (20%)
VELOCITY_FLOOR = 0.25      # a sprint never delivers less than 25% of the mean


def monte_carlo_from(remaining: float, pool: list, sims: int = SIMULATIONS,
                     seed: int = 42) -> dict:
    """Core Monte-Carlo forecast from a remaining-points figure and a velocity
    sample (completed points per closed sprint). Data-source agnostic, so both
    real (DB) and synthetic paths feed the identical simulation engine."""
    pool = [v for v in (pool or []) if v > 0]

    if not pool:
        return {"error": "No historical velocity (no closed sprints with completed points)."}
    if remaining <= 0:
        return {"remaining_points": 0, "note": "No remaining work."}

    mean_v = sum(pool) / len(pool)
    std_v = mean_v * VELOCITY_CV
    floor_v = mean_v * VELOCITY_FLOOR

    rng = random.Random(seed)
    outcomes = []
    for _ in range(sims):
        left = remaining
        n = 0
        while left > 0 and n < MAX_SPRINTS:
            # Draw this sprint's velocity around the historical mean, clamped
            # so it never goes absurdly low (or negative).
            v = max(rng.gauss(mean_v, std_v), floor_v)
            left -= v
            n += 1
        outcomes.append(n)
    outcomes.sort()

    def pct(p):
        idx = min(len(outcomes) - 1, int(p / 100 * len(outcomes)))
        return outcomes[idx]

    today = date.today()

    def to_date(n_sprints):
        return (today + timedelta(days=n_sprints * SPRINT_DAYS)).isoformat()

    p50, p80, p95 = pct(50), pct(80), pct(95)
    return {
        "remaining_points": remaining,
        "historical_velocity": pool,
        "velocity_mean": round(mean_v, 1),
        "assumed_cv": VELOCITY_CV,
        "simulations": sims,
        "sprints_p50": p50, "sprints_p80": p80, "sprints_p95": p95,
        "date_p50": to_date(p50), "date_p80": to_date(p80), "date_p95": to_date(p95),
    }


def monte_carlo(data=None, sims: int = SIMULATIONS, seed: int = 42) -> dict:
    """Synthetic-dataset wrapper (unchanged behaviour). Derives remaining work
    and the velocity pool from the in-memory synthetic dataset, then delegates
    to monte_carlo_from()."""
    data = data or build_synthetic_dataset()
    return monte_carlo_from(
        remaining_work_points(data),
        velocity_pool(data),
        sims=sims,
        seed=seed,
    )
