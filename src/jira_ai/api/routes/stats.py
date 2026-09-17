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
    return metrics.get_telemetry_summary(db, mode, force_refresh)

