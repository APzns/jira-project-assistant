"""projects.py — /projects endpoint: manage project-specific stakeholder assignments, RACI matrix, and reporting levels."""

import json
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

router = APIRouter(prefix="/projects", tags=["projects"])

_PROJECT_STAKEHOLDERS_FILE = Path(__file__).resolve().parents[4] / ".agents" / "settings" / "project_stakeholders.json"
_STAKEHOLDERS_FILE = Path(__file__).resolve().parents[4] / ".agents" / "settings" / "stakeholders.json"

DEFAULT_PROJECT_STAKEHOLDERS = {
    "CHK": [
        {
            "stakeholder_id": "po-commerce",
            "raci": "A",
            "reporting_level": "standard",
            "project_notes": "Owns checkout funnel conversion, feature prioritization, and user flow tradeoffs."
        },
        {
            "stakeholder_id": "pm-default",
            "raci": "R",
            "reporting_level": "standard",
            "project_notes": "Coordinates sprint delivery milestones and blocker resolution."
        },
        {
            "stakeholder_id": "eng-lead",
            "raci": "C",
            "reporting_level": "technical",
            "project_notes": "Advises on payment gateway API latency, microservice contracts, and technical debt."
        },
        {
            "stakeholder_id": "qa-lead",
            "raci": "C",
            "reporting_level": "technical",
            "project_notes": "Verifies checkout test automation coverage and release regression testing."
        }
    ],
    "CORE": [
        {
            "stakeholder_id": "eng-lead",
            "raci": "A",
            "reporting_level": "technical",
            "project_notes": "Owns platform architecture, core analytics pipelines, and technical debt remediation."
        },
        {
            "stakeholder_id": "pm-default",
            "raci": "R",
            "reporting_level": "standard",
            "project_notes": "Manages platform sprint delivery and dependencies with downstream teams."
        }
    ],
    "MOB": [
        {
            "stakeholder_id": "qa-lead",
            "raci": "A",
            "reporting_level": "technical",
            "project_notes": "Maintains mobile release criteria, device matrix testing, and defect trends."
        },
        {
            "stakeholder_id": "pm-default",
            "raci": "R",
            "reporting_level": "standard",
            "project_notes": "Tracks mobile feature delivery velocity and App Store release schedules."
        }
    ],
    "HRZ": [
        {
            "stakeholder_id": "exec",
            "raci": "A",
            "reporting_level": "executive",
            "project_notes": "Executive sponsor for FY27 portfolio delivery, budget allocation, and strategic milestones."
        },
        {
            "stakeholder_id": "pm-default",
            "raci": "R",
            "reporting_level": "standard",
            "project_notes": "Leads program-level dependency tracking, cross-team risk log, and aggregate sprint predictability."
        }
    ]
}


class ProjectStakeholderAssignment(BaseModel):
    stakeholder_id: str
    raci: str = Field(default="C", description="RACI role: R, A, C, or I")
    reporting_level: str = Field(default="standard", description="executive, standard, or technical")
    project_notes: Optional[str] = Field(default="", max_length=500)


class ProjectStakeholdersPayload(BaseModel):
    project_key: str
    assignments: List[ProjectStakeholderAssignment]


def _read_project_stakeholders() -> dict:
    """Read project_stakeholders.json or populate defaults."""
    try:
        if _PROJECT_STAKEHOLDERS_FILE.exists():
            raw = _PROJECT_STAKEHOLDERS_FILE.read_text(encoding="utf-8")
            data = json.loads(raw)
            if not isinstance(data, dict):
                data = {}
        else:
            data = {}
    except (FileNotFoundError, json.JSONDecodeError):
        data = {}

    if not data:
        data = dict(DEFAULT_PROJECT_STAKEHOLDERS)
        _write_project_stakeholders(data)

    return data


def _write_project_stakeholders(data: dict) -> None:
    _PROJECT_STAKEHOLDERS_FILE.parent.mkdir(parents=True, exist_ok=True)
    _PROJECT_STAKEHOLDERS_FILE.write_text(
        json.dumps(data, indent=2, ensure_ascii=False),
        encoding="utf-8"
    )


def _sync_stakeholders_projects_field(project_map: dict) -> None:
    """Synchronize the `projects` list on each stakeholder in stakeholders.json based on project assignments."""
    try:
        if not _STAKEHOLDERS_FILE.exists():
            return
        raw = _STAKEHOLDERS_FILE.read_text(encoding="utf-8")
        sh_data = json.loads(raw)
        stakeholders = sh_data.get("stakeholders", [])

        # Build map: stakeholder_id -> set of project_keys
        sh_proj_map = {}
        for pkey, assignments in project_map.items():
            for a in assignments:
                sid = a.get("stakeholder_id") if isinstance(a, dict) else a.stakeholder_id
                if sid:
                    sh_proj_map.setdefault(sid, set()).add(pkey)

        for s in stakeholders:
            sid = s.get("id")
            if sid in sh_proj_map:
                s["projects"] = sorted(list(sh_proj_map[sid]))
            else:
                s["projects"] = []

        sh_data["stakeholders"] = stakeholders
        _STAKEHOLDERS_FILE.write_text(
            json.dumps(sh_data, indent=2, ensure_ascii=False),
            encoding="utf-8"
        )
    except Exception as exc:
        print(f"Warning: Could not sync stakeholders projects: {exc}")


@router.get("/stakeholders")
def get_all_project_stakeholders() -> dict:
    """Get all project stakeholder assignments across all projects."""
    data = _read_project_stakeholders()
    return {"projects": data}


@router.get("/{project_key}/stakeholders")
def get_project_stakeholders(project_key: str) -> dict:
    """Get stakeholder assignments and RACI matrix for a specific project."""
    pkey = project_key.upper().strip()
    data = _read_project_stakeholders()
    assignments = data.get(pkey, [])
    return {
        "project_key": pkey,
        "assignments": assignments
    }


@router.put("/{project_key}/stakeholders")
def update_project_stakeholders(project_key: str, payload: ProjectStakeholdersPayload) -> dict:
    """Update stakeholder assignments, RACI, and reporting levels for a specific project."""
    pkey = project_key.upper().strip()
    data = _read_project_stakeholders()

    new_assignments = [a.model_dump(exclude_unset=False) for a in payload.assignments]
    data[pkey] = new_assignments

    _write_project_stakeholders(data)
    _sync_stakeholders_projects_field(data)

    return {
        "saved": True,
        "project_key": pkey,
        "assignments": new_assignments
    }
