"""prompts.py — LLM candidate models, JSON schemas, fallback generator, and Gemini invocation."""

import json
import logging
import os
import time

from google import genai
from src.jira_ai.api.services.assessment.evaluators import _forecast_delay_days

logger = logging.getLogger("jira_ai")

CANDIDATE_MODELS = [
    "gemini-flash-lite-latest",
    "gemini-flash-latest",
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash",
]
MODEL = "gemini-flash-lite-latest"

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
            logger.warning("Failed to initialize genai.Client: %s", exc)
            return None
    return _client


_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "overall_status": {"type": "string", "enum": ["on_track", "at_risk", "delayed"]},
        "headline": {"type": "string"},
        "reasoning": {"type": "string"},
        "ai_summary": {"type": "string"},
        "predictability_comment": {"type": "string"},
        "predictability_summary": {"type": "string"},
        "telemetry_breakdown": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "metric": {"type": "string"},
                    "value": {"type": "string"},
                    "ai_comment": {"type": "string"}
                },
                "required": ["metric", "value", "ai_comment"]
            }
        },
        "milestones": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "status": {"type": "string", "enum": ["on_track", "at_risk", "delayed"]},
                    "assessment": {"type": "string"},
                },
                "required": ["name", "status", "assessment"],
            },
        },
        "risks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "lens": {"type": "string",
                             "enum": ["milestone_deadline_slip", "project_deadline_slip", "dependency_risk"]},
                    "finding": {"type": "string"},
                    "evidence": {"type": "string"},
                    "severity": {"type": "string", "enum": ["low", "medium", "high", "critical"]},
                },
                "required": ["lens", "finding", "evidence", "severity"],
            },
        },
        "forecast": {"type": "string"},
        "recommended_actions": {"type": "array", "items": {"type": "string"}},
        "quality_summary": {"type": "string"},
        "quality_actions": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["overall_status", "headline", "reasoning", "ai_summary",
                 "predictability_comment", "predictability_summary",
                 "telemetry_breakdown",
                 "quality_summary", "quality_actions",
                 "milestones", "risks", "forecast", "recommended_actions"],
}


def _build_fallback_assessment(metrics: dict, mode: str) -> dict:
    milestones_data = metrics.get("milestone_completion", {})
    ms_list = []
    has_delayed = False
    has_at_risk = False

    for ms_name, info in milestones_data.items():
        pct = info.get("percent_done", 0)
        days = info.get("days_to_release")
        status = "on_track"
        if days is not None and days < 0 and pct < 100:
            status = "delayed"
            has_delayed = True
        elif pct < 50 and (days is not None and days < 30):
            status = "at_risk"
            has_at_risk = True
        elif pct < 80 and (days is not None and days < 14):
            status = "at_risk"
            has_at_risk = True

        ms_list.append({
            "name": ms_name,
            "status": status,
            "assessment": f"Milestone '{ms_name}' is {pct}% complete ({info.get('done', 0)}/{info.get('total', 0)} items done)."
        })

    overdue_pct = metrics.get("overdue_points_pct", 0)
    progress_behind = (overdue_pct > 0) or has_delayed

    forecast_delay_days = _forecast_delay_days(metrics)
    mc_behind = forecast_delay_days is not None and forecast_delay_days > 0

    if mc_behind and progress_behind:
        overall_status = "delayed"
    elif mc_behind or progress_behind:
        overall_status = "at_risk"
    else:
        overall_status = "on_track"

    conflicts = metrics.get("dependency_conflicts", {}).get("count", 0)
    overdue_pct = metrics.get("overdue_points_pct", 0)

    risks = []
    if conflicts > 0:
        risks.append({
            "lens": "dependency_risk",
            "finding": f"Found {conflicts} unresolved dependency conflicts across teams.",
            "evidence": f"{conflicts} items have blockers that are unplanned or scheduled after the dependent item.",
            "severity": "high"
        })
    if overdue_pct > 0:
        risks.append({
            "lens": "milestone_deadline_slip",
            "finding": f"{overdue_pct}% of planned story points are in overdue milestones.",
            "evidence": "Unfinished items remain in versions whose release date has passed.",
            "severity": "medium"
        })

    pred = metrics.get("predictability", {})
    pred_pct = pred.get("pct")
    n_closed = pred.get("n", 0)
    pred_comment = (
        f"Predictability across closed sprints is {pred_pct}% across {n_closed} closed sprint{'s' if n_closed != 1 else ''}."
        if pred_pct is not None else "Predictability data updated."
    )

    team_preds = metrics.get("team_predictability", [])
    valid_team_preds = [t for t in team_preds if t.get("pct") is not None]

    summary_parts = []
    if pred_pct is not None:
        summary_parts.append(f"Overall closed-sprint delivery predictability stands at **{pred_pct}%** across {n_closed} closed sprints.")

    if valid_team_preds:
        best_team = valid_team_preds[0]
        worst_team = valid_team_preds[-1]
        if best_team["team"] == worst_team["team"]:
            summary_parts.append(f"**{best_team['team']}** delivered an average predictability of {best_team['pct']}%.")
        else:
            summary_parts.append(
                f"**{best_team['team']}** leads team predictability at {best_team['pct']}%, "
                f"while **{worst_team['team']}** shows lower predictability at {worst_team['pct']}%."
            )

    oc_teams = [t for t in metrics.get("overcommit_by_team", []) if t.get("pct") and t["pct"] > 0]
    if oc_teams:
        oc_names = ", ".join(f"{t['team']} (+{t['pct']}%)" for t in oc_teams[:2])
        summary_parts.append(f"**Overcommitment Warning**: Upcoming sprint risks overcommitment in {oc_names} relative to historical velocity.")

    dr = metrics.get("defects_ratio", {}).get("pct")
    if dr and dr > 15:
        summary_parts.append(f"**Quality Drag**: High defect capacity drag ({dr}% defect SP ratio) is impacting planned feature velocity.")

    pred_summary = "\n\n".join(summary_parts) if summary_parts else "Sprint completion and velocity data updated from current metrics snapshot."

    bs = metrics.get("bug_stats", {})
    dr_pct = bs.get("defects_ratio_pct")
    if dr_pct is None:
        dr_pct = metrics.get("defects_ratio", {}).get("pct", 0.0)
    open_bugs = bs.get("open", 0)
    closed_bugs = bs.get("closed", 0)
    total_bugs = bs.get("total", open_bugs + closed_bugs)
    defects_per_sprint = bs.get("defects_per_sprint", [])

    q_parts = []
    if dr_pct is not None:
        q_parts.append(f"Overall closed-sprint defect ratio stands at **{dr_pct}%** (Defect SP / Total SP).")

    q_parts.append(f"Tracked defect volume: **{total_bugs} total defects** (**{open_bugs} open**, **{closed_bugs} closed**).")

    if defects_per_sprint:
        sorted_by_ratio = sorted(defects_per_sprint, key=lambda x: x.get("defect_ratio_pct", 0), reverse=True)
        top = sorted_by_ratio[0]
        if top.get("defect_ratio_pct", 0) > 0:
            t_name = top.get("team") or "Unassigned"
            s_name = top.get("sprint") or "Sprint"
            q_parts.append(f"**Highest Defect Hotspot**: **{t_name}** during **{s_name}** reached a **{top.get('defect_ratio_pct')}%** defect ratio ({top.get('bug_sp', 0)} defect SP out of {top.get('total_sp', 0)} total SP).")

    if dr_pct and dr_pct > 15:
        q_parts.append(f"⚠️ **Quality Drag Warning**: High defect ratio ({dr_pct}%) exceeds the 15% threshold, reducing net feature velocity.")
    else:
        q_parts.append(f"✅ **Quality Status**: Defect ratio ({dr_pct}%) is within standard acceptable parameters.")

    quality_summary = "\n\n".join(q_parts)

    quality_actions = []
    if dr_pct and dr_pct > 15:
        quality_actions.append("Conduct bug reduction swarming on high-defect teams to reduce capacity drag below 15%.")
        quality_actions.append("Enforce stricter pre-commit validation and definition-of-done criteria to prevent defect leakage.")
    else:
        quality_actions.append("Maintain existing test automation coverage and continue tracking sprint defect ratios.")
    if open_bugs > 0:
        quality_actions.append(f"Triage and prioritize the remaining {open_bugs} open defect{'s' if open_bugs != 1 else ''} in upcoming sprint planning.")
    quality_actions.append("Review recurring bug categories with team leads to identify test suite gaps.")

    rec_actions = []
    if conflicts > 0:
        rec_actions.append("Resolve cross-team dependency conflicts highlighted in the dependency map.")
    if overdue_pct > 0:
        rec_actions.append("Review overdue fix versions and re-scope or re-assign unfinished work items.")
    if not rec_actions:
        rec_actions.append("Continue tracking sprint velocity and milestone completion against target dates.")

    mc = metrics.get("forecast_monte_carlo", {})
    p80 = mc.get("date_p80", "N/A")
    forecast_text = f"P80 completion estimated at {p80} based on Monte Carlo velocity simulation."

    return {
        "overall_status": overall_status,
        "headline": "Program status assessment calculated from latest metrics",
        "reasoning": "Metrics successfully calculated. AI LLM commentary is temporarily unavailable (Gemini service high demand or rate limit).",
        "ai_summary": f"Program metrics have been updated. Overall status is {overall_status.replace('_', ' ')}. Data reflects {metrics.get('total_issues', 0)} total issues across {len(milestones_data)} milestones.",
        "predictability_comment": pred_comment,
        "predictability_summary": pred_summary,
        "telemetry_breakdown": [
            {
                "metric": "Overall Status",
                "value": overall_status.replace("_", " ").title(),
                "ai_comment": "Based on deterministic metric calculation rules (LLM offline)."
            },
            {
                "metric": "Predictability",
                "value": f"{pred_pct}%" if pred_pct is not None else "N/A",
                "ai_comment": "Average completed vs committed ratio across closed sprints."
            },
            {
                "metric": "Unresolved Defects",
                "value": f"{open_bugs}",
                "ai_comment": "Total open bug tickets currently tracked in the backlog."
            },
            {
                "metric": "Cross-Team Blockers",
                "value": f"{metrics.get('cross_team_blockers', 0)}",
                "ai_comment": "Number of unresolved blocking dependencies between teams."
            },
            {
                "metric": "Scope Delivery",
                "value": f"{100 - overdue_pct}% on track",
                "ai_comment": "Percentage of story points not sitting in overdue milestones."
            }
        ],
        "quality_summary": quality_summary,
        "quality_actions": quality_actions,
        "milestones": ms_list,
        "risks": risks,
        "forecast": forecast_text,
        "recommended_actions": rec_actions,
    }


def _call_gemini_assessment(prompt: str) -> dict | None:
    client = _get_client()
    if not client:
        return None

    timeout_ms = int(os.environ.get("GEMINI_TIMEOUT_MS", "90000"))
    for model_name in CANDIDATE_MODELS:
        for attempt in range(2):
            try:
                resp = client.models.generate_content(
                    model=model_name,
                    contents=prompt,
                    config={
                        "response_mime_type": "application/json",
                        "response_schema": _RESPONSE_SCHEMA,
                        "http_options": {"timeout": timeout_ms},
                    },
                )
                if resp and getattr(resp, "text", None):
                    parsed = json.loads(resp.text)
                    if isinstance(parsed, dict) and "overall_status" in parsed:
                        return parsed
            except Exception as exc:
                logger.warning("Gemini call failed (model=%s, attempt=%d): %s", model_name, attempt + 1, exc)
                time.sleep(0.5)

    return None
