"""
enrich_issues.py — Adds due dates and story points to EXISTING Jira issues.

Reads all issues in the project and updates them in place (no new issues are
created). Due dates are spread across past and future to produce realistic
"overdue", "upcoming", and "completed on time" metrics later.
"""

import random
import requests
from datetime import datetime, timedelta, UTC

from src.jira_ai.seeder.jira_common import (
    BASE_URL, PROJECT_KEY, auth_header, find_story_points_field_id,
)

# Fibonacci-style story point values, as commonly used in agile estimation.
STORY_POINT_VALUES = [1, 2, 3, 5, 8, 13]


def fetch_all_issue_keys() -> list[str]:
    """Return the keys of every issue in the project (cursor pagination)."""
    keys: list[str] = []
    next_token = None
    while True:
        payload = {"jql": f"project = {PROJECT_KEY}", "fields": ["key"], "maxResults": 100}
        if next_token:
            payload["nextPageToken"] = next_token
        resp = requests.post(f"{BASE_URL}/rest/api/3/search/jql",
                             headers=auth_header(), json=payload)
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


def main() -> None:
    print("=== Enriching issues with due dates and story points ===")
    sp_field = find_story_points_field_id()
    if sp_field:
        print(f"Story points field detected: {sp_field}")
    else:
        print("! Story points field not found — only due dates will be set.")

    keys = fetch_all_issue_keys()
    print(f"Found {len(keys)} issues to enrich.")

    updated = 0
    for key in keys:
        fields = {"duedate": random_due_date()}
        if sp_field:
            fields[sp_field] = random.choice(STORY_POINT_VALUES)

        resp = requests.put(
            f"{BASE_URL}/rest/api/3/issue/{key}",
            headers=auth_header(),
            json={"fields": fields},
        )
        if resp.status_code >= 300:
            print(f"  ! {key}: {resp.status_code} {resp.text}")
            continue
        updated += 1
        print(f"  Updated {key}")

    print(f"\nDone. Enriched {updated}/{len(keys)} issues.")


if __name__ == "__main__":
    main()
