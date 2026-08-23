#!/usr/bin/env python3
"""
check_compliance.py — Audits Definition of Ready (DoR) and Definition of Done (DoD) compliance.
Outputs compact JSON summary with hygiene scores and violation lists.
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
    issues, sprints = [], []
    try:
        from src.jira_ai.ingestion.models import SessionLocal, Issue, Sprint
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
                    "story_points": i.story_points,
                    "team": i.team,
                    "assignee": i.assignee,
                    "sprint": i.sprint,
                    "epic_key": i.epic_key,
                }
                for i in db_issues
            ]
            sprints = [
                {"name": s.name, "state": s.state}
                for s in db.query(Sprint).all()
            ]
        db.close()
    except Exception:
        pass

    if not issues:
        from src.jira_ai.seeder.synthetic_dataset import build_synthetic_dataset
        data = build_synthetic_dataset()
        issues = data["issues"]
        sprints = data["sprints"]
        if project_key and project_key.upper() not in ("ALL", "GLOBAL"):
            issues = [i for i in issues if i["key"].startswith(f"{project_key.upper()}-")]

    return issues, sprints


def audit_compliance(issues, sprints):
    active_sprint = next((s for s in sprints if s.get("state") == "active"), None)
    active_name = active_sprint["name"] if active_sprint else None

    dor_violations = []
    dod_violations = []
    team_violations = defaultdict(int)
    team_issue_counts = defaultdict(int)

    for i in issues:
        tm = i.get("team") or "Unassigned"
        team_issue_counts[tm] += 1

        # 1. DoR: Unestimated active sprint items
        if i.get("sprint") == active_name and i.get("issue_type") != "Epic":
            if i.get("story_points") is None or i.get("story_points") == 0:
                dor_violations.append({
                    "key": i["key"],
                    "summary": i.get("summary"),
                    "team": tm,
                    "violation": "UNESTIMATED_IN_ACTIVE_SPRINT",
                })
                team_violations[tm] += 1

            if not i.get("assignee"):
                dor_violations.append({
                    "key": i["key"],
                    "summary": i.get("summary"),
                    "team": tm,
                    "violation": "UNASSIGNED_ACTIVE_TICKET",
                })
                team_violations[tm] += 1

        # 2. DoD / Hygiene: Missing team assignment
        if not i.get("team") and i.get("issue_type") != "Epic":
            dod_violations.append({
                "key": i["key"],
                "summary": i.get("summary"),
                "violation": "MISSING_SQUAD_ASSIGNMENT",
            })
            team_violations["Unassigned"] += 1

    # Team hygiene score
    hygiene_scores = []
    for tm, total_cnt in team_issue_counts.items():
        v_cnt = team_violations[tm]
        score = max(0, round((1.0 - (v_cnt / total_cnt)) * 100, 1)) if total_cnt > 0 else 100.0
        hygiene_scores.append({
            "team": tm,
            "total_issues": total_cnt,
            "violations_count": v_cnt,
            "hygiene_compliance_pct": score,
        })

    hygiene_scores.sort(key=lambda x: x["hygiene_compliance_pct"])

    return {
        "active_sprint_audited": active_name,
        "total_dor_violations": len(dor_violations),
        "dor_violations_sample": dor_violations[:6],
        "total_dod_hygiene_violations": len(dod_violations),
        "squad_hygiene_scores": hygiene_scores,
    }


def main():
    parser = argparse.ArgumentParser(description="Audit Jira compliance against DoR and DoD.")
    parser.add_argument("--project-key", default=None, help="Filter by project key prefix")
    args = parser.parse_args()

    issues, sprints = load_dataset(args.project_key)
    result = audit_compliance(issues, sprints)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
