"""
jira_client.py — Thin wrapper around the Jira Cloud REST API for reading issues.

Uses the current /rest/api/3/search/jql endpoint with cursor-based pagination.
Discovers instance-specific custom field IDs (story points, sprint, team) at runtime.
"""

import os
import base64
import requests
from dotenv import load_dotenv

load_dotenv()

BASE_URL = os.environ["JIRA_BASE_URL"].rstrip("/")
EMAIL = os.environ["JIRA_EMAIL"]
API_TOKEN = os.environ["JIRA_API_TOKEN"]
PROJECT_KEY = os.environ["JIRA_PROJECT_KEY"]

# Agile board that owns the project's sprints.
BOARD_ID = 35


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


def fetch_all_issues(custom_fields: dict) -> list[dict]:
    """
    Fetch every issue in the project, including the discovered custom fields.
    Handles cursor pagination via nextPageToken.
    """
    fields = ["summary", "issuetype", "status", "priority", "parent",
              "assignee", "created", "updated", "resolutiondate",
              "duedate", "fixVersions", "labels", "issuelinks"]
    fields.extend(custom_fields.values())

    issues: list[dict] = []
    next_page_token = None
    jql = f"project = {PROJECT_KEY} ORDER BY created ASC"

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

def fetch_project_versions() -> list[dict]:
    """
    Fetch all project versions with release dates.
    Uses the paginated /version endpoint (releaseDate is an ISO "YYYY-MM-DD"
    string here, unlike the non-paginated /versions endpoint which returns epoch ms).
    """
    versions: list[dict] = []
    start_at = 0
    while True:
        resp = requests.get(
            f"{BASE_URL}/rest/api/3/project/{PROJECT_KEY}/version",
            headers=_auth_header(),
            params={"startAt": start_at, "maxResults": 50,
                    "orderBy": "releaseDate"},
        )
        resp.raise_for_status()
        data = resp.json()
        batch = data.get("values", [])
        versions.extend(batch)
        print(f"  Fetched {len(batch)} versions (total so far: {len(versions)})")
        if data.get("isLast", True):
            break
        start_at += len(batch)
    return versions


def fetch_sprints() -> list[dict]:
    """
    Fetch all sprints for the board via the Agile API.
    Each sprint dict includes id, name, state, startDate, endDate,
    originBoardId, and (optionally) goal. Handles startAt pagination.
    """
    sprints: list[dict] = []
    start_at = 0
    while True:
        resp = requests.get(
            f"{BASE_URL}/rest/agile/1.0/board/{BOARD_ID}/sprint",
            headers=_auth_header(),
            params={"startAt": start_at, "maxResults": 50},
        )
        resp.raise_for_status()
        data = resp.json()
        batch = data.get("values", [])
        sprints.extend(batch)
        print(f"  Fetched {len(batch)} sprints (total so far: {len(sprints)})")
        if data.get("isLast", True):
            break
        start_at += len(batch)
    return sprints
