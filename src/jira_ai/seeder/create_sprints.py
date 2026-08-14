"""
create_sprints.py — Creates sprints on the board and assigns issues to them.

Builds a realistic mix: two past sprints taken through the full lifecycle
(future -> active -> closed) with past dates, one currently active sprint,
and one future sprint. Issues are distributed across sprints so the database
later shows per-sprint scope, completion, and velocity data.

Sprints are created via the Agile API (/rest/agile/1.0). A sprint is always
created in 'future' state, then transitioned by updating its state. The PUT
update does a FULL replace, so name/goal/dates must be included on every
transition or Jira rejects it.

The board ID is auto-detected from the project key, so this works across
instances without hardcoding.
"""

import random
import requests
from datetime import datetime, timedelta, UTC

from src.jira_ai.seeder.jira_common import BASE_URL, PROJECT_KEY, auth_header

# Roughly how many issues to place in each sprint. Remaining issues stay in
# the backlog (no sprint) for realism.
ISSUES_PER_SPRINT = 30


def discover_board_id() -> int:
    """Find the board ID for the project via the Agile API.

    Avoids hardcoding: looks up boards filtered by project key and returns
    the first one. Raises if none found.
    """
    resp = requests.get(
        f"{BASE_URL}/rest/agile/1.0/board",
        headers=auth_header(),
        params={"projectKeyOrId": PROJECT_KEY},
    )
    resp.raise_for_status()
    boards = resp.json().get("values", [])
    if not boards:
        raise RuntimeError(f"No board found for project '{PROJECT_KEY}'.")
    board = boards[0]
    print(f"  Using board: {board['name']} (id {board['id']})")
    return board["id"]


def _iso(dt: datetime) -> str:
    """Format a datetime as the ISO string the Agile API expects."""
    return dt.strftime("%Y-%m-%dT%H:%M:%S.000+0000")


def create_sprint(name: str, start: datetime, end: datetime, goal: str,
                  board_id: int) -> int:
    """Create a future sprint and return its numeric ID."""
    payload = {
        "name": name,
        "originBoardId": board_id,
        "startDate": _iso(start),
        "endDate": _iso(end),
        "goal": goal,
    }
    resp = requests.post(f"{BASE_URL}/rest/agile/1.0/sprint",
                        headers=auth_header(), json=payload)
    resp.raise_for_status()
    sprint_id = resp.json()["id"]
    print(f"  Sprint created: {name} (id {sprint_id})")
    return sprint_id


def set_sprint_state(sprint_id: int, name: str, state: str,
                     start: datetime, end: datetime, goal: str) -> None:
    """
    Transition a sprint's state. The PUT endpoint does a FULL replace, so
    name/goal/dates must always be included or Jira returns
    'Sprint name is required'. 'active' needs dates; 'closed' needs the
    sprint to already be active.
    """
    payload = {
        "name": name,
        "state": state,
        "startDate": _iso(start),
        "endDate": _iso(end),
        "goal": goal,
    }
    resp = requests.put(f"{BASE_URL}/rest/agile/1.0/sprint/{sprint_id}",
                       headers=auth_header(), json=payload)
    if resp.status_code >= 300:
        print(f"    ! Could not set state '{state}': {resp.status_code} {resp.text}")
    else:
        print(f"    -> state set to '{state}'")


def move_issues_to_sprint(sprint_id: int, issue_keys: list[str]) -> None:
    """Assign a batch of issues to a sprint (max 50 per API call)."""
    for i in range(0, len(issue_keys), 50):
        batch = issue_keys[i:i + 50]
        resp = requests.post(
            f"{BASE_URL}/rest/agile/1.0/sprint/{sprint_id}/issue",
            headers=auth_header(),
            json={"issues": batch},
        )
        if resp.status_code >= 300:
            print(f"    ! Move failed: {resp.status_code} {resp.text}")
        else:
            print(f"    -> moved {len(batch)} issues into sprint {sprint_id}")


def fetch_all_issue_keys() -> list[str]:
    """Return keys of all non-epic issues (epics don't go in sprints)."""
    keys: list[str] = []
    next_token = None
    while True:
        payload = {
            "jql": f"project = {PROJECT_KEY} AND issuetype != Epic",
            "fields": ["key"],
            "maxResults": 100,
        }
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


def main() -> None:
    print("=== Creating sprints and assigning issues ===")
    board_id = discover_board_id()
    now = datetime.now(UTC)

    all_keys = fetch_all_issue_keys()
    random.shuffle(all_keys)
    print(f"Distributing from {len(all_keys)} non-epic issues.\n")
    pool = iter(all_keys)

    def take(n: int) -> list[str]:
        result = []
        for _ in range(n):
            try:
                result.append(next(pool))
            except StopIteration:
                break
        return result

    # --- Sprint 1: closed, 4 weeks ago -> 2 weeks ago ---
    s1s, s1e = now - timedelta(days=28), now - timedelta(days=14)
    s1 = create_sprint("Sprint 1", s1s, s1e, "Foundation work", board_id)
    move_issues_to_sprint(s1, take(ISSUES_PER_SPRINT))
    set_sprint_state(s1, "Sprint 1", "active", s1s, s1e, "Foundation work")
    set_sprint_state(s1, "Sprint 1", "closed", s1s, s1e, "Foundation work")

    # --- Sprint 2: closed, 2 weeks ago -> yesterday ---
    s2s, s2e = now - timedelta(days=14), now - timedelta(days=1)
    s2 = create_sprint("Sprint 2", s2s, s2e, "Core features", board_id)
    move_issues_to_sprint(s2, take(ISSUES_PER_SPRINT))
    set_sprint_state(s2, "Sprint 2", "active", s2s, s2e, "Core features")
    set_sprint_state(s2, "Sprint 2", "closed", s2s, s2e, "Core features")

    # --- Sprint 3: currently active, now -> 2 weeks ahead ---
    s3s, s3e = now, now + timedelta(days=13)
    s3 = create_sprint("Sprint 3", s3s, s3e, "Dashboard & AI", board_id)
    move_issues_to_sprint(s3, take(ISSUES_PER_SPRINT))
    set_sprint_state(s3, "Sprint 3", "active", s3s, s3e, "Dashboard & AI")

    # --- Sprint 4: future, starts in 2 weeks ---
    s4s, s4e = now + timedelta(days=14), now + timedelta(days=28)
    s4 = create_sprint("Sprint 4", s4s, s4e, "Polish & release", board_id)
    move_issues_to_sprint(s4, take(ISSUES_PER_SPRINT))

    print("\nDone. Created 4 sprints (2 closed, 1 active, 1 future).")


if __name__ == "__main__":
    main()
