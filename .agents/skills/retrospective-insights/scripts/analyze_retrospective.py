#!/usr/bin/env python3
"""
analyze_retrospective.py — Analyzes sprint spillover, carry-over issues, and stage bottlenecks.
Outputs compact JSON summary for agile retrospectives.
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
                    "story_points": i.story_points or 0,
                    "team": i.team or "Unassigned",
                    "sprint": i.sprint,
                }
                for i in db_issues
            ]
            sprints = [
                {"name": s.name, "state": s.state, "start_date": s.start_date, "end_date": s.end_date}
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


def analyze_retro(issues, sprints):
    closed_sprints = [s for s in sprints if s.get("state") == "closed"]
    active_sprint = next((s for s in sprints if s.get("state") == "active"), None)

    # 1. Closed Sprint Delivery & Spillover
    closed_sprint_stats = []
    for cs in closed_sprints:
        s_name = cs["name"]
        s_issues = [i for i in issues if i.get("sprint") == s_name]
        total_sp = sum(i.get("story_points") or 0 for i in s_issues)
        done_sp = sum(i.get("story_points") or 0 for i in s_issues if i.get("status_category") == "Done")
        spillover_sp = total_sp - done_sp
        pred_pct = round((done_sp / total_sp * 100), 1) if total_sp > 0 else 0.0

        closed_sprint_stats.append({
            "sprint_name": s_name,
            "committed_sp": total_sp,
            "completed_sp": done_sp,
            "spillover_sp": spillover_sp,
            "predictability_pct": pred_pct,
        })

    # 2. Stage Breakdown for Active Sprint
    active_name = active_sprint["name"] if active_sprint else None
    active_issues = [i for i in issues if i.get("sprint") == active_name] if active_name else []

    status_dist = defaultdict(lambda: {"count": 0, "sp": 0})
    for i in active_issues:
        st = i.get("status") or "Unknown"
        sp = i.get("story_points") or 0
        status_dist[st]["count"] += 1
        status_dist[st]["sp"] += sp

    # 3. Squad Performance & Quality Drag
    squad_stats = defaultdict(lambda: {"total_sp": 0, "done_sp": 0, "bug_sp": 0, "issues_count": 0})
    for i in active_issues:
        tm = i.get("team") or "Unassigned"
        sp = i.get("story_points") or 0
        squad_stats[tm]["total_sp"] += sp
        squad_stats[tm]["issues_count"] += 1
        if i.get("status_category") == "Done":
            squad_stats[tm]["done_sp"] += sp
        if i.get("issue_type") in ("Bug", "Defect"):
            squad_stats[tm]["bug_sp"] += sp

    squad_summary = []
    for tm, st in squad_stats.items():
        bug_ratio = round((st["bug_sp"] / st["total_sp"] * 100), 1) if st["total_sp"] > 0 else 0.0
        squad_summary.append({
            "team": tm,
            "active_sp": st["total_sp"],
            "done_sp": st["done_sp"],
            "bug_sp": st["bug_sp"],
            "defect_drag_pct": bug_ratio,
        })
    squad_summary.sort(key=lambda x: x["defect_drag_pct"], reverse=True)

    return {
        "closed_sprints_summary": closed_sprint_stats,
        "active_sprint_name": active_name,
        "active_sprint_stage_distribution": dict(status_dist),
        "squad_quality_drag": squad_summary,
    }


def main():
    parser = argparse.ArgumentParser(description="Analyze retrospective metrics and bottlenecks.")
    parser.add_argument("--project-key", default=None, help="Filter by project key prefix")
    args = parser.parse_args()

    issues, sprints = load_dataset(args.project_key)
    result = analyze_retro(issues, sprints)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
