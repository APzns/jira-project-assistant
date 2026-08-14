"""engine.py — Core assessment orchestrator and caching service."""

import json
from datetime import datetime, timezone

from src.jira_ai.api.services.context import load_project_context
from src.jira_ai.ingestion.models import AssessmentCache
from src.jira_ai.api.services.assessment.context import _compute_metrics, _synthetic_metrics
from src.jira_ai.api.services.assessment.evaluators import _build_monte_carlo, _forecast_delay_days, _load_risk_lenses
from src.jira_ai.api.services.assessment.prompts import _call_gemini_assessment, _build_fallback_assessment

REAL_CACHE_ID = 1
SYNTHETIC_CACHE_ID = 2


def _save_to_cache(db, assessment: dict, cache_id: int = REAL_CACHE_ID) -> None:
    """Write the latest assessment into the cache row for this mode."""
    row = db.get(AssessmentCache, cache_id)
    payload = json.dumps(assessment, default=str)
    if row is None:
        row = AssessmentCache(id=cache_id, payload=payload,
                              generated_at=datetime.now(timezone.utc).replace(tzinfo=None))
        db.add(row)
    else:
        row.payload = payload
        row.generated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()


def get_cached_assessment(db, mode: str = "real") -> dict | None:
    """Return the last saved assessment for this mode, or None if none yet."""
    cache_id = SYNTHETIC_CACHE_ID if mode == "synthetic" else REAL_CACHE_ID
    row = db.get(AssessmentCache, cache_id)
    if row is None:
        return None
    data = json.loads(row.payload)
    if isinstance(data, dict) and "metrics" in data:
        data["monte_carlo"] = _build_monte_carlo(data["metrics"])
    return data


def assess(db, mode: str = "real") -> dict:
    """Generate or refresh program-status assessment."""
    if mode == "synthetic":
        metrics = _synthetic_metrics()
        cache_id = SYNTHETIC_CACHE_ID
    else:
        metrics = _compute_metrics(db)
        cache_id = REAL_CACHE_ID

    lenses = _load_risk_lenses()
    context = load_project_context()

    prompt = f"""You are an experienced Technical Program Manager writing a
status assessment for stakeholders.

All numbers below were computed by a script and are exact. Your job is to
INTERPRET them and write the commentary — do not compute or invent any figures.

Reason in this order:
1. Review the fixed commitments and milestones in the project charter.
2. Examine the program through the RISK LENSES below. For each lens, decide
   whether there is a risk, how severe it is, and what it implies. Identifying
   and rating risks is YOUR judgment — there are no pre-set verdicts.
3. ALWAYS cross-check the DECISION LOG before flagging anything: if a data
   pattern is explained by a deliberate decision, do NOT call it a risk.
4. For the project-deadline lens, the final milestone is '{metrics.get('project_milestone')}'
   (the one with the latest release date). Judge whether the project will ship
   on time based on its completion and everything feeding it.
5. Every point must carry an implication and, where warranted, an action.

For milestones: base each milestone's status on the MILESTONE COMPLETION data
(completion % plus days-to-release). Use the milestone names exactly as they
appear. Do not invent milestones absent from that data. The statuses must be 'on_track', 'at_risk', or 'delayed'.

CRITICAL FORMATTING INSTRUCTIONS FOR ALL SUMMARIES:
- DO NOT write walls of text or long paragraphs.
- Use Markdown formatting extensively: use bullet points for lists, bold text for key metrics/terms, and keep sentences short, punchy, and highly readable.
- Use emojis (e.g., ⚠️, ✅, 🚨, 📉, 📈) where appropriate to highlight key statuses and metrics.
- Structure your output so it is easy to scan quickly.

For 'ai_summary', write a structured executive summary using standard Markdown bullet points (e.g. starting with `* ` or `- ` on a new line for each item) covering: Overall Verdict, Biggest Risk, and Next Step.

For 'predictability_comment', write 1-2 punchy sentences interpreting the overall predictability percentage: are the teams consistently delivering what they commit to? Is the trend improving, flat, or declining?

For 'predictability_summary', write a structured, insightful analysis using bullet points (NOT paragraphs) evaluating delivery predictability:
- Overall Performance & Deadline Impact: Evaluate the predictability trend and how it impacts upcoming milestones.
- Team Comparison: Compare per-team predictability, explicitly highlighting top performers, struggling teams, and delivery volatility.
- Risks & Root Causes: Synthesize underlying risks—such as upcoming overcommitment, defect ratio drag, or cross-team dependency conflicts.

For 'quality_summary', write a structured, insightful analysis using bullet points (NOT paragraphs) evaluating software quality, defect capacity drag, and bug trends:
- Overall Defect Performance: Interpret the overall defect ratio percentage and capacity drag.
- Sprint & Team Hotspots: Identify specific teams or sprints with elevated defect SP ratios.
- Quality Impact: Evaluate how bug backlog and defect drag affect feature velocity.

For 'quality_actions', write 2-4 actionable next steps suggestions specifically targeting defect reduction, quality improvement, test automation, and bug remediation.

EXAMPLE tone and depth (do not copy verbatim — adapt to the actual data):
- headline: "M2 at risk — compliance work 38% complete with 14 days to release"
- ai_summary: "Project Horizon is at risk. M2 (Security & Compliance) is 38%
  complete with only 14 days until its release date, making on-time delivery
  unlikely without intervention. The single biggest threat is 4 cross-team
  blocking dependencies on the Platform Squad, which cannot clear until Sprint 5.
  The immediate next step is to swarm M2 blockers and reassess M2 scope with
  the Security Lead."
- risk finding: "M2 has 62% of its work items still in To Do or In Progress
  with 14 days to release. At the current velocity of 165 points/sprint, the
  remaining 47 points would take ~0.3 sprints, but 12 of those items are
  blocked by unresolved cross-team dependencies."

Return your assessment in the required structured format.

===== PROJECT CONTEXT =====
Today's Date: {datetime.now(timezone.utc).strftime('%Y-%m-%d')}
{context}

===== RISK LENSES (what to examine — you write the findings) =====
{lenses}

===== METRICS SNAPSHOT (script-computed, exact) =====
{json.dumps(metrics, indent=2, default=str)}
"""

    assessment = _call_gemini_assessment(prompt)

    if assessment is None:
        cached = get_cached_assessment(db, mode=mode)
        if cached and isinstance(cached, dict) and "overall_status" in cached:
            assessment = cached
            assessment["notice"] = "Metrics updated. AI commentary preserved from cached report (LLM temporarily busy)."
        else:
            assessment = _build_fallback_assessment(metrics, mode=mode)
            assessment["notice"] = "Metrics updated. AI commentary generated via deterministic fallback (LLM temporarily busy)."

    assessment.setdefault("predictability_comment", "")
    assessment.setdefault("predictability_summary", "")
    assessment["metrics"] = metrics
    assessment["mode"] = mode
    assessment["generated_at"] = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    assessment["monte_carlo"] = _build_monte_carlo(metrics)
    metrics["forecast_delay_days"] = _forecast_delay_days(metrics)

    overdue_pct = metrics.get("overdue_points_pct", 0)
    milestones_data = metrics.get("milestone_completion", {})
    any_milestone_delayed = False
    for name, info in milestones_data.items():
        pct = info.get("percent_done", 0)
        days = info.get("days_to_release")
        if days is not None and days < 0 and pct < 100:
            any_milestone_delayed = True
            break

    progress_behind = (overdue_pct > 0) or any_milestone_delayed
    mc_behind = metrics.get("forecast_delay_days") is not None and metrics["forecast_delay_days"] > 0

    if mc_behind and progress_behind:
        calculated_status = "delayed"
    elif mc_behind or progress_behind:
        calculated_status = "at_risk"
    else:
        calculated_status = "on_track"

    assessment["overall_status"] = calculated_status

    ms_keys = list(milestones_data.keys())
    has_prior_behind = False
    for ms in assessment.get("milestones", []):
        if ms.get("status") == "off_track":
            ms["status"] = "delayed"
        name = ms.get("name", "")
        if name and ms_keys:
            prefix = name.split()[0].upper() if name.split() else ""
            for db_name in ms_keys:
                if db_name.upper().startswith(prefix):
                    ms["name"] = db_name
                    break

        info = milestones_data.get(ms.get("name"), {})
        pct = info.get("percent_done", 0)
        days = info.get("days_to_release")
        if (days is not None and days < 0 and pct < 100) or ms.get("status") in ("delayed", "at_risk"):
            has_prior_behind = True
        elif has_prior_behind and pct < 100:
            ms["status"] = "at_risk"

    _save_to_cache(db, assessment, cache_id=cache_id)
    return assessment
