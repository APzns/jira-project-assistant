"""settings.py — /settings endpoint: read and write the ai_settings.json file."""

from __future__ import annotations

import json
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator

router = APIRouter(prefix="/settings", tags=["settings"])

_SETTINGS_FILE = Path(__file__).resolve().parents[4] / ".agents" / "settings" / "ai_settings.json"

_VALID_RISK_CATEGORIES = {"dependency", "velocity", "overcommitment"}
_VALID_SEVERITIES = {"low", "medium", "high"}
_VALID_VERBOSITIES = {"brief", "detailed"}
_VALID_STAKEHOLDERS = {"program_manager", "executive", "engineer"}


class AISettings(BaseModel):
    stakeholder: Optional[str] = "program_manager"
    focus_teams: Optional[List[str]] = []
    focus_epics: Optional[List[str]] = []
    risk_categories: Optional[List[str]] = ["dependency", "velocity", "overcommitment"]
    min_risk_severity: Optional[str] = "medium"
    summary_verbosity: Optional[str] = "brief"

    @field_validator("min_risk_severity")
    @classmethod
    def validate_severity(cls, v):
        if v and v not in _VALID_SEVERITIES:
            raise ValueError(f"min_risk_severity must be one of {_VALID_SEVERITIES}")
        return v

    @field_validator("summary_verbosity")
    @classmethod
    def validate_verbosity(cls, v):
        if v and v not in _VALID_VERBOSITIES:
            raise ValueError(f"summary_verbosity must be one of {_VALID_VERBOSITIES}")
        return v

    @field_validator("risk_categories")
    @classmethod
    def validate_risk_categories(cls, v):
        if v:
            invalid = set(v) - _VALID_RISK_CATEGORIES
            if invalid:
                raise ValueError(f"Invalid risk_categories: {invalid}. Valid: {_VALID_RISK_CATEGORIES}")
        return v

    @field_validator("stakeholder")
    @classmethod
    def validate_stakeholder(cls, v):
        if v and v not in _VALID_STAKEHOLDERS:
            raise ValueError(f"stakeholder must be one of {_VALID_STAKEHOLDERS}")
        return v


@router.get("")
def get_settings() -> dict:
    """Return the current ai_settings.json contents."""
    try:
        raw = _SETTINGS_FILE.read_text(encoding="utf-8")
        return json.loads(raw)
    except FileNotFoundError:
        # Return defaults if file doesn't exist yet
        return AISettings().model_dump()
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail=f"Settings file is corrupt: {exc}")


@router.post("")
def save_settings(settings: AISettings) -> dict:
    """Validate and write ai_settings.json to disk."""
    try:
        _SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
        _SETTINGS_FILE.write_text(
            json.dumps(settings.model_dump(), indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        return {"saved": True, "settings": settings.model_dump()}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not write settings file: {exc}")
