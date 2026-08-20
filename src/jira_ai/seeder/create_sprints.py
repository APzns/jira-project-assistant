"""
create_sprints.py — Creates sprints on the board and assigns issues to them.

Builds a realistic mix of past, active, and future sprints tailored to
the project's domain profile, auto-discovering the agile board ID for the target project.
"""

import argparse
import random
import sys
import time
from datetime import datetime, timedelta, UTC

from src.jira_ai.seeder.jira_common import (
    BASE_URL, get_jira_session, resolve_project_key,
)
from src.jira_ai.seeder.profiles import DomainProfile, get_profile


def discover_board_id(project_key: str) -> int:
    """Find the board ID for the project via the Agile API."""
    session = get_jira_session()
    resp = session.get(
        f"{BASE_URL}/rest/agile/1.0/board",
        params={"projectKeyOrId": project_key},
        timeout=25,
    )
    resp.raise_for_status()
    boards = resp.json().get("values", [])
    if not boards:
        raise RuntimeError(f"No board found for project '{project_key}'. Check project configuration.")
    board = boards[0]
    print(f"  Using board: {board['name']} (id {board['id']})")
    return board["id"]


def _iso(dt: datetime) -> str:
    """Format a datetime as the ISO string the Agile API expects."""
    return dt.strftime("%Y-%m-%dT%H:%M:%S.000+0000")


def create_sprint(name: str, start: datetime, end: datetime, goal: str, board_id: int) -> int:
    """Create a future sprint and return its numeric ID."""
    session = get_jira_session()
    payload = {
        "name": name,
        "originBoardId": board_id,
        "startDate": _iso(start),
        "endDate": _iso(end),
        "goal": goal,
    }
    resp = session.post(f"{BASE_URL}/rest/agile/1.0/sprint", json=payload, timeout=25)
    resp.raise_for_status()
    sprint_id = resp.json()["id"]
    print(f"  Sprint created: {name} (id {sprint_id})")
    return sprint_id


def set_sprint_state(sprint_id: int, name: str, state: str,
                     start: datetime, end: datetime, goal: str) -> None:
    """Transition a sprint's state via PUT replace."""
    session = get_jira_session()
    payload = {
        "name": name,
        "state": state,
        "startDate": _iso(start),
        "endDate": _iso(end),
        "goal": goal,
    }
    resp = session.put(f"{BASE_URL}/rest/agile/1.0/sprint/{sprint_id}", json=payload, timeout=25)
    if resp.status_code >= 300:
        print(f"    ! Could not set state '{state}': {resp.status_code} {resp.text}")
    else:
        print(f"    -> state set to '{state}'")


def move_issues_to_sprint(sprint_id: int, issue_keys: list[str]) -> None:
    """Assign a batch of issues to a sprint (max 50 per API call)."""
    session = get_jira_session()
    for i in range(0, len(issue_keys), 50):
        batch = issue_keys[i:i + 50]
        resp = session.post(
            f"{BASE_URL}/rest/agile/1.0/sprint/{sprint_id}/issue",
            json={"issues": batch},
            timeout=25,
        )
        if resp.status_code >= 300:
            print(f"    ! Move failed: {resp.status_code} {resp.text}")
        else:
            print(f"    -> moved {len(batch)} issues into sprint {sprint_id}")
        time.sleep(0.05)


def fetch_all_issue_keys(project_key: str) -> list[str]:
    """Return keys of all non-epic issues for the given project."""
    session = get_jira_session()
    keys: list[str] = []
    next_token = None
    while True:
        payload = {
            "jql": f"project = {project_key} AND issuetype != Epic",
            "fields": ["key"],
            "maxResults": 100,
        }
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


def main(project_key: str | None = None, profile_name: str | None = None) -> None:
    parser = argparse.ArgumentParser(description="Create sprints and assign issues.")
    parser.add_argument("--project", "-p", default=None, help="Target Jira project key")
    parser.add_argument("--profile", "-t", default=None, help="Domain dataset profile")

    if len(sys.argv) > 1 and sys.argv[0].endswith("create_sprints.py"):
        args = parser.parse_args()
        target_key = resolve_project_key(args.project or project_key)
        target_profile_name = args.profile or profile_name
    else:
        target_key = resolve_project_key(project_key)
        target_profile_name = profile_name

    profile = get_profile(target_profile_name or target_key)

    print(f"=== Creating sprints for Project [{target_key}] ({profile.name}) ===")
    board_id = discover_board_id(target_key)
    now = datetime.now(UTC)

    all_keys = fetch_all_issue_keys(target_key)
    random.shuffle(all_keys)
    print(f"Distributing from {len(all_keys)} non-epic issues in project {target_key}.\n")
    pool = iter(all_keys)

    def take(n: int) -> list[str]:
        result = []
        for _ in range(n):
            try:
                result.append(next(pool))
            except StopIteration:
                break
        return result

    issues_per_sprint = max(8, len(all_keys) // (len(profile.sprints) + 1))
    for spec in profile.sprints:
        start_date = now + timedelta(weeks=spec.weeks_offset_start)
        end_date = start_date + timedelta(weeks=spec.weeks_duration)

        sprint_id = create_sprint(spec.name, start_date, end_date, spec.goal, board_id)
        batch = take(issues_per_sprint)
        if batch:
            move_issues_to_sprint(sprint_id, batch)

        if spec.state == "closed":
            set_sprint_state(sprint_id, spec.name, "active", start_date, end_date, spec.goal)
            set_sprint_state(sprint_id, spec.name, "closed", start_date, end_date, spec.goal)
        elif spec.state == "active":
            set_sprint_state(sprint_id, spec.name, "active", start_date, end_date, spec.goal)

    print(f"\nDone. Created {len(profile.sprints)} sprints for project {target_key}.")


if __name__ == "__main__":
    main()
