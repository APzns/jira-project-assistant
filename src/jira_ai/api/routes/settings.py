"""settings.py — /settings endpoint: read, write, and manage report profiles and AI settings."""

from __future__ import annotations

import json
import uuid
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

DEFAULT_PROFILES = [
    {
        "id": "default-exec",
        "name": "Executive Briefing (Default)",
        "is_default": True,
        "stakeholder": "executive",
        "focus_teams": [],
        "focus_epics": [],
        "risk_categories": ["dependency", "velocity", "overcommitment"],
        "min_risk_severity": "medium",
        "summary_verbosity": "brief",
        "custom_instructions": "Provide a high-level executive briefing focusing on milestone delivery dates, major schedule risks, and key strategic decisions required from leadership.",
    },
    {
        "id": "tpm-delivery",
        "name": "TPM Delivery Health",
        "is_default": False,
        "stakeholder": "program_manager",
        "focus_teams": [],
        "focus_epics": [],
        "risk_categories": ["dependency", "velocity", "overcommitment"],
        "min_risk_severity": "low",
        "summary_verbosity": "detailed",
        "custom_instructions": "Focus on cross-team dependency blockers, sprint pacing, Monte Carlo completion projections, and squad owner assignments for each mitigation.",
    },
    {
        "id": "eng-squad-deepdive",
        "name": "Engineering & Squad Deep-Dive",
        "is_default": False,
        "stakeholder": "engineer",
        "focus_teams": [],
        "focus_epics": [],
        "risk_categories": ["dependency", "velocity", "overcommitment"],
        "min_risk_severity": "medium",
        "summary_verbosity": "detailed",
        "custom_instructions": "Analyze ticket-level blockers, defect ratios, carryover velocity gaps, and sprint commitment balance across feature squads.",
    },
]


class ReportProfile(BaseModel):
    id: Optional[str] = None
    name: str = "Custom Report"
    is_default: Optional[bool] = False
    stakeholder: Optional[str] = "program_manager"
    focus_teams: Optional[List[str]] = []
    focus_epics: Optional[List[str]] = []
    risk_categories: Optional[List[str]] = ["dependency", "velocity", "overcommitment"]
    min_risk_severity: Optional[str] = "medium"
    summary_verbosity: Optional[str] = "brief"
    custom_instructions: Optional[str] = ""

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


class AISettings(BaseModel):
    active_profile_id: Optional[str] = "default-exec"
    profiles: Optional[List[ReportProfile]] = None
    stakeholder: Optional[str] = "program_manager"
    focus_teams: Optional[List[str]] = []
    focus_epics: Optional[List[str]] = []
    risk_categories: Optional[List[str]] = ["dependency", "velocity", "overcommitment"]
    min_risk_severity: Optional[str] = "medium"
    summary_verbosity: Optional[str] = "brief"
    custom_instructions: Optional[str] = ""


def _read_settings_from_disk() -> dict:
    """Read ai_settings.json or construct a fully-populated default document."""
    try:
        raw = _SETTINGS_FILE.read_text(encoding="utf-8")
        data = json.loads(raw)
    except (FileNotFoundError, json.JSONDecodeError):
        data = {}

    profiles = data.get("profiles")
    if not profiles or not isinstance(profiles, list):
        profiles = [dict(p) for p in DEFAULT_PROFILES]
        data["profiles"] = profiles

    active_id = data.get("active_profile_id") or "default-exec"
    active_profile = next((p for p in profiles if p.get("id") == active_id), profiles[0])
    data["active_profile_id"] = active_profile.get("id", "default-exec")

    # Mirror active profile settings to top-level fields for backwards compatibility
    for key in ("stakeholder", "focus_teams", "focus_epics", "risk_categories",
                "min_risk_severity", "summary_verbosity", "custom_instructions"):
        if key in active_profile:
            data[key] = active_profile[key]

    return data


@router.get("")
def get_settings() -> dict:
    """Return the current ai_settings.json contents with report profiles."""
    return _read_settings_from_disk()


@router.post("")
def save_settings(payload: AISettings) -> dict:
    """Validate and write ai_settings.json to disk."""
    try:
        current = _read_settings_from_disk()
        data = payload.model_dump(exclude_unset=True)

        profiles = data.get("profiles")
        if profiles is None:
            profiles = current.get("profiles", [dict(p) for p in DEFAULT_PROFILES])

        # Ensure every profile has an id
        for p in profiles:
            if not p.get("id"):
                p["id"] = f"profile-{uuid.uuid4().hex[:8]}"

        active_id = data.get("active_profile_id") or current.get("active_profile_id", "default-exec")
        
        # If flat fields are supplied directly, update active profile in-place
        active_prof = next((p for p in profiles if p.get("id") == active_id), None)
        if active_prof:
            for key in ("stakeholder", "focus_teams", "focus_epics", "risk_categories",
                        "min_risk_severity", "summary_verbosity", "custom_instructions"):
                if key in data and data[key] is not None:
                    active_prof[key] = data[key]
        else:
            active_id = profiles[0].get("id", "default-exec")

        result_doc = {
            "active_profile_id": active_id,
            "profiles": profiles,
            "stakeholder": active_prof.get("stakeholder") if active_prof else "program_manager",
            "focus_teams": active_prof.get("focus_teams", []) if active_prof else [],
            "focus_epics": active_prof.get("focus_epics", []) if active_prof else [],
            "risk_categories": active_prof.get("risk_categories", ["dependency", "velocity", "overcommitment"]) if active_prof else ["dependency", "velocity", "overcommitment"],
            "min_risk_severity": active_prof.get("min_risk_severity", "medium") if active_prof else "medium",
            "summary_verbosity": active_prof.get("summary_verbosity", "brief") if active_prof else "brief",
            "custom_instructions": active_prof.get("custom_instructions", "") if active_prof else "",
        }

        _SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
        _SETTINGS_FILE.write_text(
            json.dumps(result_doc, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        return {"saved": True, "settings": result_doc}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not write settings file: {exc}")


@router.post("/reset")
def reset_profiles() -> dict:
    """Reset all profiles back to factory defaults."""
    try:
        default_doc = {
            "active_profile_id": "default-exec",
            "profiles": [dict(p) for p in DEFAULT_PROFILES],
            **DEFAULT_PROFILES[0],
        }
        _SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
        _SETTINGS_FILE.write_text(
            json.dumps(default_doc, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        return {"reset": True, "settings": default_doc}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not reset settings: {exc}")
