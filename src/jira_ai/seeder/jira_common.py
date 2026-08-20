"""
jira_common.py — Shared Jira auth, resilient session, and field-discovery helpers.
"""

import os
import base64
import time
import requests
from dotenv import load_dotenv
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

load_dotenv()

BASE_URL = os.environ.get("JIRA_BASE_URL", "").rstrip("/")
EMAIL = os.environ.get("JIRA_EMAIL", "")
API_TOKEN = os.environ.get("JIRA_API_TOKEN", "")


def resolve_project_key(cli_arg: str | None = None) -> str:
    """
    Resolve the target Jira project key from CLI flag, falling back to
    JIRA_PROJECT_KEY in environment or raising an informative error.
    """
    key = cli_arg or os.environ.get("JIRA_PROJECT_KEY")
    if not key or not key.strip():
        raise ValueError(
            "No Jira project key specified! Please provide --project <KEY> (e.g. --project PAY) "
            "or set JIRA_PROJECT_KEY in your environment."
        )
    return key.strip().upper()


def auth_header() -> dict:
    """Build a Basic Auth header from email and API token."""
    token = base64.b64encode(f"{EMAIL}:{API_TOKEN}".encode()).decode()
    return {
        "Authorization": f"Basic {token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }


def get_jira_session() -> requests.Session:
    """
    Create a requests Session with automatic retries on rate limits (429)
    and transient connection drops (500, 502, 503, 504).
    """
    session = requests.Session()
    retries = Retry(
        total=5,
        backoff_factor=1.5,
        status_forcelist=[429, 500, 502, 503, 504],
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retries, pool_connections=10, pool_maxsize=20)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    session.headers.update(auth_header())
    return session


def find_story_points_field_id() -> str | None:
    """
    Find the custom field ID for story points.

    Team-managed projects use 'Story point estimate'. We scan all fields and
    match by name, since the numeric ID (e.g. customfield_10016) varies per
    Jira instance.
    """
    session = get_jira_session()
    resp = session.get(f"{BASE_URL}/rest/api/3/field", timeout=20)
    resp.raise_for_status()
    for field in resp.json():
        name = field.get("name", "").lower()
        if name in ("story point estimate", "story points"):
            return field["id"]
    return None
