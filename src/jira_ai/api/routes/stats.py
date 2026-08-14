"""
stats.py — HTTP routes exposing dashboard statistics as JSON.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from src.jira_ai.api.db import get_db
from src.jira_ai.api.services import metrics

router = APIRouter(prefix="/stats", tags=["stats"])


@router.get("/summary")
def get_summary(mode: str = "real", db: Session = Depends(get_db)) -> dict:  # NEW: mode param
    """Return the full dashboard summary (all metrics in one response).

    mode="real"      -> metrics computed from the ingested Jira data (default)
    mode="synthetic" -> metrics computed from the synthetic dataset
    """
    return metrics.dashboard_summary(db, mode=mode)  # NEW: forward mode
