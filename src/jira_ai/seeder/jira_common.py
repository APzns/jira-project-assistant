"""
jira_common.py — Shared Jira auth and field-discovery helpers for seeder scripts.
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


def auth_header() -> dict:
    """Build a Basic Auth header from email and API token."""
    token = base64.b64encode(f"{EMAIL}:{API_TOKEN}".encode()).decode()
    return {
        "Authorization": f"Basic {token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }


def find_story_points_field_id() -> str | None:
    """
    Find the custom field ID for story points.

    Team-managed projects use 'Story point estimate'. We scan all fields and
    match by name, since the numeric ID (e.g. customfield_10016) varies per
    Jira instance.
    """
    resp = requests.get(f"{BASE_URL}/rest/api/3/field", headers=auth_header())
    resp.raise_for_status()
    for field in resp.json():
        name = field.get("name", "").lower()
        if name in ("story point estimate", "story points"):
            return field["id"]
    return None
