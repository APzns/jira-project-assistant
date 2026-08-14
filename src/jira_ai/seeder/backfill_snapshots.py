"""
backfill_snapshots.py — Fabricate synthetic historical MetricsSnapshot rows
that converge on today's real metrics.

DEMO USE ONLY. Every row written here has synthetic=True so it can be
identified, filtered, or deleted later. The series is interpolated backwards
from today's real _compute_metrics() output, so the last synthetic point sits
just before now and today's first real snapshot continues the line cleanly.

Run once, after the metrics_snapshots table exists:
    python -m src.jira_ai.seeder.backfill_snapshots
"""

import json
import random
from datetime import datetime, timedelta, UTC

from src.jira_ai.ingestion.models import SessionLocal, MetricsSnapshot
from src.jira_ai.api.services.assessment import _compute_metrics

DAYS_BACK = 21          # how much fake history to fabricate
STEP_DAYS = 1           # one point per day

# For each metric: the fraction of today's value it started at, DAYS_BACK ago.
# e.g. 0.45 means "3 weeks ago it was ~45% of today's number" -> ramps up.
# A value > 1.0 would ramp DOWN toward today.
TREND_START_FRACTION = {
    "blocked_issues":        0.45,
    "cross_team_blockers":   0.35,   # climbs toward the R5 threshold over time
    "overdue":               0.30,
    "total":                 0.80,   # scope grows slowly
    "epic_completion":       0.40,   # completion ramps up
}
NOISE = 0.06            # +/- 6% jitter so the line isn't a perfect ramp


def _interp(target: float, frac_start: float, t: float) -> float:
    """Interpolate one metric. t in [0,1]: 0 = oldest point, 1 = today.

    Linear ramp from (target * frac_start) up to target, plus small noise,
    clamped at >= 0 so counts never go negative.
    """
    start = target * frac_start
    val = start + (target - start) * t
    val *= 1 + random.uniform(-NOISE, NOISE)
    return max(val, 0)


def main() -> None:
    random.seed(42)  # reproducible demo run-to-run
    db = SessionLocal()
    try:
        # Guard: don't stack multiple sets of synthetic history on repeat runs.
        existing = db.query(MetricsSnapshot).filter_by(synthetic=True).count()
        if existing:
            print(f"Found {existing} synthetic rows already. Delete them first "
                  f"if you want to regenerate. Aborting.")
            return

        real = _compute_metrics(db)  # today's ground truth
        now = datetime.now(UTC)
        n = DAYS_BACK // STEP_DAYS

        written = 0
        for i in range(n):
            # Oldest first; last synthetic point ~1 day before now.
            days_ago = DAYS_BACK - i * STEP_DAYS
            t = i / (n - 1) if n > 1 else 1.0
            captured = now - timedelta(days=days_ago)

            snap = {}
            for key, val in real.items():
                if key in TREND_START_FRACTION and isinstance(val, (int, float)):
                    scaled = _interp(val, TREND_START_FRACTION[key], t)
                    # Keep counts as ints, ratios as floats.
                    snap[key] = round(scaled) if isinstance(val, int) else round(scaled, 3)
                else:
                    snap[key] = val  # carry non-trended fields through unchanged

            db.add(MetricsSnapshot(
                captured_at=captured,
                synthetic=True,
                metrics_json=json.dumps(snap),
            ))
            written += 1

        db.commit()
        print(f"Backfilled {written} synthetic snapshots over {DAYS_BACK} days.")
        print(f"Series converges on today's real values, e.g. "
              f"cross_team_blockers -> {real.get('cross_team_blockers')}, "
              f"blocked_issues -> {real.get('blocked_issues')}.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
