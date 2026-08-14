# assess.py — /assess endpoints: AI program-status assessment.
from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from src.jira_ai.api.db import get_db
from src.jira_ai.api.services import assessment

router = APIRouter(prefix="/assess", tags=["assess"])


@router.get("")
def refresh_assessment(response: Response, mode: str = "real", db: Session = Depends(get_db)):
    """Generate a FRESH assessment (calls Gemini) and cache it.

    mode="real"      -> metrics from the live DB      (cache row id=1)
    mode="synthetic" -> metrics from the synthetic gen (cache row id=2)
    """
    try:
        res = assessment.assess(db, mode=mode)
        response.headers["X-Report-Status"] = "generated_fresh_success"
        return res
    except Exception as exc:
        cached = assessment.get_cached_assessment(db, mode=mode)
        if cached:
            response.headers["X-Report-Status"] = f"fallback_cached_error:{exc}"
            return {"cached": True, **cached, "warning": f"Assessment updated with cached fallback due to: {exc}"}
        response.headers["X-Report-Status"] = f"error:{exc}"
        return {"error": f"Failed to refresh assessment: {exc}"}


@router.get("/latest")
def latest_assessment(response: Response, mode: str = "real", db: Session = Depends(get_db)):
    """Return the LAST cached assessment instantly (no Gemini call).
    Returns {"cached": false} if none has been generated yet for this mode."""
    cached = assessment.get_cached_assessment(db, mode=mode)
    if cached is None:
        response.headers["X-Report-Status"] = "not_loaded_no_cache"
        return {"cached": False}
    response.headers["X-Report-Status"] = "loaded_cached_success"
    return {"cached": True, **cached}


