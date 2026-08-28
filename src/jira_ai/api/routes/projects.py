"""projects.py — /projects endpoint: manage project lifecycle (CRUD, archive, delete) and project-specific stakeholder assignments & RACI matrix."""

import base64
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

router = APIRouter(prefix="/projects", tags=["projects"])

_PROJECTS_FILE = Path(__file__).resolve().parents[4] / ".agents" / "settings" / "projects.json"
_PROJECT_STAKEHOLDERS_FILE = Path(__file__).resolve().parents[4] / ".agents" / "settings" / "project_stakeholders.json"
_STAKEHOLDERS_FILE = Path(__file__).resolve().parents[4] / ".agents" / "settings" / "stakeholders.json"

DEFAULT_PROJECTS = [
    {
        "key": "CHK",
        "name": "Checkout & Commerce Flow",
        "description": "Redesigning the global checkout flow with one-click purchase, localized currencies, and multi-gateway failover resilience.",
        "lead": "Alex Mercer",
        "target_release": "Q4 2026 (v2.4)",
        "status": "at-risk",
        "progress_pct": 68,
        "progress_sp": "340 / 500 SP",
        "blockers_count": 2,
        "tags": ["Payments", "Checkout", "Frontend", "API"],
        "archived": False,
        "owner": "system",
        "is_builtin": True,
        "created_at": "2026-01-10T08:00:00Z",
        "updated_at": "2026-08-15T14:30:00Z",
        "tracking_target": "milestones"
    },
    {
        "key": "CORE",
        "name": "Platform Core & Analytics Foundation",
        "description": "Microservices migration, database horizontal partitioning, real-time Kafka event streaming, and unified program telemetry.",
        "lead": "Marcus Vance",
        "target_release": "Q3 2026 (v3.0)",
        "status": "on-track",
        "progress_pct": 82,
        "progress_sp": "490 / 600 SP",
        "blockers_count": 0,
        "tags": ["Infrastructure", "Analytics", "PostgreSQL", "Kafka"],
        "archived": False,
        "owner": "system",
        "is_builtin": True,
        "created_at": "2026-01-10T08:00:00Z",
        "updated_at": "2026-08-15T14:30:00Z",
        "tracking_target": "milestones"
    },
    {
        "key": "MOB",
        "name": "Mobile Parity & Security Guild",
        "description": "Achieving full iOS & Android feature parity while hardening SOC2, PCI-DSS compliance, and zero-trust SSO authentication.",
        "lead": "Dr. Aris Thorne",
        "target_release": "Q4 2026 (v1.8)",
        "status": "on-track",
        "progress_pct": 54,
        "progress_sp": "215 / 400 SP",
        "blockers_count": 1,
        "tags": ["Mobile", "iOS", "Android", "Security", "Auth0"],
        "archived": False,
        "owner": "system",
        "is_builtin": True,
        "created_at": "2026-01-10T08:00:00Z",
        "updated_at": "2026-08-15T14:30:00Z",
        "tracking_target": "milestones"
    },
    {
        "key": "HRZ",
        "name": "Project Horizon",
        "description": "The overarching program coordinating all enterprise software delivery initiatives, dependency management, and release trains.",
        "lead": "Elena Rostova",
        "target_release": "FY27 Program Go-Live (Delayed)",
        "status": "at-risk",
        "progress_pct": 70,
        "progress_sp": "1045 / 1500 SP",
        "blockers_count": 3,
        "tags": ["Program", "Portfolio", "Delivery", "Horizon"],
        "archived": False,
        "owner": "system",
        "is_builtin": True,
        "created_at": "2026-01-10T08:00:00Z",
        "updated_at": "2026-08-15T14:30:00Z",
        "tracking_target": "milestones"
    }
]

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


def _get_current_username(request: Request) -> str:
    """Extract username from Basic Auth header, defaulting to 'demo'."""
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Basic "):
        try:
            decoded = base64.b64decode(auth_header[6:]).decode("utf-8")
            username, _, _ = decoded.partition(":")
            if username:
                return username.strip()
        except Exception:
            pass
    return os.environ.get("BASIC_AUTH_USER", "demo").strip()


class ProjectStakeholderAssignment(BaseModel):
    stakeholder_id: str
    raci: str = Field(default="C", description="RACI role: R, A, C, or I")
    reporting_level: str = Field(default="standard", description="executive, standard, or technical")
    project_notes: Optional[str] = Field(default="", max_length=500)


class ProjectStakeholdersPayload(BaseModel):
    project_key: str
    assignments: List[ProjectStakeholderAssignment]


class ProjectModel(BaseModel):
    key: str = Field(..., description="Uppercase unique project key, e.g. 'PAY' or 'CHK'")
    name: str = Field(..., description="Project display title")
    description: Optional[str] = ""
    lead: Optional[str] = ""
    target_release: Optional[str] = ""
    status: Optional[str] = "on-track"  # on-track, at-risk, delayed, planning, completed
    progress_pct: Optional[int] = 0
    progress_sp: Optional[str] = "0 / 0 SP"
    blockers_count: Optional[int] = 0
    tags: Optional[List[str]] = Field(default_factory=list)
    archived: Optional[bool] = False
    owner: Optional[str] = None
    is_builtin: Optional[bool] = False
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    tracking_target: Optional[str] = "milestones"


class ProjectCreatePayload(BaseModel):
    key: str = Field(..., min_length=2, max_length=10, description="Uppercase project key (2-10 chars)")
    name: str = Field(..., min_length=2, max_length=120, description="Project name")
    description: Optional[str] = ""
    lead: Optional[str] = ""
    target_release: Optional[str] = ""
    status: Optional[str] = "on-track"
    progress_pct: Optional[int] = 0
    progress_sp: Optional[str] = "0 / 0 SP"
    blockers_count: Optional[int] = 0
    tags: Optional[List[str]] = Field(default_factory=list)
    tracking_target: Optional[str] = "milestones"


class ProjectUpdatePayload(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    lead: Optional[str] = None
    target_release: Optional[str] = None
    status: Optional[str] = None
    progress_pct: Optional[int] = None
    progress_sp: Optional[str] = None
    blockers_count: Optional[int] = None
    tags: Optional[List[str]] = None
    archived: Optional[bool] = None
    tracking_target: Optional[str] = None


def _read_projects_from_disk() -> dict:
    """Read projects.json or construct defaults."""
    try:
        if _PROJECTS_FILE.exists():
            raw = _PROJECTS_FILE.read_text(encoding="utf-8")
            data = json.loads(raw)
            if not isinstance(data, dict):
                data = {}
        else:
            data = {}
    except (FileNotFoundError, json.JSONDecodeError):
        data = {}

    projects = data.get("projects")
    if not projects or not isinstance(projects, list) or len(projects) == 0:
        projects = [dict(p) for p in DEFAULT_PROJECTS]
        data["projects"] = projects
        _write_projects_to_disk(data)

    return data


def _write_projects_to_disk(data: dict) -> None:
    _PROJECTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    _PROJECTS_FILE.write_text(
        json.dumps(data, indent=2, ensure_ascii=False),
        encoding="utf-8"
    )


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


# ---------------------------------------------------------------------------
# Project Lifecycle CRUD & Actions
# ---------------------------------------------------------------------------

@router.get("")
def list_projects(request: Request, include_archived: bool = Query(True, description="Include archived projects in response")) -> dict:
    """List all projects with metadata, status, progress, and archive state."""
    data = _read_projects_from_disk()
    current_user = _get_current_username(request)
    projects = data.get("projects", [])

    if not include_archived:
        projects = [p for p in projects if not p.get("archived", False)]

    return {
        "projects": projects,
        "total": len(projects),
        "current_user": current_user,
    }


@router.get("/stakeholders")
def get_all_project_stakeholders() -> dict:
    """Get all project stakeholder assignments across all projects."""
    data = _read_project_stakeholders()
    return {"projects": data}


@router.get("/{project_key}")
def get_project_detail(project_key: str, request: Request) -> dict:
    """Get detailed project metadata along with assigned stakeholders and RACI matrix."""
    pkey = project_key.upper().strip()
    data = _read_projects_from_disk()
    projects = data.get("projects", [])

    project = next((p for p in projects if p.get("key") == pkey), None)
    if not project:
        raise HTTPException(status_code=404, detail=f"Project '{pkey}' not found")

    sh_data = _read_project_stakeholders()
    assignments = sh_data.get(pkey, [])

    return {
        "project": project,
        "assignments": assignments,
        "current_user": _get_current_username(request)
    }


@router.post("")
def create_project(payload: ProjectCreatePayload, request: Request) -> dict:
    """Create a new project."""
    raw_key = payload.key.upper().strip()
    if not re.match(r"^[A-Z0-9_-]{2,10}$", raw_key):
        raise HTTPException(
            status_code=400,
            detail="Project key must be 2-10 alphanumeric characters (e.g. 'CHK', 'PAY', 'CORE')."
        )

    data = _read_projects_from_disk()
    projects = data.get("projects", [])

    if any(p.get("key") == raw_key for p in projects):
        raise HTTPException(status_code=400, detail=f"Project with key '{raw_key}' already exists.")

    current_user = _get_current_username(request)
    now_iso = datetime.now(timezone.utc).isoformat()

    new_project = {
        "key": raw_key,
        "name": payload.name.strip(),
        "description": payload.description.strip() if payload.description else "",
        "lead": payload.lead.strip() if payload.lead else current_user,
        "target_release": payload.target_release.strip() if payload.target_release else "TBD",
        "status": payload.status or "on-track",
        "progress_pct": max(0, min(100, payload.progress_pct or 0)),
        "progress_sp": payload.progress_sp or "0 / 0 SP",
        "blockers_count": max(0, payload.blockers_count or 0),
        "tags": payload.tags or [],
        "archived": False,
        "owner": current_user,
        "is_builtin": False,
        "created_at": now_iso,
        "updated_at": now_iso,
        "tracking_target": payload.tracking_target or "milestones",
    }

    projects.append(new_project)
    data["projects"] = projects
    _write_projects_to_disk(data)

    # Initialize empty assignment list in project_stakeholders
    sh_data = _read_project_stakeholders()
    if raw_key not in sh_data:
        sh_data[raw_key] = [
            {
                "stakeholder_id": "pm-default",
                "raci": "R",
                "reporting_level": "standard",
                "project_notes": f"Delivery management for {new_project['name']}."
            }
        ]
        _write_project_stakeholders(sh_data)
        _sync_stakeholders_projects_field(sh_data)

    return {
        "created": True,
        "project": new_project
    }


@router.put("/{project_key}")
def update_project(project_key: str, payload: ProjectUpdatePayload, request: Request) -> dict:
    """Update project details."""
    pkey = project_key.upper().strip()
    data = _read_projects_from_disk()
    projects = data.get("projects", [])

    idx = next((i for i, p in enumerate(projects) if p.get("key") == pkey), -1)
    if idx == -1:
        raise HTTPException(status_code=404, detail=f"Project '{pkey}' not found")

    target = dict(projects[idx])
    now_iso = datetime.now(timezone.utc).isoformat()

    if payload.name is not None:
        target["name"] = payload.name.strip()
    if payload.description is not None:
        target["description"] = payload.description.strip()
    if payload.lead is not None:
        target["lead"] = payload.lead.strip()
    if payload.target_release is not None:
        target["target_release"] = payload.target_release.strip()
    if payload.status is not None:
        target["status"] = payload.status
    if payload.progress_pct is not None:
        target["progress_pct"] = max(0, min(100, payload.progress_pct))
    if payload.progress_sp is not None:
        target["progress_sp"] = payload.progress_sp.strip()
    if payload.blockers_count is not None:
        target["blockers_count"] = max(0, payload.blockers_count)
    if payload.tags is not None:
        target["tags"] = payload.tags
    if payload.archived is not None:
        target["archived"] = payload.archived
    if payload.tracking_target is not None:
        target["tracking_target"] = payload.tracking_target

    target["updated_at"] = now_iso

    projects[idx] = target
    data["projects"] = projects
    _write_projects_to_disk(data)

    return {
        "updated": True,
        "project": target
    }


@router.post("/{project_key}/archive")
def archive_project(project_key: str, request: Request) -> dict:
    """Archive a project."""
    pkey = project_key.upper().strip()
    data = _read_projects_from_disk()
    projects = data.get("projects", [])

    idx = next((i for i, p in enumerate(projects) if p.get("key") == pkey), -1)
    if idx == -1:
        raise HTTPException(status_code=404, detail=f"Project '{pkey}' not found")

    projects[idx]["archived"] = True
    projects[idx]["updated_at"] = datetime.now(timezone.utc).isoformat()

    data["projects"] = projects
    _write_projects_to_disk(data)

    return {
        "archived": True,
        "project_key": pkey,
        "project": projects[idx]
    }


@router.post("/{project_key}/unarchive")
def unarchive_project(project_key: str, request: Request) -> dict:
    """Unarchive / restore a project."""
    pkey = project_key.upper().strip()
    data = _read_projects_from_disk()
    projects = data.get("projects", [])

    idx = next((i for i, p in enumerate(projects) if p.get("key") == pkey), -1)
    if idx == -1:
        raise HTTPException(status_code=404, detail=f"Project '{pkey}' not found")

    projects[idx]["archived"] = False
    projects[idx]["updated_at"] = datetime.now(timezone.utc).isoformat()

    data["projects"] = projects
    _write_projects_to_disk(data)

    return {
        "unarchived": True,
        "project_key": pkey,
        "project": projects[idx]
    }


@router.delete("/{project_key}")
def delete_project(project_key: str, request: Request) -> dict:
    """Permanently delete a project and clean up related assignments and stakeholder references."""
    pkey = project_key.upper().strip()
    data = _read_projects_from_disk()
    projects = data.get("projects", [])

    idx = next((i for i, p in enumerate(projects) if p.get("key") == pkey), -1)
    if idx == -1:
        raise HTTPException(status_code=404, detail=f"Project '{pkey}' not found")

    # Remove project
    projects.pop(idx)
    data["projects"] = projects
    _write_projects_to_disk(data)

    # Clean up from project_stakeholders
    sh_data = _read_project_stakeholders()
    if pkey in sh_data:
        del sh_data[pkey]
        _write_project_stakeholders(sh_data)

    # Clean up from stakeholders.json
    _sync_stakeholders_projects_field(sh_data)

    return {
        "deleted": True,
        "project_key": pkey
    }


@router.post("/reset")
def reset_projects(request: Request) -> dict:
    """Reset all projects and assignments back to default template set."""
    try:
        default_data = {
            "projects": [dict(p) for p in DEFAULT_PROJECTS]
        }
        _write_projects_to_disk(default_data)

        default_sh = dict(DEFAULT_PROJECT_STAKEHOLDERS)
        _write_project_stakeholders(default_sh)
        _sync_stakeholders_projects_field(default_sh)

        return {
            "reset": True,
            "data": default_data
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not reset projects: {exc}")


# ---------------------------------------------------------------------------
# Project Stakeholder Assignments & RACI Matrix (Backward-Compatible)
# ---------------------------------------------------------------------------

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
