"""reports.py — /reports endpoint: read, write, and manage report templates."""

import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Dict, Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/reports", tags=["reports"])

_REPORTS_FILE = Path(__file__).resolve().parents[4] / ".agents" / "settings" / "reports.json"


class ReportBlock(BaseModel):
    id: str
    block_type: str
    title: str
    enabled: bool = True
    order: int = 1
    pm_commentary: Optional[str] = ""
    chart_prompt: Optional[str] = ""
    config: Optional[Dict[str, Any]] = Field(default_factory=dict)


class ReportTemplate(BaseModel):
    id: Optional[str] = None
    name: str
    description: Optional[str] = ""
    is_default: bool = False
    stakeholder_ids: List[str] = Field(default_factory=lambda: ["pm-default"])
    stakeholder_notes: Optional[str] = ""
    target_deadline: Optional[str] = None
    sprint_cadence_days: int = 14
    focus_teams: List[str] = Field(default_factory=list)
    focus_epics: List[str] = Field(default_factory=list)
    blocks: List[ReportBlock] = Field(default_factory=list)
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class ReportsData(BaseModel):
    templates: List[ReportTemplate]


DEFAULT_TEMPLATES = [
    {
        "id": "report-pm-weekly",
        "name": "Weekly PM Delivery Status (Default)",
        "description": "Standard weekly update focusing on KPIs, velocity, and action plans.",
        "is_default": True,
        "stakeholder_ids": ["pm-default"],
        "stakeholder_notes": "",
        "blocks": [
            {"id": "health_kpis_1", "block_type": "health_kpis", "title": "KPI Health", "enabled": True, "order": 1},
            {"id": "burndown_1", "block_type": "burndown", "title": "Burndown & Velocity", "enabled": True, "order": 2},
            {"id": "dependency_1", "block_type": "dependency_matrix", "title": "Team Dependencies Matrix", "enabled": True, "order": 3},
            {"id": "action_plan_1", "block_type": "action_plan", "title": "P1-P3 Action Plan", "enabled": True, "order": 4}
        ]
    },
    {
        "id": "report-exec-brief",
        "name": "Executive Briefing",
        "description": "High-level summary of program health and major risks.",
        "is_default": True,
        "stakeholder_ids": ["exec", "pm-default"],
        "stakeholder_notes": "",
        "blocks": [
            {"id": "exec_summary_1", "block_type": "executive_summary", "title": "Executive AI Summary", "enabled": True, "order": 1},
            {"id": "milestone_1", "block_type": "milestone_timeline", "title": "Milestone Timeline", "enabled": True, "order": 2}
        ]
    },
    {
        "id": "report-squad-quality",
        "name": "Squad Quality & Defect Deep-Dive",
        "description": "Detailed view on defects, technical debt, and team quality metrics.",
        "is_default": True,
        "stakeholder_ids": ["eng-lead", "qa-lead"],
        "stakeholder_notes": "",
        "blocks": [
            {"id": "quality_defects_1", "block_type": "quality_defects", "title": "Defect Ratio by Team", "enabled": True, "order": 1}
        ]
    }
]


def _read_reports_from_disk() -> dict:
    """Read reports.json or construct a fully-populated default document."""
    try:
        raw = _REPORTS_FILE.read_text(encoding="utf-8")
        data = json.loads(raw)
    except (FileNotFoundError, json.JSONDecodeError):
        data = {}

    templates = data.get("templates")
    if not templates or not isinstance(templates, list):
        templates = [dict(t) for t in DEFAULT_TEMPLATES]
        data["templates"] = templates

    return data


@router.get("")
def get_reports() -> dict:
    """Return the current reports.json contents."""
    return _read_reports_from_disk()


@router.post("")
def save_reports(payload: ReportsData) -> dict:
    """Validate and write reports.json to disk."""
    try:
        data = payload.model_dump(exclude_unset=True)
        templates = data.get("templates", [])

        now = datetime.utcnow().isoformat() + "Z"

        # Ensure every template has an id and timestamps
        for t in templates:
            if not t.get("id"):
                t["id"] = f"report-{uuid.uuid4().hex[:8]}"
                t["created_at"] = now
            t["updated_at"] = now

        result_doc = {
            "templates": templates,
        }

        _REPORTS_FILE.parent.mkdir(parents=True, exist_ok=True)
        _REPORTS_FILE.write_text(
            json.dumps(result_doc, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        return {"saved": True, "data": result_doc}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not write reports file: {exc}")


@router.post("/reset")
def reset_reports() -> dict:
    """Reset all report templates back to factory defaults."""
    try:
        default_doc = {
            "templates": [dict(t) for t in DEFAULT_TEMPLATES],
        }
        _REPORTS_FILE.parent.mkdir(parents=True, exist_ok=True)
        _REPORTS_FILE.write_text(
            json.dumps(default_doc, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        return {"reset": True, "data": default_doc}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not reset reports: {exc}")
