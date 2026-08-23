#!/usr/bin/env python3
"""
generate_release_notes.py — Extracts and clusters completed issues for release notes generation.
Outputs compact JSON summary categorized by audience tiers.
"""

import sys
import json
import argparse
from pathlib import Path
from collections import defaultdict

PROJECT_ROOT = Path(__file__).resolve().parents[4]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def load_dataset(target_version=None, project_key=None):
    issues, fix_versions = [], []
    try:
        from src.jira_ai.ingestion.models import SessionLocal, Issue, FixVersion
        db = SessionLocal()
        query = db.query(Issue)
        if project_key and project_key.upper() not in ("ALL", "GLOBAL"):
            query = query.filter(Issue.key.like(f"{project_key.upper()}-%"))
        if target_version:
            query = query.filter(Issue.fix_version == target_version)
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
                    "fix_version": i.fix_version,
                    "epic_key": i.epic_key,
                }
                for i in db_issues
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
        fix_versions = data["fix_versions"]
        if target_version:
            issues = [i for i in issues if i.get("fix_version") == target_version]
        if project_key and project_key.upper() not in ("ALL", "GLOBAL"):
            issues = [i for i in issues if i["key"].startswith(f"{project_key.upper()}-")]

    return issues, fix_versions


def extract_release_data(issues, fix_versions, target_version=None):
    # Focus on Done issues (or all if specified version)
    done_issues = [i for i in issues if i.get("status_category") == "Done"]
    # If no Done issues for this target version, take active completed scope
    if not done_issues:
        done_issues = [i for i in issues if i.get("status") in ("Done", "In Progress")]

    features = []
    bug_fixes = []
    technical_changes = []

    for i in done_issues:
        itype = (i.get("issue_type") or "").lower()
        summary = (i.get("summary") or "").lower()

        item = {
            "key": i["key"],
            "summary": i["summary"],
            "team": i["team"],
            "story_points": i.get("story_points") or 0,
        }

        if "bug" in itype or "defect" in itype or "fix" in summary:
            bug_fixes.append(item)
        elif "refactor" in summary or "migrate" in summary or "api" in summary or "infra" in summary or "security" in summary:
            technical_changes.append(item)
        else:
            features.append(item)

    total_done_sp = sum(i.get("story_points") or 0 for i in done_issues)

    return {
        "target_release_version": target_version or (issues[0].get("fix_version") if issues else "All Completed Releases"),
        "total_completed_issues": len(done_issues),
        "total_completed_story_points": total_done_sp,
        "executive_highlights_count": len(features),
        "features": features[:10],
        "bug_fixes": bug_fixes[:10],
        "technical_improvements": technical_changes[:10],
    }


def main():
    parser = argparse.ArgumentParser(description="Extract release notes data for Jira fix versions.")
    parser.add_argument("--version", default="M0 - Preparation", help="Target Fix Version name")
    parser.add_argument("--project-key", default=None, help="Filter by project key prefix")
    args = parser.parse_args()

    issues, fix_versions = load_dataset(args.version, args.project_key)
    result = extract_release_data(issues, fix_versions, args.version)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
