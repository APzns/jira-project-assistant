"""
jira_client.py — Thin wrapper around the Jira Cloud REST API for reading issues.

Uses the current /rest/api/3/search/jql endpoint with cursor-based pagination.
Discovers instance-specific custom field IDs (story points, sprint, team) at runtime,
and dynamically queries across single or multiple project keys.
"""

import os
import base64
import requests
from dotenv import load_dotenv

load_dotenv()

BASE_URL = os.environ.get("JIRA_BASE_URL", "").rstrip("/")
EMAIL = os.environ.get("JIRA_EMAIL", "")
API_TOKEN = os.environ.get("JIRA_API_TOKEN", "")


def _auth_header() -> dict:
    """Build a Basic Auth header from email and API token."""
    token = base64.b64encode(f"{EMAIL}:{API_TOKEN}".encode()).decode()
    return {
        "Authorization": f"Basic {token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }


def discover_custom_fields() -> dict:
    """
    Find instance-specific custom field IDs by name.

    Returns a dict like {"story_points": "customfield_10016",
                         "sprint": "customfield_10020",
                         "team": "customfield_10001"}.
    """
    resp = requests.get(f"{BASE_URL}/rest/api/3/field", headers=_auth_header())
    resp.raise_for_status()
    mapping = {}
    for field in resp.json():
        name = field.get("name", "").lower()
        if name in ("story point estimate", "story points"):
            mapping["story_points"] = field["id"]
        elif name == "sprint":
            mapping["sprint"] = field["id"]
        elif name == "team":
            mapping["team"] = field["id"]
    return mapping


def fetch_all_issues(custom_fields: dict, project_keys: list[str] | str | None = None) -> list[dict]:
    """
    Fetch issues matching the given project key(s) or all accessible issues.
    Handles cursor pagination via nextPageToken.
    """
    fields = ["summary", "issuetype", "status", "priority", "parent",
              "assignee", "created", "updated", "resolutiondate",
              "duedate", "fixVersions", "labels", "issuelinks", "project"]
    fields.extend(custom_fields.values())

    if isinstance(project_keys, str) and project_keys.strip():
        jql = f"project = {project_keys.strip()} ORDER BY created ASC"
    elif isinstance(project_keys, list) and project_keys:
        formatted_keys = ", ".join(k.strip() for k in project_keys if k.strip())
        jql = f"project IN ({formatted_keys}) ORDER BY created ASC"
    else:
        jql = "ORDER BY created ASC"

    print(f"  Executing JQL: {jql}")
    issues: list[dict] = []
    next_page_token = None

    while True:
        payload = {"jql": jql, "fields": fields, "maxResults": 100}
        if next_page_token:
            payload["nextPageToken"] = next_page_token

        response = requests.post(f"{BASE_URL}/rest/api/3/search/jql",
                                headers=_auth_header(), json=payload)
        response.raise_for_status()
        data = response.json()

        batch = data.get("issues", [])
        issues.extend(batch)
        print(f"  Fetched {len(batch)} issues (total so far: {len(issues)})")

        if data.get("isLast", True) or not data.get("nextPageToken"):
            break
        next_page_token = data["nextPageToken"]

    return issues


def fetch_project_versions(project_key: str) -> list[dict]:
    """
    Fetch all FixVersions for a project with release dates.
    Uses the paginated /version endpoint (releaseDate is an ISO 'YYYY-MM-DD' string).
    """
    versions: list[dict] = []
    start_at = 0
    while True:
        resp = requests.get(
            f"{BASE_URL}/rest/api/3/project/{project_key}/version",
            headers=_auth_header(),
            params={"startAt": start_at, "maxResults": 50,
                    "orderBy": "releaseDate"},
        )
        if resp.status_code == 404:
            print(f"  ! Project '{project_key}' not found when fetching versions.")
            return []
        resp.raise_for_status()
        data = resp.json()
        batch = data.get("values", [])
        versions.extend(batch)
        print(f"  Fetched {len(batch)} versions for {project_key} (total: {len(versions)})")
        if data.get("isLast", True):
            break
        start_at += len(batch)
    return versions


def discover_boards_for_project(project_key: str | None = None) -> list[dict]:
    """Discover agile boards, optionally filtered by project key."""
    params = {"maxResults": 50}
    if project_key:
        params["projectKeyOrId"] = project_key

    resp = requests.get(
        f"{BASE_URL}/rest/agile/1.0/board",
        headers=_auth_header(),
        params=params,
    )
    if resp.status_code >= 400:
        return []
    return resp.json().get("values", [])


def fetch_sprints_for_board(board_id: int | str) -> list[dict]:
    """Fetch all sprints for a specific agile board."""
    sprints: list[dict] = []
    start_at = 0
    while True:
        resp = requests.get(
            f"{BASE_URL}/rest/agile/1.0/board/{board_id}/sprint",
            headers=_auth_header(),
            params={"startAt": start_at, "maxResults": 50},
        )
        if resp.status_code >= 400:
            break
        data = resp.json()
        batch = data.get("values", [])
        sprints.extend(batch)
        if data.get("isLast", True) or not batch:
            break
        start_at += len(batch)
    return sprints


def fetch_sprints(board_id: int | str | None = None, project_keys: list[str] | str | None = None) -> list[dict]:
    """
    Fetch all sprints across specified board or project keys.
    """
    if board_id:
        return fetch_sprints_for_board(board_id)

    keys = [project_keys] if isinstance(project_keys, str) else (project_keys or [None])
    seen_boards = set()
    all_sprints: list[dict] = []
    seen_sprint_ids = set()

    for pkey in keys:
        boards = discover_boards_for_project(pkey)
        for b in boards:
            bid = b["id"]
            if bid in seen_boards:
                continue
            seen_boards.add(bid)
            board_sprints = fetch_sprints_for_board(bid)
            for s in board_sprints:
                sid = s.get("id")
                if sid not in seen_sprint_ids:
                    seen_sprint_ids.add(sid)
                    all_sprints.append(s)

    return all_sprints
