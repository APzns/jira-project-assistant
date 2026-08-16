"""stakeholders.py — /stakeholders endpoint: read, write, and manage stakeholder profiles."""

import json
import uuid
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/stakeholders", tags=["stakeholders"])

_STAKEHOLDERS_FILE = Path(__file__).resolve().parents[4] / ".agents" / "settings" / "stakeholders.json"

DEFAULT_STAKEHOLDERS = [
    {
        "id": "pm-default",
        "name": "Project Manager (Default)",
        "role_type": "project_manager",
        "is_builtin": True,
        "description": "Focuses on delivery schedules, cross-team dependencies, and overall program health."
    },
    {
        "id": "exec",
        "name": "Executive",
        "role_type": "executive",
        "is_builtin": True,
        "description": "Focuses on high-level strategic alignment, budget, and major risks affecting milestones."
    },
    {
        "id": "eng-lead",
        "name": "Engineering Lead",
        "role_type": "engineering_lead",
        "is_builtin": True,
        "description": "Focuses on technical debt, defect ratios, engineering capacity, and architecture."
    },
    {
        "id": "qa-lead",
        "name": "QA Lead",
        "role_type": "qa_lead",
        "is_builtin": True,
        "description": "Focuses on software quality, defect trends, and testing coverage."
    }
]


class StakeholderProfile(BaseModel):
    id: Optional[str] = None
    name: str
    role_type: str = "custom"
    is_builtin: bool = False
    description: str
    project_override: Optional[str] = None


class StakeholdersData(BaseModel):
    stakeholders: List[StakeholderProfile]


def _read_stakeholders_from_disk() -> dict:
    """Read stakeholders.json or construct a fully-populated default document."""
    try:
        raw = _STAKEHOLDERS_FILE.read_text(encoding="utf-8")
        data = json.loads(raw)
    except (FileNotFoundError, json.JSONDecodeError):
        data = {}

    stakeholders = data.get("stakeholders")
    if not stakeholders or not isinstance(stakeholders, list):
        stakeholders = [dict(s) for s in DEFAULT_STAKEHOLDERS]
        data["stakeholders"] = stakeholders

    return data


@router.get("")
def get_stakeholders() -> dict:
    """Return the current stakeholders.json contents."""
    return _read_stakeholders_from_disk()


@router.post("")
def save_stakeholders(payload: StakeholdersData) -> dict:
    """Validate and write stakeholders.json to disk."""
    try:
        data = payload.model_dump(exclude_unset=True)
        stakeholders = data.get("stakeholders", [])

        # Ensure every profile has an id
        for s in stakeholders:
            if not s.get("id"):
                s["id"] = f"stakeholder-{uuid.uuid4().hex[:8]}"

        result_doc = {
            "stakeholders": stakeholders,
        }

        _STAKEHOLDERS_FILE.parent.mkdir(parents=True, exist_ok=True)
        _STAKEHOLDERS_FILE.write_text(
            json.dumps(result_doc, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        return {"saved": True, "data": result_doc}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not write stakeholders file: {exc}")


@router.post("/reset")
def reset_stakeholders() -> dict:
    """Reset all stakeholders back to factory defaults."""
    try:
        default_doc = {
            "stakeholders": [dict(s) for s in DEFAULT_STAKEHOLDERS],
        }
        _STAKEHOLDERS_FILE.parent.mkdir(parents=True, exist_ok=True)
        _STAKEHOLDERS_FILE.write_text(
            json.dumps(default_doc, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        return {"reset": True, "data": default_doc}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not reset stakeholders: {exc}")
