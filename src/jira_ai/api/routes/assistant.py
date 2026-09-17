"""assistant.py — /assistant endpoint: Conversational Program & Delivery Assistant.

Directly answers natural language questions, provides TPM advice, next steps,
and trade-off analyses, while only proposing report templates when explicitly requested.
"""

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from src.jira_ai.api.db import get_db
from src.jira_ai.api.services import llm
from src.jira_ai.api.services.security import (
    check_input_injection,
    check_rate_limit,
    log_ai_answer,
    log_ai_question,
    log_security_event,
)

router = APIRouter(prefix="/assistant", tags=["assistant"])


class AssistantMessage(BaseModel):
    message: str | None = None
    user_prompt: str | None = None
    chat_history: list[dict[str, Any]] | None = Field(default_factory=list)
    history: list[dict[str, Any]] | None = None
    project_key: str | None = None
    context: str | None = "assistant"
    stakeholder_ids: list[str] | None = Field(default_factory=list)


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
        logging.getLogger("jira_ai").error("Assistant error: %s", exc, exc_info=True)
        log_ai_answer(client_ip, answer=None, error=str(exc))
        raise HTTPException(status_code=500, detail="An internal error occurred. Please try again.")
