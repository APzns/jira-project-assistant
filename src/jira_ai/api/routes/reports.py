"""reports.py — /reports endpoint: read, write, and manage report templates."""

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional, Dict, Any

from fastapi import APIRouter, HTTPException, Query
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
    project_scope: Optional[str] = Field(default="ALL", description="Target project key e.g. 'CHK', 'CORE', 'MOB', 'HRZ', or 'ALL'")
    owner: Optional[str] = Field(default="Alex Mercer", description="Owner or creator of the report template")
    cadence: Optional[str] = Field(default="weekly", description="Generation cadence: 'manual', 'daily', 'weekly', 'bi-weekly', 'monthly'")
    last_generated_at: Optional[str] = Field(default=None, description="ISO timestamp of last report generation")
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
        "id": "report-exec-brief",
        "name": "Executive Program Status Briefing",
        "description": "High-level strategic briefing on milestone delivery dates, schedule risks, and key strategic decisions for leadership.",
        "project_scope": "HRZ",
        "owner": "David Kim",
        "cadence": "monthly",
        "last_generated_at": "2026-08-20T14:30:00Z",
        "is_default": False,
        "stakeholder_ids": ["exec", "pm-default"],
        "stakeholder_notes": "Focus on overall milestone delivery dates, business risks, budget/scope tradeoffs, and required executive steering decisions.",
        "blocks": [
            {"id": "exec_summary_1", "block_type": "executive_summary", "title": "Executive AI Summary", "enabled": True, "order": 1},
            {"id": "health_kpis_1", "block_type": "health_kpis", "title": "KPI Health", "enabled": True, "order": 2},
            {"id": "monte_carlo_1", "block_type": "monte_carlo", "title": "Monte Carlo Throughput Forecast", "enabled": True, "order": 3},
            {"id": "action_plan_1", "block_type": "action_plan", "title": "P1-P3 Action Plan", "enabled": True, "order": 4}
        ]
    },
    {
        "id": "report-pm-weekly",
        "name": "Weekly TPM Sprint & Delivery Health",
        "description": "Operational sprint delivery tracking, sprint predictability, capacity drag, burnup velocity, and cross-team dependencies.",
        "project_scope": "CHK",
        "owner": "Alex Mercer",
        "cadence": "weekly",
        "last_generated_at": "2026-08-21T09:15:00Z",
        "is_default": True,
        "stakeholder_ids": ["pm-default"],
        "stakeholder_notes": "Highlight active sprint overcommitments, velocity bottlenecks, carryover risks, and immediate sprint-level action items.",
        "blocks": [
            {"id": "health_kpis_2", "block_type": "health_kpis", "title": "KPI Health", "enabled": True, "order": 1},
            {"id": "burndown_1", "block_type": "burndown", "title": "Burndown & Velocity", "enabled": True, "order": 2},
            {"id": "dependency_1", "block_type": "dependency_matrix", "title": "Team Dependencies Matrix", "enabled": True, "order": 3},
            {"id": "action_plan_2", "block_type": "action_plan", "title": "P1-P3 Action Plan", "enabled": True, "order": 4}
        ]
    },
    {
        "id": "report-dependency-blocker",
        "name": "Cross-Team Dependency & Blocker Matrix",
        "description": "Deep-dive analysis on inter-team dependencies, critical path bottlenecks, upstream blockers, and alignment across squads.",
        "project_scope": "HRZ",
        "owner": "Rachel Green",
        "cadence": "bi-weekly",
        "last_generated_at": "2026-08-18T11:00:00Z",
        "is_default": False,
        "stakeholder_ids": ["pm-default", "eng-lead"],
        "stakeholder_notes": "Emphasize critical path dependencies, cross-team handoffs, and blocker mitigations across squads.",
        "blocks": [
            {"id": "exec_summary_2", "block_type": "executive_summary", "title": "Executive AI Summary", "enabled": True, "order": 1},
            {"id": "dependency_2", "block_type": "dependency_matrix", "title": "Team Dependencies Matrix", "enabled": True, "order": 2},
            {"id": "burndown_2", "block_type": "burndown", "title": "Burndown & Velocity", "enabled": True, "order": 3},
            {"id": "action_plan_3", "block_type": "action_plan", "title": "P1-P3 Action Plan", "enabled": True, "order": 4}
        ]
    },
    {
        "id": "report-squad-quality",
        "name": "Squad Quality & Defect Deep-Dive",
        "description": "Detailed view on defect density, bug escape rates, regression testing load, and engineering technical debt across squads.",
        "project_scope": "CORE",
        "owner": "Marcus Vance",
        "cadence": "weekly",
        "last_generated_at": "2026-08-19T16:45:00Z",
        "is_default": False,
        "stakeholder_ids": ["eng-lead", "qa-lead"],
        "stakeholder_notes": "Focus on team quality benchmarks, defect distribution across squads, and test automation coverage.",
        "blocks": [
            {"id": "health_kpis_3", "block_type": "health_kpis", "title": "KPI Health", "enabled": True, "order": 1},
            {"id": "quality_defects_1", "block_type": "quality_defects", "title": "Defect Ratio by Team", "enabled": True, "order": 2},
            {"id": "dependency_3", "block_type": "dependency_matrix", "title": "Team Dependencies Matrix", "enabled": True, "order": 3},
            {"id": "action_plan_4", "block_type": "action_plan", "title": "P1-P3 Action Plan", "enabled": True, "order": 4}
        ]
    },
    {
        "id": "report-milestone-forecast",
        "name": "Milestone Delivery & Monte Carlo Forecast",
        "description": "Probabilistic delivery forecasting for milestones (M0-M3), Monte Carlo throughput simulations, and completion date ranges.",
        "project_scope": "MOB",
        "owner": "Elena Rostova",
        "cadence": "manual",
        "last_generated_at": "2026-08-15T10:20:00Z",
        "is_default": False,
        "stakeholder_ids": ["exec", "eng-lead", "po-commerce"],
        "stakeholder_notes": "Focus on statistical completion confidence intervals, milestone slippage risk, and capacity forecasting.",
        "blocks": [
            {"id": "exec_summary_3", "block_type": "executive_summary", "title": "Executive AI Summary", "enabled": True, "order": 1},
            {"id": "health_kpis_4", "block_type": "health_kpis", "title": "KPI Health", "enabled": True, "order": 2},
            {"id": "monte_carlo_2", "block_type": "monte_carlo", "title": "Monte Carlo Throughput Forecast", "enabled": True, "order": 3},
            {"id": "burndown_3", "block_type": "burndown", "title": "Burndown & Velocity", "enabled": True, "order": 4},
            {"id": "action_plan_5", "block_type": "action_plan", "title": "P1-P3 Action Plan", "enabled": True, "order": 5}
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
def get_reports(project_key: Optional[str] = Query(None, description="Filter reports by project key or 'ALL'")) -> dict:
    """Return the current reports.json contents, optionally filtered by project_key."""
    data = _read_reports_from_disk()
    templates = data.get("templates", [])

    if project_key:
        pkey = project_key.upper().strip()
        filtered = [
            t for t in templates
            if (t.get("project_scope") or "ALL").upper() == pkey or (t.get("project_scope") or "ALL").upper() == "ALL"
        ]
        return {"templates": filtered, "total": len(filtered)}

    return {"templates": templates, "total": len(templates)}


@router.get("/{template_id}")
def get_single_report(template_id: str) -> dict:
    """Get a single report template by ID."""
    data = _read_reports_from_disk()
    templates = data.get("templates", [])
    for t in templates:
        if t.get("id") == template_id:
            return {"template": t}
    raise HTTPException(status_code=404, detail=f"Report template '{template_id}' not found")


@router.post("")
def save_reports(payload: ReportsData) -> dict:
    """Validate and write reports.json to disk."""
    try:
        data = payload.model_dump(exclude_unset=True)
        templates = data.get("templates", [])

        now = datetime.now(timezone.utc).isoformat()

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


@router.post("/create")
def create_report(template: ReportTemplate) -> dict:
    """Create a new report template."""
    data = _read_reports_from_disk()
    templates = data.get("templates", [])
    now = datetime.now(timezone.utc).isoformat()

    t_dict = template.model_dump(exclude_unset=True)
    if not t_dict.get("id"):
        t_dict["id"] = f"report-{uuid.uuid4().hex[:8]}"
    t_dict["created_at"] = now
    t_dict["updated_at"] = now

    # Check duplicate ID
    if any(t.get("id") == t_dict["id"] for t in templates):
        raise HTTPException(status_code=400, detail=f"Template with ID '{t_dict['id']}' already exists")

    if t_dict.get("is_default"):
        for other in templates:
            other["is_default"] = False

    templates.append(t_dict)
    data["templates"] = templates

    _REPORTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    _REPORTS_FILE.write_text(
        json.dumps(data, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    return {"created": True, "template": t_dict}


@router.put("/{template_id}")
def update_report(template_id: str, template: ReportTemplate) -> dict:
    """Update an existing report template."""
    data = _read_reports_from_disk()
    templates = data.get("templates", [])
    now = datetime.now(timezone.utc).isoformat()

    idx = next((i for i, t in enumerate(templates) if t.get("id") == template_id), None)
    if idx is None:
        raise HTTPException(status_code=404, detail=f"Report template '{template_id}' not found")

    t_dict = template.model_dump(exclude_unset=True)
    t_dict["id"] = template_id
    t_dict["updated_at"] = now
    if "created_at" not in t_dict or not t_dict["created_at"]:
        t_dict["created_at"] = templates[idx].get("created_at", now)

    if t_dict.get("is_default"):
        for i, other in enumerate(templates):
            if i != idx:
                other["is_default"] = False

    templates[idx] = t_dict
    data["templates"] = templates

    _REPORTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    _REPORTS_FILE.write_text(
        json.dumps(data, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    return {"updated": True, "template": t_dict}


@router.delete("/{template_id}")
def delete_report(template_id: str) -> dict:
    """Delete a report template."""
    data = _read_reports_from_disk()
    templates = data.get("templates", [])

    idx = next((i for i, t in enumerate(templates) if t.get("id") == template_id), None)
    if idx is None:
        raise HTTPException(status_code=404, detail=f"Report template '{template_id}' not found")

    deleted = templates.pop(idx)
    data["templates"] = templates

    _REPORTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    _REPORTS_FILE.write_text(
        json.dumps(data, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    return {"deleted": True, "template_id": template_id, "name": deleted.get("name")}


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


class SuggestRequest(BaseModel):
    stakeholder_ids: List[str]
    user_prompt: Optional[str] = None
    chat_history: Optional[List[Dict[str, str]]] = None

@router.post("/suggest")
def suggest_report(payload: SuggestRequest) -> dict:
    """Uses LLM to suggest a report format based on current stakeholders, settings, and user guidance."""
    from src.jira_ai.api.services.llm import suggest_report_template
    result = suggest_report_template(payload.stakeholder_ids, payload.user_prompt, payload.chat_history)
    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])
    return result
