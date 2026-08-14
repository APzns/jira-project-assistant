"""skills.py — /skills endpoints: AI-powered skill runner for analyze-status and propose-next-steps."""

from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from google import genai
from google.genai import types

from src.jira_ai.api.db import get_db

logger = logging.getLogger("jira_ai")

router = APIRouter(prefix="/skills", tags=["skills"])

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
_REPO_ROOT = Path(__file__).resolve().parents[4]
_SKILLS_DIR = _REPO_ROOT / ".agents" / "skills"
_SETTINGS_FILE = _REPO_ROOT / ".agents" / "settings" / "ai_settings.json"

# ---------------------------------------------------------------------------
# Gemini client (mirrors the pattern in llm.py)
# ---------------------------------------------------------------------------
CANDIDATE_MODELS = [
    "gemini-flash-lite-latest",
    "gemini-flash-latest",
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash",
]

_client = None


def _get_client():
    global _client
    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        return None
    if _client is None:
        try:
            timeout_ms = int(os.environ.get("GEMINI_TIMEOUT_MS", "90000"))
            _client = genai.Client(api_key=api_key, http_options={"timeout": timeout_ms})
        except Exception as exc:
            logger.warning("skills.py: Failed to initialize genai client: %s", exc)
            return None
    return _client


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _load_skill_md(skill_name: str) -> str:
    path = _SKILLS_DIR / skill_name / "SKILL.md"
    try:
        content = path.read_text(encoding="utf-8").strip()
        if not content or content.startswith("> **Placeholder**"):
            raise ValueError("placeholder")
        return content
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Skill '{skill_name}' not found.")
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Skill '{skill_name}' is not yet implemented.")


def _load_settings() -> dict:
    try:
        return json.loads(_SETTINGS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {
            "stakeholder": "program_manager",
            "focus_teams": [],
            "focus_epics": [],
            "risk_categories": ["dependency", "velocity", "overcommitment"],
            "min_risk_severity": "medium",
            "summary_verbosity": "brief",
        }


def _load_stakeholder_persona() -> str:
    path = _SKILLS_DIR / "ai-settings-update" / "SKILL.md"
    try:
        return path.read_text(encoding="utf-8").strip()
    except Exception:
        return ""


def _settings_context_block(settings: dict) -> str:
    focus_teams = settings.get("focus_teams") or []
    focus_epics = settings.get("focus_epics") or []
    risk_cats = settings.get("risk_categories", ["dependency", "velocity", "overcommitment"])
    min_sev = settings.get("min_risk_severity", "medium")
    verbosity = settings.get("summary_verbosity", "brief")

    lines = ["## Active AI Settings (apply these filters to your output)"]
    lines.append(f"- Focus teams: {', '.join(focus_teams) if focus_teams else 'all teams'}")
    lines.append(f"- Focus epics: {', '.join(focus_epics) if focus_epics else 'all epics'}")
    lines.append(f"- Risk categories to surface: {', '.join(risk_cats)}")
    lines.append(f"- Minimum risk severity: {min_sev} (skip risks below this level)")
    lines.append(f"- Summary verbosity: {verbosity}")
    return "\n".join(lines)


def _get_metrics_context(db) -> str:
    """Pull the cached assessment metrics and format them as a context block."""
    try:
        from src.jira_ai.api.services.assessment import get_cached_assessment
        assess = get_cached_assessment(db)
        if not assess:
            return "No cached metrics available — base your analysis on the DB schema context."
        metrics = assess.get("metrics", {})
        relevant_keys = [
            "milestone_completion", "project_milestone",
            "predictability", "team_predictability",
            "defects_ratio", "team_defects_ratio",
            "overcommit_next", "overcommit_by_team",
            "blocked_issues", "cross_team_blockers",
            "dependency_conflicts", "unresolved_bugs",
            "forecast_monte_carlo", "forecast_delay_days",
            "delayed_by_fixversion", "overdue_points_pct",
            "sprint_progress",
        ]
        snapshot = {k: metrics[k] for k in relevant_keys if k in metrics}
        # Also include top-level assessment fields
        for k in ("overall_status", "headline", "reasoning", "risks", "recommended_actions"):
            if k in assess:
                snapshot[k] = assess[k]
        return json.dumps(snapshot, default=str, indent=2)
    except Exception as exc:
        logger.warning("skills.py: Could not load metrics context: %s", exc)
        return "Metrics snapshot unavailable."


def _call_gemini(system_instruction: str, user_prompt: str, response_schema: dict | None = None) -> str | None:
    client = _get_client()
    if not client:
        return None

    config_kwargs: dict = {
        "system_instruction": system_instruction,
        "temperature": 0.2,
        "max_output_tokens": 1500,
    }
    if response_schema:
        config_kwargs["response_mime_type"] = "application/json"
        config_kwargs["response_schema"] = response_schema

    config = types.GenerateContentConfig(**config_kwargs)

    for m in CANDIDATE_MODELS:
        try:
            resp = client.models.generate_content(model=m, contents=user_prompt, config=config)
            if resp and getattr(resp, "text", None):
                return resp.text.strip()
        except Exception as exc:
            logger.warning("skills.py: LLM call failed with model %s: %s", m, exc)
            time.sleep(0.5)
    return None


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class SkillRequest(BaseModel):
    context: Optional[str] = None   # active UI tab hint


# ---------------------------------------------------------------------------
# Analyze Status endpoint
# ---------------------------------------------------------------------------

_ANALYZE_STATUS_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "delays": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "area": {"type": "string"},
                    "description": {"type": "string"},
                    "predictive_completion": {"type": "string"},
                    "confidence": {"type": "string"},
                },
                "required": ["area", "description"],
            },
        },
        "risks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "severity": {"type": "string"},
                    "area": {"type": "string"},
                    "evidence": {"type": "string"},
                    "mitigation": {"type": "string"},
                },
                "required": ["title", "severity", "area", "evidence", "mitigation"],
            },
        },
        "program_health": {"type": "string"},
        "forecast_summary": {"type": "string"},
    },
    "required": ["summary", "delays", "risks"],
}


@router.post("/analyze-status")
def skill_analyze_status(payload: SkillRequest, db: Session = Depends(get_db)):
    """Run the Analyze Status skill: find delays, discover risks, propose mitigations."""
    skill_md = _load_skill_md("analyze-status")
    stakeholder_md = _load_stakeholder_persona()
    settings = _load_settings()
    settings_block = _settings_context_block(settings)
    metrics_ctx = _get_metrics_context(db)

    system_instruction = f"""{skill_md}

---

{stakeholder_md}

---

{settings_block}
"""

    user_prompt = f"""You are performing a full Analyze Status skill run.

## Program Metrics Snapshot
<untrusted_data>
{metrics_ctx}
</untrusted_data>

Based strictly on the metrics above, run all four sub-skills in order:
1. Find delays (smart summaries + predictive analysis)
2. Program vs. project monitoring framing
3. Discover risks (filtered by AI Settings)
4. Propose risk mitigations (one per risk)

Return a JSON object matching the required schema. Do not invent data not present in the metrics snapshot.
"""

    raw = _call_gemini(system_instruction, user_prompt, response_schema=_ANALYZE_STATUS_SCHEMA)
    if not raw:
        raise HTTPException(status_code=503, detail="AI service unavailable.")

    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        result = {"summary": raw, "delays": [], "risks": []}

    return {"skill": "analyze-status", "settings_applied": settings, **result}


# ---------------------------------------------------------------------------
# Propose Next Steps endpoint
# ---------------------------------------------------------------------------

_NEXT_STEPS_SCHEMA = {
    "type": "object",
    "properties": {
        "actions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "priority": {"type": "string"},
                    "owner": {"type": "string"},
                    "rationale": {"type": "string"},
                },
                "required": ["title", "priority", "rationale"],
            },
        },
        "summary": {"type": "string"},
    },
    "required": ["actions"],
}


@router.post("/propose-next-steps")
def skill_propose_next_steps(payload: SkillRequest, db: Session = Depends(get_db)):
    """Run the Propose Next Steps skill: generate a prioritized action plan."""
    skill_md = _load_skill_md("propose-next-steps")
    stakeholder_md = _load_stakeholder_persona()
    settings = _load_settings()
    settings_block = _settings_context_block(settings)
    metrics_ctx = _get_metrics_context(db)

    system_instruction = f"""{skill_md}

---

{stakeholder_md}

---

{settings_block}
"""

    user_prompt = f"""You are performing a Propose Next Steps skill run.

## Program Metrics Snapshot
<untrusted_data>
{metrics_ctx}
</untrusted_data>

Based strictly on the metrics above, generate 3–7 prioritized actions (P1/P2/P3).
Apply AI Settings filters (focus_teams, focus_epics, min_risk_severity).
Return a JSON object matching the required schema. Do not invent data not present in the metrics.
"""

    raw = _call_gemini(system_instruction, user_prompt, response_schema=_NEXT_STEPS_SCHEMA)
    if not raw:
        raise HTTPException(status_code=503, detail="AI service unavailable.")

    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        result = {"actions": [], "summary": raw}

    return {"skill": "propose-next-steps", "settings_applied": settings, **result}
