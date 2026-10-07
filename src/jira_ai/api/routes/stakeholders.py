"""stakeholders.py — /stakeholders endpoint: read, write, and manage stakeholder profiles with user ownership & permissions."""

import base64
import json
import os
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

router = APIRouter(prefix="/stakeholders", tags=["stakeholders"])

_STAKEHOLDERS_FILE = Path(__file__).resolve().parents[4] / ".agents" / "settings" / "stakeholders.json"
_PROJECT_STAKEHOLDERS_FILE = Path(__file__).resolve().parents[4] / ".agents" / "settings" / "project_stakeholders.json"


def _sync_project_stakeholders_for_stakeholder(stakeholder_id: str, assigned_projects: list[str]) -> None:
    """Ensure project_stakeholders.json matches assigned projects for this stakeholder."""
    try:
        if not _PROJECT_STAKEHOLDERS_FILE.exists():
            return
        raw = _PROJECT_STAKEHOLDERS_FILE.read_text(encoding="utf-8")
        data = json.loads(raw)
        if not isinstance(data, dict):
            return

        target_projects = set(assigned_projects or [])
        modified = False

        # Add to assigned projects if missing
        for pkey in target_projects:
            if pkey not in data:
                data[pkey] = []
            proj_assignments = data[pkey]
            if not any(a.get("stakeholder_id") == stakeholder_id for a in proj_assignments):
                proj_assignments.append({
                    "stakeholder_id": stakeholder_id,
                    "raci": "C",
                    "reporting_level": "standard",
                    "project_notes": ""
                })
                modified = True

        # Remove from unassigned projects
        for pkey, assignments in list(data.items()):
            if pkey not in target_projects:
                orig_len = len(assignments)
                data[pkey] = [a for a in assignments if a.get("stakeholder_id") != stakeholder_id]
                if len(data[pkey]) != orig_len:
                    modified = True

        if modified:
            _PROJECT_STAKEHOLDERS_FILE.write_text(
                json.dumps(data, indent=2, ensure_ascii=False),
                encoding="utf-8"
            )
    except Exception as exc:
        print(f"Warning: Could not sync project stakeholders: {exc}")


def _remove_from_project_stakeholders(stakeholder_id: str) -> None:
    """Remove a deleted stakeholder from all project assignments in project_stakeholders.json."""
    try:
        if not _PROJECT_STAKEHOLDERS_FILE.exists():
            return
        raw = _PROJECT_STAKEHOLDERS_FILE.read_text(encoding="utf-8")
        data = json.loads(raw)
        if not isinstance(data, dict):
            return

        modified = False
        for pkey, assignments in list(data.items()):
            orig_len = len(assignments)
            data[pkey] = [a for a in assignments if a.get("stakeholder_id") != stakeholder_id]
            if len(data[pkey]) != orig_len:
                modified = True

        if modified:
            _PROJECT_STAKEHOLDERS_FILE.write_text(
                json.dumps(data, indent=2, ensure_ascii=False),
                encoding="utf-8"
            )
    except Exception as exc:
        print(f"Warning: Could not remove stakeholder from project stakeholders: {exc}")


DEFAULT_STAKEHOLDERS = [
    {
        "id": "pm-default",
        "role": "Project Manager",
        "category": "delivery",
        "role_type": "delivery",
        "owner": "system",
        "is_builtin": True,
        "description": "Focuses on delivery schedules, sprint health, cross-team dependencies, and team velocity.",
        "projects": ["HRZ", "CHK", "CORE", "MOB"],
        "priority_areas": ["velocity", "sprint_health", "blockers"],
        "people": [
            {
                "name": "Alex Mercer",
                "email": "alex.mercer@company.internal"
            },
            {
                "name": "Samantha Reed",
                "email": "samantha.reed@company.internal"
            }
        ]
    },
    {
        "id": "exec",
        "role": "Executive Sponsor",
        "category": "leadership",
        "role_type": "leadership",
        "owner": "system",
        "is_builtin": True,
        "description": "Focuses on high-level strategic milestones, budget, ROI, and major business risks.",
        "projects": ["HRZ"],
        "priority_areas": ["milestones", "risks", "budget"],
        "people": [
            {
                "name": "Elena Rostova",
                "email": "elena.rostova@company.internal"
            },
            {
                "name": "David Sterling",
                "email": "david.sterling@company.internal"
            }
        ]
    },
    {
        "id": "eng-lead",
        "role": "Engineering Lead",
        "category": "engineering",
        "role_type": "engineering",
        "owner": "system",
        "is_builtin": True,
        "description": "Focuses on technical debt, architecture, engineering capacity, and defect ratios.",
        "projects": ["CORE", "CHK"],
        "priority_areas": ["technical_debt", "defect_ratios", "architecture"],
        "people": [
            {
                "name": "Marcus Vance",
                "email": "marcus.vance@company.internal"
            },
            {
                "name": "Priya Sharma",
                "email": "priya.sharma@company.internal"
            }
        ]
    },
    {
        "id": "qa-lead",
        "role": "QA & Release Lead",
        "category": "quality",
        "role_type": "quality",
        "owner": "system",
        "is_builtin": True,
        "description": "Focuses on software quality, defect trends, test automation coverage, and release criteria.",
        "projects": ["MOB", "CHK"],
        "priority_areas": ["quality", "defect_trends", "test_coverage"],
        "people": [
            {
                "name": "Dr. Aris Thorne",
                "email": "aris.thorne@company.internal"
            }
        ]
    },
    {
        "id": "po-commerce",
        "role": "Product Owner",
        "category": "product",
        "role_type": "product",
        "owner": "system",
        "is_builtin": False,
        "description": "Drives checkout user experience, payment gateway conversion, and feature prioritization.",
        "projects": ["CHK"],
        "priority_areas": ["scope", "user_experience", "conversion"],
        "people": [
            {
                "name": "Chloe Lin",
                "email": "chloe.lin@company.internal"
            },
            {
                "name": "Lucas Meyer",
                "email": "lucas.meyer@company.internal"
            }
        ]
    }
]


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


ROLE_TYPE_TO_CATEGORY = {
    "project_manager": "delivery",
    "delivery": "delivery",
    "executive": "leadership",
    "leadership": "leadership",
    "engineering_lead": "engineering",
    "engineering": "engineering",
    "qa_lead": "quality",
    "quality": "quality",
    "product_owner": "product",
    "product": "product",
    "security_lead": "security",
    "security": "security",
    "custom": "other",
    "other": "other",
}


class IndividualPerson(BaseModel):
    name: str
    email: str | None = ""


class StakeholderProfile(BaseModel):
    id: str | None = None
    role: str = "Stakeholder"
    category: str = "other"
    role_type: str = "other"
    owner: str | None = None
    name: str | None = None
    email: str | None = ""
    people: list[IndividualPerson] = Field(default_factory=list)
    is_builtin: bool = False
    description: str | None = ""
    other_notes: str | None = Field(default="", max_length=500)
    projects: list[str] = Field(default_factory=list)
    priority_areas: list[str] = Field(default_factory=list)
    project_override: str | None = None


class StakeholdersData(BaseModel):
    stakeholders: list[StakeholderProfile]


def _read_stakeholders_from_disk() -> dict:
    """Read stakeholders.json or construct a fully-populated default document."""
    try:
        if _STAKEHOLDERS_FILE.exists():
            raw = _STAKEHOLDERS_FILE.read_text(encoding="utf-8")
            data = json.loads(raw)
        else:
            data = {}
    except (FileNotFoundError, json.JSONDecodeError):
        data = {}

    stakeholders = data.get("stakeholders")
    if not stakeholders or not isinstance(stakeholders, list) or len(stakeholders) == 0:
        stakeholders = [dict(s) for s in DEFAULT_STAKEHOLDERS]
        data["stakeholders"] = stakeholders
        _write_stakeholders_to_disk(data)
    else:
        # Normalize fields for backward compatibility
        for s in stakeholders:
            # Normalize domain category & role_type
            cat = s.get("category")
            if not cat:
                cat = ROLE_TYPE_TO_CATEGORY.get(s.get("role_type"), "other")
            else:
                cat = ROLE_TYPE_TO_CATEGORY.get(cat, cat)
            s["category"] = cat
            s["role_type"] = cat

            if "role" not in s or not s["role"]:
                s["role"] = cat.replace("_", " ").title()
            if "projects" not in s:
                s["projects"] = ["HRZ"]
            if "priority_areas" not in s:
                s["priority_areas"] = []
            if "description" not in s:
                s["description"] = s.get("role_description", "")
            if "other_notes" not in s:
                s["other_notes"] = ""
            
            # Ensure owner is set
            if "owner" not in s or not s["owner"]:
                s["owner"] = "system" if s.get("is_builtin") else "demo"

            # Ensure `people` list is populated
            if "people" not in s or not isinstance(s["people"], list) or len(s["people"]) == 0:
                if s.get("name"):
                    s["people"] = [{"name": s["name"], "email": s.get("email", "")}]
                else:
                    s["people"] = []

            # Set top-level name if needed for legacy code
            if not s.get("name") and s.get("role"):
                s["name"] = s["role"]

    return data


def _write_stakeholders_to_disk(doc: dict) -> None:
    _STAKEHOLDERS_FILE.parent.mkdir(parents=True, exist_ok=True)
    _STAKEHOLDERS_FILE.write_text(
        json.dumps(doc, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


@router.get("")
def get_stakeholders(request: Request) -> dict:
    """Return the current stakeholders.json contents along with the current username."""
    data = _read_stakeholders_from_disk()
    current_user = _get_current_username(request)
    return {
        "stakeholders": data.get("stakeholders", []),
        "current_user": current_user,
    }


@router.get("/{stakeholder_id}")
def get_stakeholder(stakeholder_id: str, request: Request) -> dict:
    """Get a single stakeholder role by id."""
    data = _read_stakeholders_from_disk()
    current_user = _get_current_username(request)
    for s in data.get("stakeholders", []):
        if s.get("id") == stakeholder_id:
            return {"stakeholder": s, "current_user": current_user}
    raise HTTPException(status_code=404, detail=f"Stakeholder '{stakeholder_id}' not found")


@router.post("")
def save_stakeholders(payload: StakeholdersData, request: Request) -> dict:
    """Validate and write all stakeholders to disk."""
    try:
        current_user = _get_current_username(request)
        data = payload.model_dump(exclude_unset=False)
        stakeholders = data.get("stakeholders", [])

        for s in stakeholders:
            if not s.get("id"):
                s["id"] = f"sh-{uuid.uuid4().hex[:8]}"
            if not s.get("owner"):
                s["owner"] = current_user

        result_doc = {"stakeholders": stakeholders}
        _write_stakeholders_to_disk(result_doc)
        return {"saved": True, "data": result_doc, "current_user": current_user}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not write stakeholders file: {exc}")


@router.post("/item")
def create_stakeholder(profile: StakeholderProfile, request: Request) -> dict:
    """Create a single new stakeholder role."""
    try:
        current_user = _get_current_username(request)
        data = _read_stakeholders_from_disk()
        stakeholders = data.get("stakeholders", [])

        new_item = profile.model_dump(exclude_unset=False)
        if not new_item.get("id"):
            new_item["id"] = f"sh-{uuid.uuid4().hex[:8]}"

        cat = new_item.get("category")
        if not cat:
            cat = ROLE_TYPE_TO_CATEGORY.get(new_item.get("role_type"), "other")
        else:
            cat = ROLE_TYPE_TO_CATEGORY.get(cat, cat)
        new_item["category"] = cat
        new_item["role_type"] = cat

        if not new_item.get("role"):
            new_item["role"] = cat.replace("_", " ").title()
        if not new_item.get("name"):
            new_item["name"] = new_item["role"]

        new_item["owner"] = current_user
        new_item["is_builtin"] = False

        stakeholders.append(new_item)
        data["stakeholders"] = stakeholders
        _write_stakeholders_to_disk(data)

        if new_item.get("projects"):
            _sync_project_stakeholders_for_stakeholder(new_item["id"], new_item["projects"])

        return {"created": True, "stakeholder": new_item, "current_user": current_user}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not create stakeholder: {exc}")


@router.put("/{stakeholder_id}")
def update_stakeholder(stakeholder_id: str, profile: StakeholderProfile, request: Request) -> dict:
    """Update an existing stakeholder role."""
    current_user = _get_current_username(request)
    data = _read_stakeholders_from_disk()
    stakeholders = data.get("stakeholders", [])

    found_idx = -1
    for idx, s in enumerate(stakeholders):
        if s.get("id") == stakeholder_id:
            found_idx = idx
            break

    if found_idx == -1:
        raise HTTPException(status_code=404, detail=f"Stakeholder '{stakeholder_id}' not found")

    existing = stakeholders[found_idx]
    owner = existing.get("owner") or ("system" if existing.get("is_builtin") else current_user)

    updated_item = profile.model_dump(exclude_unset=False)
    updated_item["id"] = stakeholder_id
    updated_item["owner"] = owner
    updated_item["is_builtin"] = existing.get("is_builtin", False)

    cat = updated_item.get("category")
    if not cat:
        cat = ROLE_TYPE_TO_CATEGORY.get(updated_item.get("role_type"), "other")
    else:
        cat = ROLE_TYPE_TO_CATEGORY.get(cat, cat)
    updated_item["category"] = cat
    updated_item["role_type"] = cat

    if not updated_item.get("role"):
        updated_item["role"] = cat.replace("_", " ").title()
    if not updated_item.get("name"):
        updated_item["name"] = updated_item["role"]

    stakeholders[found_idx] = updated_item
    data["stakeholders"] = stakeholders
    _write_stakeholders_to_disk(data)

    _sync_project_stakeholders_for_stakeholder(stakeholder_id, updated_item.get("projects", []))

    return {"updated": True, "stakeholder": updated_item, "current_user": current_user}


@router.delete("/{stakeholder_id}")
def delete_stakeholder(stakeholder_id: str, request: Request) -> dict:
    """Delete a stakeholder role."""
    current_user = _get_current_username(request)
    data = _read_stakeholders_from_disk()
    stakeholders = data.get("stakeholders", [])

    target_item = None
    for s in stakeholders:
        if s.get("id") == stakeholder_id:
            target_item = s
            break

    if not target_item:
        raise HTTPException(status_code=404, detail=f"Stakeholder '{stakeholder_id}' not found")

    stakeholders = [s for s in stakeholders if s.get("id") != stakeholder_id]
    data["stakeholders"] = stakeholders
    _write_stakeholders_to_disk(data)

    _remove_from_project_stakeholders(stakeholder_id)

    return {"deleted": True, "id": stakeholder_id, "current_user": current_user}


@router.post("/reset")
def reset_stakeholders(request: Request) -> dict:
    """Reset all stakeholders back to default template set."""
    try:
        default_doc = {
            "stakeholders": [dict(s) for s in DEFAULT_STAKEHOLDERS],
        }
        _write_stakeholders_to_disk(default_doc)
        return {"reset": True, "data": default_doc}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not reset stakeholders: {exc}")
