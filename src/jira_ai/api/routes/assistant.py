"""assistant.py — /assistant endpoint: Conversational Program & Delivery Assistant.

Directly answers natural language questions, provides TPM advice, next steps,
and trade-off analyses, while only proposing report templates when explicitly requested.
"""

from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, Request, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from src.jira_ai.api.db import get_db
from src.jira_ai.api.services import llm
from src.jira_ai.api.services.security import check_rate_limit, log_ai_question, log_ai_answer, check_input_injection, log_security_event

router = APIRouter(prefix="/assistant", tags=["assistant"])


class AssistantMessage(BaseModel):
    message: Optional[str] = None
    user_prompt: Optional[str] = None
    chat_history: Optional[List[Dict[str, Any]]] = Field(default_factory=list)
    history: Optional[List[Dict[str, Any]]] = None
    project_key: Optional[str] = None
    context: Optional[str] = "assistant"
    stakeholder_ids: Optional[List[str]] = Field(default_factory=list)


@router.post("/chat")
def chat(payload: AssistantMessage, request: Request, db: Session = Depends(get_db)):
    """Conversational endpoint for the full-page Assistant and Copilot.
    
    Accepts natural-language queries, advice requests, next steps, and report requests.
    """
    client_ip = request.client.host if request.client else "unknown"
    if not check_rate_limit(client_ip):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Rate limit exceeded. Maximum 20 requests per minute allowed for AI Assistant."
        )

    text = (payload.message or payload.user_prompt or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Message cannot be empty.")

    injection_error = check_input_injection(text)
    if injection_error:
        log_security_event("INPUT_INJECTION_BLOCKED", f"Blocked assistant message: '{text[:100]}'", client_ip)
        return {
            "reply": f"⚠️ {injection_error}",
            "proposed_template": None,
            "error": injection_error
        }

    log_ai_question(client_ip, text, payload.context or "assistant")
    
    # Consolidate history
    raw_history = payload.chat_history or payload.history or []

    try:
        result = llm.chat_assistant(
            message=text,
            db=db,
            history=raw_history,
            project_key=payload.project_key,
            context=payload.context,
            client_ip=client_ip,
            stakeholder_ids=payload.stakeholder_ids
        )
        log_ai_answer(client_ip, result.get("reply"))
        return result
    except Exception as exc:
        log_ai_answer(client_ip, answer=None, error=str(exc))
        raise HTTPException(status_code=500, detail=f"Assistant error: {exc}")
