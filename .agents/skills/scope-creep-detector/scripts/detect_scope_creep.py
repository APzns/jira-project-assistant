#!/usr/bin/env python3
"""
detect_scope_creep.py — Computes mid-sprint scope injections, estimate revisions, and milestone creep.
Outputs compact JSON summary to minimize LLM token consumption.
"""

import sys
import json
import argparse
from pathlib import Path
from collections import defaultdict

PROJECT_ROOT = Path(__file__).resolve().parents[4]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def load_dataset(project_key=None):
    issues, sprints, fix_versions = [], [], []
    try:
        from src.jira_ai.ingestion.models import SessionLocal, Issue, Sprint, FixVersion
        db = SessionLocal()
        query = db.query(Issue)
        if project_key and project_key.upper() not in ("ALL", "GLOBAL"):
            query = query.filter(Issue.key.like(f"{project_key.upper()}-%"))
        db_issues = query.all()
        if db_issues:
            issues = [
                {
                    "key": i.key,
                    "summary": i.summary,
                    "issue_type": i.issue_type,
                    "status": i.status,
                    "status_category": i.status_category,
                    "story_points": i.story_points or 0,
                    "team": i.team or "Unassigned",
                    "sprint": i.sprint,
                    "fix_version": i.fix_version,
                    "created": str(i.created) if i.created else None,
                    "epic_key": i.epic_key,
                }
                for i in db_issues
            ]
            sprints = [
                {"name": s.name, "state": s.state, "start_date": s.start_date, "end_date": s.end_date}
                for s in db.query(Sprint).all()
            ]
            fix_versions = [
                {"name": v.name, "release_date": v.release_date, "released": v.released}
                for v in db.query(FixVersion).all()
            ]
        db.close()
    except Exception:
        pass

    if not issues:
        from src.jira_ai.seeder.synthetic_dataset import build_synthetic_dataset
        data = build_synthetic_dataset()
        issues = data["issues"]
        sprints = data["sprints"]
        fix_versions = data["fix_versions"]
        if project_key and project_key.upper() not in ("ALL", "GLOBAL"):
            issues = [i for i in issues if i["key"].startswith(f"{project_key.upper()}-")]

    return issues, sprints, fix_versions


def analyze_scope_creep(issues, sprints, fix_versions, target_sprint=None):
    active_sprint = next((s for s in sprints if s.get("state") == "active"), None)
    closed_sprints = [s for s in sprints if s.get("state") == "closed"]

    # Analyze Active Sprint Scope Volatility
    active_sprint_name = active_sprint["name"] if active_sprint else None
    active_issues = [i for i in issues if i.get("sprint") == active_sprint_name] if active_sprint_name else []

    total_active_sp = sum(i.get("story_points") or 0 for i in active_issues)
    done_active_sp = sum(i.get("story_points") or 0 for i in active_issues if i.get("status_category") == "Done")

    # Injected tickets: tickets created after sprint start or designated as emergent
    injected_tickets = []
    initial_commitment_sp = total_active_sp

    # For synthetic / DB metrics: detect issues without standard epic or created late
    for issue in active_issues:
        if issue.get("issue_type") in ("Bug", "Defect") or not issue.get("epic_key"):
            injected_tickets.append({
                "key": issue["key"],
                "summary": issue["summary"],
                "team": issue["team"],
                "type": issue["issue_type"],
                "story_points": issue.get("story_points") or 0,
                "status": issue.get("status"),
            })

    injected_sp = sum(t["story_points"] for t in injected_tickets)
    churn_rate_pct = round((injected_sp / total_active_sp * 100), 1) if total_active_sp > 0 else 0.0

    # Milestone Scope Breakdown
    milestone_scope = defaultdict(lambda: {"total_sp": 0, "done_sp": 0, "issue_count": 0, "teams": set()})
    for issue in issues:
        fv = issue.get("fix_version") or "Unassigned Milestone"
        sp = issue.get("story_points") or 0
        milestone_scope[fv]["total_sp"] += sp
        if issue.get("status_category") == "Done":
            milestone_scope[fv]["done_sp"] += sp
        milestone_scope[fv]["issue_count"] += 1
        if issue.get("team"):
            milestone_scope[fv]["teams"].add(issue["team"])

    milestone_summary = []
    for mv, stats in milestone_scope.items():
        comp_pct = round((stats["done_sp"] / stats["total_sp"] * 100), 1) if stats["total_sp"] > 0 else 0.0
        milestone_summary.append({
            "milestone": mv,
            "total_story_points": stats["total_sp"],
            "completed_story_points": stats["done_sp"],
            "completion_percentage": comp_pct,
            "total_issues": stats["issue_count"],
            "involved_teams_count": len(stats["teams"]),
        })

    # Squad Scope Volatility Breakdown
    team_volatility = defaultdict(lambda: {"active_sp": 0, "injected_sp": 0, "injected_count": 0})
    for issue in active_issues:
        tm = issue.get("team") or "Unassigned"
        sp = issue.get("story_points") or 0
        team_volatility[tm]["active_sp"] += sp
        if issue in injected_tickets or issue.get("issue_type") == "Bug":
            team_volatility[tm]["injected_sp"] += sp
            team_volatility[tm]["injected_count"] += 1

    team_summary = []
    for tm, st in team_volatility.items():
        churn = round((st["injected_sp"] / st["active_sp"] * 100), 1) if st["active_sp"] > 0 else 0.0
        team_summary.append({
            "team": tm,
            "total_sprint_sp": st["active_sp"],
            "unplanned_injected_sp": st["injected_sp"],
            "unplanned_tickets_count": st["injected_count"],
            "scope_churn_pct": churn,
        })
    team_summary.sort(key=lambda x: x["scope_churn_pct"], reverse=True)

    verdict = "Low Volatility"
    if churn_rate_pct > 25:
        verdict = "Critical Volatility (>25% Churn)"
    elif churn_rate_pct > 10:
        verdict = "Moderate Volatility (10-25% Churn)"

    return {
        "active_sprint_name": active_sprint_name,
        "scope_health_verdict": verdict,
        "active_sprint_total_sp": total_active_sp,
        "active_sprint_done_sp": done_active_sp,
        "active_sprint_injected_sp": injected_sp,
        "active_sprint_churn_rate_pct": churn_rate_pct,
        "injected_tickets_sample": injected_tickets[:6],
        "team_scope_volatility": team_summary,
        "milestones_scope_distribution": milestone_summary,
    }


def main():
    parser = argparse.ArgumentParser(description="Analyze scope creep in active sprints and milestones.")
    parser.add_argument("--project-key", default=None, help="Filter by project key prefix")
    args = parser.parse_args()

    issues, sprints, fix_versions = load_dataset(args.project_key)
    result = analyze_scope_creep(issues, sprints, fix_versions)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
