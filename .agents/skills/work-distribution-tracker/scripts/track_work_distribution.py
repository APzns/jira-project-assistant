#!/usr/bin/env python3
"""
track_work_distribution.py — Analyzes capacity balance across Features, Tech Debt, Bugs, and Maintenance.
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
                    "labels": i.labels or "",
                    "sprint": i.sprint,
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


def categorize_issue(issue):
    itype = (issue.get("issue_type") or "").lower()
    summary = (issue.get("summary") or "").lower()
    labels = (issue.get("labels") or "").lower()

    if "bug" in itype or "defect" in itype or "fix" in summary:
        return "Bugs & Defects"
    elif "refactor" in summary or "debt" in labels or "tech-debt" in labels or "migrate" in summary or "upgrade" in summary:
        return "Technical Debt & Refactoring"
    elif "ops" in labels or "ci/cd" in summary or "setup" in summary or "tooling" in labels or "maintenance" in labels:
        return "Maintenance & Tooling"
    else:
        return "New Features & Enhancements"


def analyze_work_distribution(issues):
    total_sp = 0
    cat_sp = defaultdict(int)
    cat_counts = defaultdict(int)
    squad_cat_sp = defaultdict(lambda: defaultdict(int))
    squad_total_sp = defaultdict(int)
    orphan_work = []

    for issue in issues:
        sp = issue.get("story_points") or 0
        total_sp += sp
        cat = categorize_issue(issue)
        cat_sp[cat] += sp
        cat_counts[cat] += 1

        tm = issue.get("team") or "Unassigned"
        squad_cat_sp[tm][cat] += sp
        squad_total_sp[tm] += sp

        # Detect orphan work (no epic key and not an epic itself)
        if not issue.get("epic_key") and issue.get("issue_type") != "Epic":
            orphan_work.append({
                "key": issue["key"],
                "summary": issue.get("summary"),
                "team": tm,
                "story_points": sp,
                "type": issue.get("issue_type"),
            })

    program_breakdown = []
    for cat, sp in cat_sp.items():
        pct = round((sp / total_sp * 100), 1) if total_sp > 0 else 0.0
        program_breakdown.append({
            "category": cat,
            "story_points": sp,
            "ticket_count": cat_counts[cat],
            "percentage": pct,
        })
    program_breakdown.sort(key=lambda x: x["story_points"], reverse=True)

    squad_breakdown = []
    for tm, st in squad_cat_sp.items():
        tm_total = squad_total_sp[tm]
        feat_sp = st["New Features & Enhancements"]
        debt_sp = st["Technical Debt & Refactoring"]
        bug_sp = st["Bugs & Defects"]
        maint_sp = st["Maintenance & Tooling"]

        squad_breakdown.append({
            "team": tm,
            "total_story_points": tm_total,
            "features_pct": round((feat_sp / tm_total * 100), 1) if tm_total > 0 else 0.0,
            "tech_debt_pct": round((debt_sp / tm_total * 100), 1) if tm_total > 0 else 0.0,
            "bugs_pct": round((bug_sp / tm_total * 100), 1) if tm_total > 0 else 0.0,
            "maintenance_pct": round((maint_sp / tm_total * 100), 1) if tm_total > 0 else 0.0,
        })

    return {
        "total_program_story_points": total_sp,
        "program_investment_split": program_breakdown,
        "squad_investment_split": squad_breakdown,
        "orphan_unaligned_tickets_count": len(orphan_work),
        "orphan_unaligned_tickets_sample": orphan_work[:6],
    }


def main():
    parser = argparse.ArgumentParser(description="Analyze work distribution across feature, tech debt, and bugs.")
    parser.add_argument("--project-key", default=None, help="Filter by project key prefix")
    args = parser.parse_args()

    issues = load_dataset(args.project_key)
    result = analyze_work_distribution(issues)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
