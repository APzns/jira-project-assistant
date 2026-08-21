"""ask.py — /ask endpoint for natural-language questions about Jira data."""

from fastapi import APIRouter, Depends, Request, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from src.jira_ai.api.db import get_db
from src.jira_ai.api.services import llm
from src.jira_ai.api.services.security import check_rate_limit, log_ai_question, log_ai_answer

router = APIRouter(prefix="/ask", tags=["ask"])


from typing import Optional

class Question(BaseModel):
    question: str
    history: Optional[list] = None   # list of {"question": ..., "answer": ...}
    context: Optional[str] = None    # active tab: assessment | status | delivery | quality
    project_key: Optional[str] = None # active project filter e.g. "MOB", "CHK", "CORE"


@router.post("")
def ask(payload: Question, request: Request, db: Session = Depends(get_db)):
    client_ip = request.client.host if request.client else "unknown"
    if not check_rate_limit(client_ip):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Rate limit exceeded. Maximum 20 requests per minute allowed for AI Chat."
        )
    log_ai_question(client_ip, payload.question, payload.context)
    try:
        result = llm.answer_question(
            payload.question,
            db,
            payload.history,
            payload.context,
            client_ip=client_ip,
            project_key=payload.project_key
        )
        log_ai_answer(client_ip, result.get("answer") if isinstance(result, dict) else str(result))
        return result
    except Exception as exc:
        log_ai_answer(client_ip, answer=None, error=str(exc))
        raise

