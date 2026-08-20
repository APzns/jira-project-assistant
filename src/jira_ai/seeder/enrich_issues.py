"""
enrich_issues.py — Adds due dates and story points to EXISTING Jira issues.

Reads all issues in the project and updates them in place (no new issues are
created). Due dates are spread across past and future to produce realistic
"overdue", "upcoming", and "completed on time" metrics later.
"""

import argparse
import random
import sys
import time
from datetime import datetime, timedelta, UTC

from src.jira_ai.seeder.jira_common import (
    BASE_URL, find_story_points_field_id, get_jira_session, resolve_project_key,
)

# Fibonacci-style story point values, as commonly used in agile estimation.
STORY_POINT_VALUES = [1, 2, 3, 5, 8, 13]


def fetch_all_issue_keys(project_key: str) -> list[str]:
    """Return the keys of every issue in the project (cursor pagination)."""
    session = get_jira_session()
    keys: list[str] = []
    next_token = None
    while True:
        payload = {"jql": f"project = {project_key}", "fields": ["key"], "maxResults": 100}
        if next_token:
            payload["nextPageToken"] = next_token
        resp = session.post(f"{BASE_URL}/rest/api/3/search/jql", json=payload, timeout=25)
        resp.raise_for_status()
        data = resp.json()
        keys.extend(i["key"] for i in data.get("issues", []))
        if data.get("isLast", True) or not data.get("nextPageToken"):
            break
        next_token = data["nextPageToken"]
    return keys


def random_due_date() -> str:
    """
    Return an ISO date somewhere between 60 days ago and 60 days ahead.
    Skewed so a good share fall in the past (to create overdue/completed data).
    """
    offset_days = random.randint(-60, 60)
    date = datetime.now(UTC) + timedelta(days=offset_days)
    return date.strftime("%Y-%m-%d")


def main(project_key: str | None = None) -> None:
    parser = argparse.ArgumentParser(description="Enrich Jira issues with due dates and story points.")
    parser.add_argument("--project", "-p", default=None, help="Target Jira project key")

    if len(sys.argv) > 1 and sys.argv[0].endswith("enrich_issues.py"):
        args = parser.parse_args()
        target_key = resolve_project_key(args.project or project_key)
    else:
        target_key = resolve_project_key(project_key)

    print(f"=== Enriching issues with due dates and story points for [{target_key}] ===")
    sp_field = find_story_points_field_id()
    if sp_field:
        print(f"Story points field detected: {sp_field}")
    else:
        print("! Story points field not found — only due dates will be set.")

    session = get_jira_session()
    keys = fetch_all_issue_keys(target_key)
    print(f"Found {len(keys)} issues to enrich.")

    updated = 0
    for key in keys:
        fields = {"duedate": random_due_date()}
        if sp_field:
            fields[sp_field] = random.choice(STORY_POINT_VALUES)

        try:
            resp = session.put(
                f"{BASE_URL}/rest/api/3/issue/{key}",
                json={"fields": fields},
                timeout=25,
            )
            if resp.status_code >= 300:
                print(f"  ! {key}: {resp.status_code} {resp.text}")
                continue
            updated += 1
            if updated % 15 == 0 or updated == len(keys):
                print(f"  Updated {updated}/{len(keys)} issues ({key})")
        except Exception as e:
            print(f"  ! {key} exception: {e}")
        time.sleep(0.02)

    print(f"\nDone. Enriched {updated}/{len(keys)} issues in project {target_key}.")


if __name__ == "__main__":
    main()
