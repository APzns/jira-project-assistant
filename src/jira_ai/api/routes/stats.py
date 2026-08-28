"""
stats.py — HTTP routes exposing dashboard statistics as JSON.
"""

from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from src.jira_ai.api.db import get_db
from src.jira_ai.api.services import metrics

router = APIRouter(prefix="/stats", tags=["stats"])


@router.get("/summary")
def get_summary(
    mode: str = "real",
    project_key: Optional[str] = Query(None),
    db: Session = Depends(get_db),
) -> dict:
    """Return the full dashboard summary (all metrics in one response), optionally scoped by project_key.

    mode="real"        -> metrics computed from the ingested Jira data (default)
    mode="synthetic"   -> metrics computed from the synthetic dataset
    project_key        -> optional project key filter (e.g. 'CHK', 'CORE', 'MOB', 'ALL')
    """
    return metrics.dashboard_summary(db, mode=mode, project_key=project_key)


@router.get("/telemetry")
def get_telemetry_summary(
    mode: str = "real",
    force_refresh: bool = False,
    db: Session = Depends(get_db),
) -> dict:
    """Return comparative engineering telemetry across all active projects for Dashboards Hub."""
    from src.jira_ai.api.routes.projects import _read_projects_from_disk
    from src.jira_ai.api.services.assessment.context import _compute_metrics
    from src.jira_ai.api.services.assessment.evaluators import _build_monte_carlo
    from src.jira_ai.ingestion.models import AssessmentCache
    from datetime import datetime
    import json

    TELEMETRY_CACHE_ID = 30000 if mode == "real" else 40000

    if not force_refresh:
        row = db.get(AssessmentCache, TELEMETRY_CACHE_ID)
        if row:
            try:
                return json.loads(row.payload)
            except Exception:
                pass

    proj_data = _read_projects_from_disk()
    projects = [p for p in proj_data.get("projects", []) if not p.get("archived", False)]

    telemetry = []
    for p in projects:
        pkey = p.get("key", "")
        try:
            m = _compute_metrics(db, project_key=pkey)
            mc = _build_monte_carlo(m)
            
            # Predictability
            pred = m.get("predictability", {})
            pred_pct = round(pred.get("pct"), 1) if isinstance(pred, dict) and pred.get("pct") is not None else None

            # Monte Carlo Forecast Delay
            p50_str = mc.get("p50_date")
            target_str = mc.get("target_date")
            delay_days = 0
            if p50_str and target_str:
                try:
                    d_p50 = datetime.strptime(p50_str, "%Y-%m-%d").date()
                    d_target = datetime.strptime(target_str, "%Y-%m-%d").date()
                    delay_days = (d_p50 - d_target).days
                except Exception:
                    pass

            unresolved_bugs = m.get("unresolved_bugs", 0)
            cross_team_blockers = m.get("cross_team_blockers", p.get("blockers_count", 0))

            telemetry.append({
                "key": pkey,
                "name": p.get("name", pkey),
                "description": p.get("description", ""),
                "status": p.get("status", "on-track"),
                "lead": p.get("lead", "Unassigned"),
                "target_release": p.get("target_release", "TBD"),
                "progress_pct": p.get("progress_pct", 0),
                "progress_sp": p.get("progress_sp", ""),
                "tags": p.get("tags", []),
                "predictability_pct": pred_pct,
                "unresolved_bugs": unresolved_bugs,
                "blockers_count": cross_team_blockers,
                "mc_target_date": target_str,
                "mc_p50_date": p50_str,
                "mc_delay_days": delay_days,
                "total_issues": m.get("total_issues", 0)
            })
        except Exception:
            telemetry.append({
                "key": pkey,
                "name": p.get("name", pkey),
                "description": p.get("description", ""),
                "status": p.get("status", "on-track"),
                "lead": p.get("lead", "Unassigned"),
                "target_release": p.get("target_release", "TBD"),
                "progress_pct": p.get("progress_pct", 0),
                "progress_sp": p.get("progress_sp", ""),
                "tags": p.get("tags", []),
                "predictability_pct": None,
                "unresolved_bugs": 0,
                "blockers_count": p.get("blockers_count", 0),
                "mc_target_date": None,
                "mc_p50_date": None,
                "mc_delay_days": 0,
                "total_issues": 0
            })

    result = {
        "telemetry": telemetry,
        "total_projects": len(telemetry),
        "timestamp": datetime.now().isoformat()
    }

    row = db.get(AssessmentCache, TELEMETRY_CACHE_ID)
    if row:
        row.payload = json.dumps(result)
        row.generated_at = datetime.now()
    else:
        db.add(AssessmentCache(id=TELEMETRY_CACHE_ID, payload=json.dumps(result)))
    db.commit()

    return result

