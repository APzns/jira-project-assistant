# assess.py — /assess endpoints: AI program-status assessment.
from typing import Optional
from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from src.jira_ai.api.db import get_db
from src.jira_ai.api.services import assessment

router = APIRouter(prefix="/assess", tags=["assess"])


@router.get("")
def refresh_assessment(
    response: Response,
    mode: str = "real",
    project_key: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """Generate a FRESH assessment (calls Gemini) and cache it.

    mode="real"      -> metrics from the live DB
    mode="synthetic" -> metrics from the synthetic gen
    project_key      -> optional project filter (e.g. 'CHK', 'CORE', 'MOB', 'ALL')
    """
    try:
        res = assessment.assess(db, mode=mode, project_key=project_key)
        response.headers["X-Report-Status"] = "generated_fresh_success"
        return res
    except Exception as exc:
        cached = assessment.get_cached_assessment(db, mode=mode, project_key=project_key)
        if cached:
            response.headers["X-Report-Status"] = "fallback_cached_error"
            return {"cached": True, **cached, "warning": "Assessment updated with cached fallback due to internal error."}
        response.headers["X-Report-Status"] = "error"
        return {"error": "Failed to refresh assessment."}


@router.get("/latest")
def latest_assessment(
    response: Response,
    mode: str = "real",
    project_key: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """Return the LAST cached assessment instantly (no Gemini call).
    If none has been generated yet, immediately generates deterministic metrics + fallback without blocking."""
    try:
        assessment_data = assessment.get_instant_assessment(db, mode=mode, project_key=project_key)
        response.headers["X-Report-Status"] = "loaded_cached_success"
        return {"cached": True, **assessment_data}
    except Exception as exc:
        response.headers["X-Report-Status"] = "error"
        return {"error": "Failed to load latest assessment.", "cached": False}



