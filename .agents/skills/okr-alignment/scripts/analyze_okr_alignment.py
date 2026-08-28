#!/usr/bin/env python3
"""
analyze_okr_alignment.py — Maps Jira epics and story points to strategic OKR pillars.
Outputs compact JSON summary.
"""

import sys
import json
import argparse
from pathlib import Path
from collections import defaultdict

PROJECT_ROOT = Path(__file__).resolve().parents[4]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


# Standard Strategic Program Pillars / OKRs for Horizon
OKR_PILLARS = {
    "OKR-1: Modernize Checkout & Conversion": ["Checkout", "Payment", "Cart", "Conversion"],
    "OKR-2: Enterprise Security & Compliance": ["Security", "Compliance", "Audit", "Auth", "GDPR"],
    "OKR-3: Platform Scalability & Performance": ["Platform", "Migration", "Architecture", "API", "Gateway", "Data"],
    "OKR-4: Mobile & Growth Acceleration": ["Mobile", "Notification", "Growth", "User"],
}


def load_dataset(project_key=None):
    issues = []
    try:
        from src.jira_ai.ingestion.models import SessionLocal, Issue
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
                    "status_category": i.status_category,
                    "story_points": i.story_points or 0,
                    "team": i.team or "Unassigned",
                    "epic_key": i.epic_key,
                }
                for i in db_issues
            ]
        db.close()
    except Exception:
        pass

    if not issues:
        from src.jira_ai.seeder.synthetic_dataset import build_synthetic_dataset
        data = build_synthetic_dataset()
        issues = data["issues"]
        if project_key and project_key.upper() not in ("ALL", "GLOBAL"):
            issues = [i for i in issues if i["key"].startswith(f"{project_key.upper()}-")]

    return issues


def match_okr(issue):
    summary = (issue.get("summary") or "").lower()
    for okr_name, keywords in OKR_PILLARS.items():
        if any(kw.lower() in summary for kw in keywords):
            return okr_name
    return "Unmapped / Non-Aligned Work"


def analyze_okrs(issues):
    total_sp = 0
    okr_stats = defaultdict(lambda: {"total_sp": 0, "done_sp": 0, "issue_count": 0, "teams": set()})
    unaligned_tickets = []

    for issue in issues:
        sp = issue.get("story_points") or 0
        total_sp += sp
        okr = match_okr(issue)
        okr_stats[okr]["total_sp"] += sp
        if issue.get("status_category") == "Done":
            okr_stats[okr]["done_sp"] += sp
        okr_stats[okr]["issue_count"] += 1
        if issue.get("team"):
            okr_stats[okr]["teams"].add(issue["team"])

        if okr == "Unmapped / Non-Aligned Work" and issue.get("issue_type") != "Epic":
            unaligned_tickets.append({
                "key": issue["key"],
                "summary": issue["summary"],
                "team": issue["team"],
                "story_points": sp,
            })

    okr_breakdown = []
    for okr, st in okr_stats.items():
        inv_pct = round((st["total_sp"] / total_sp * 100), 1) if total_sp > 0 else 0.0
        comp_pct = round((st["done_sp"] / st["total_sp"] * 100), 1) if st["total_sp"] > 0 else 0.0
        okr_breakdown.append({
            "okr_pillar": okr,
            "allocated_story_points": st["total_sp"],
            "completed_story_points": st["done_sp"],
            "investment_percentage": inv_pct,
            "completion_percentage": comp_pct,
            "issues_count": st["issue_count"],
            "participating_teams_count": len(st["teams"]),
        })

    okr_breakdown.sort(key=lambda x: x["allocated_story_points"], reverse=True)

    return {
        "total_program_story_points": total_sp,
        "strategic_okr_alignment": okr_breakdown,
        "unaligned_tickets_count": len(unaligned_tickets),
        "unaligned_tickets_sample": unaligned_tickets[:6],
    }


def main():
    parser = argparse.ArgumentParser(description="Analyze strategic alignment against OKRs.")
    parser.add_argument("--project-key", default=None, help="Filter by project key prefix")
    args = parser.parse_args()

    issues = load_dataset(args.project_key)
    result = analyze_okrs(issues)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
