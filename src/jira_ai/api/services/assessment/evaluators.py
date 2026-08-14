"""evaluators.py — Monte Carlo burn-up, delay calculations, and risk lens loader."""

from datetime import date
from pathlib import Path
from src.jira_ai.api.services.assessment.context import _pick


def _completed_points(s: dict) -> float:
    """Completed story points for a sprint."""
    return float(_pick(s, "completed_points", "done_points", "points", default=0) or 0)


def _build_monte_carlo(metrics: dict) -> dict:
    """Cumulative burn-up as TWO LINES on a DATE x-axis."""
    sp = metrics.get("sprint_progress", [])

    closed = [s for s in sp if s.get("state") == "closed"]
    vels = sorted(_completed_points(s) for s in closed)
    if vels:
        mid = len(vels) // 2
        median_vel = vels[mid] if len(vels) % 2 else (vels[mid - 1] + vels[mid]) / 2
    else:
        median_vel = 0

    def _end(s):
        return (s.get("end_date") or "")[:10] or None

    actual, forecast_line = [], []
    running = 0.0
    projected = 0.0
    anchor = None
    for s in sp:
        x = _end(s)
        if not x:
            continue
        state = s.get("state")
        if state in ("closed", "active"):
            running += _completed_points(s)
            actual.append({"x": x, "y": round(running)})
            projected = running
            anchor = {"x": x, "y": round(running)}
        else:
            projected += median_vel
            forecast_line.append({"x": x, "y": round(projected)})

    if anchor is not None:
        forecast_line = [anchor] + forecast_line

    mc = metrics.get("forecast_monte_carlo") or {}
    p50_date = (mc.get("date_p50") or "")[:10] or None
    p80_date = (mc.get("date_p80") or "")[:10] or None
    sprints_p50 = mc.get("sprints_p50") or 1
    sprints_p80 = mc.get("sprints_p80") or 1
    remaining = mc.get("remaining_points")

    total_scope = None
    p50_line = []
    p80_line = []

    if anchor is not None and anchor.get("x") and remaining is not None and float(remaining) > 0:
        total_scope = round(anchor["y"] + float(remaining))
        rem = float(remaining)
        n_p50 = max(1, int(sprints_p50))
        n_p80 = max(1, int(sprints_p80))
        
        try:
            start_dt = datetime.strptime(anchor["x"], "%Y-%m-%d")
            p50_line = []
            p80_line = []
            max_sprints = max(n_p50, n_p80)
            
            for k in range(max_sprints + 1):
                cur_dt = (start_dt + timedelta(days=k * 14)).strftime("%Y-%m-%d")
                
                # P50 progress
                ratio_50 = min(1.0, float(k) / float(n_p50))
                val_50 = round(anchor["y"] + ratio_50 * rem)
                p50_line.append({"x": cur_dt, "y": val_50})
                
                # P80 progress
                ratio_80 = min(1.0, float(k) / float(n_p80))
                val_80 = round(anchor["y"] + ratio_80 * rem)
                p80_line.append({"x": cur_dt, "y": val_80})
        except Exception:
            if p50_date:
                p50_line = [anchor, {"x": p50_date, "y": total_scope}]
            if p80_date:
                p80_line = [anchor, {"x": p80_date, "y": total_scope}]

    if not p50_line:
        p50_line = forecast_line
    if not p80_line:
        p80_line = forecast_line

    if p80_date and anchor is not None and remaining is not None:
        total_scope = round(anchor["y"] + float(remaining))
        if not forecast_line or forecast_line[-1]["x"] != p80_date:
            forecast_line.append({"x": p80_date, "y": total_scope})
        else:
            forecast_line[-1]["y"] = total_scope

    proj = metrics.get("project_milestone")
    target_date = None
    if proj:
        info = (metrics.get("milestone_completion") or {}).get(proj) or {}
        target_date = (info.get("release_date") or "")[:10] or None

    return {
        "actual": actual,
        "forecast": forecast_line,
        "p50_line": p50_line,
        "p80_line": p80_line,
        "total_scope": total_scope,
        "target_date": target_date,
        "p50_date": p50_date,
        "p80_date": p80_date,
    }


def _forecast_delay_days(metrics: dict) -> int | None:
    """Whole days the Monte-Carlo P50 finish date slips past the final milestone's target release date."""
    mc = metrics.get("forecast_monte_carlo") or {}
    p50 = mc.get("date_p50")
    if not p50:
        return None

    proj = metrics.get("project_milestone")
    target = None
    if proj:
        info = (metrics.get("milestone_completion") or {}).get(proj) or {}
        target = info.get("release_date")
    if not target:
        return None

    try:
        d_p50 = date.fromisoformat(str(p50)[:10])
        d_target = date.fromisoformat(str(target)[:10])
    except ValueError:
        return None
    return (d_p50 - d_target).days


def _load_risk_lenses() -> str:
    """Load the risk-lens descriptions the agent reasons through."""
    lens_path = Path(__file__).resolve().parents[4] / "project_data" / "risks.md"
    try:
        with open(lens_path, encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return "Risk lenses: milestone deadline slip; project deadline slip; dependency risk."
