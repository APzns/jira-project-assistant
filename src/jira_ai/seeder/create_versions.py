"""
create_versions.py — Creates Fix Versions (milestones) and assigns issues.

Milestones map to epics by name (stable across re-seeds since epic keys change):
  M1 - Checkout redesign      -> "Checkout redesign" epic
  M2 - Security & compliance  -> "Security & compliance" epic
  M3 - Launch-ready           -> all remaining epics

Fix Versions are project-scoped: created via POST /rest/api/3/version, then set
on each issue's `fixVersions` list. Run after issues and epics exist.

Idempotent: re-running skips versions that already exist (assignment matches
by version name, so it still works).
"""

import requests

from src.jira_ai.seeder.jira_common import BASE_URL, PROJECT_KEY, auth_header

# Milestone name -> list of epic summaries it covers.
# "M3" uses "*" to mean "every epic not claimed by an earlier milestone".
MILESTONES = [
    ("M1 - Checkout redesign",     ["Checkout redesign"]),
    ("M2 - Security & compliance", ["Security & compliance"]),
    ("M3 - Launch-ready",          ["*"]),
]


def _project_id() -> str:
    """Fix Versions need the numeric project ID, not the key."""
    data = requests.get(f"{BASE_URL}/rest/api/3/project/{PROJECT_KEY}",
                        headers=auth_header()).json()
    return data["id"]


def create_version(name: str, project_id: str) -> int:
    """Create a project version (milestone); skip if it already exists.

    Assignment later matches by version name, so an existing version is fine.
    """
    resp = requests.post(
        f"{BASE_URL}/rest/api/3/version",
        headers=auth_header(),
        json={"name": name, "projectId": int(project_id)},
    )
    if resp.status_code >= 300:
        # Likely already exists — not fatal, we assign by name anyway.
        print(f"  (Version '{name}' may already exist: {resp.status_code})")
        return -1
    vid = resp.json()["id"]
    print(f"  Version created: {name} (id {vid})")
    return vid


def fetch_epics() -> dict[str, str]:
    """Return {epic_summary: epic_key} for all epics in the project."""
    data = requests.post(
        f"{BASE_URL}/rest/api/3/search/jql",
        headers=auth_header(),
        json={"jql": f"project = {PROJECT_KEY} AND issuetype = Epic",
              "fields": ["summary"], "maxResults": 50},
    ).json()
    return {i.get("fields", {}).get("summary"): i["key"]
            for i in data.get("issues", [])}


def fetch_issues_with_parent() -> list[tuple[str, str | None]]:
    """Return [(issue_key, parent_epic_key), ...] for all non-epic issues."""
    out, token = [], None
    while True:
        payload = {"jql": f"project = {PROJECT_KEY} AND issuetype != Epic",
                   "fields": ["parent"], "maxResults": 100}
        if token:
            payload["nextPageToken"] = token
        data = requests.post(f"{BASE_URL}/rest/api/3/search/jql",
                            headers=auth_header(), json=payload).json()
        for i in data.get("issues", []):
            parent = (i.get("fields", {}).get("parent") or {}).get("key")
            out.append((i["key"], parent))
        if data.get("isLast", True) or not data.get("nextPageToken"):
            break
        token = data["nextPageToken"]
    return out


def set_fix_version(issue_key: str, version_name: str) -> None:
    """Set a single fix version on an issue (replaces existing)."""
    resp = requests.put(
        f"{BASE_URL}/rest/api/3/issue/{issue_key}",
        headers=auth_header(),
        json={"fields": {"fixVersions": [{"name": version_name}]}},
    )
    if resp.status_code >= 300:
        print(f"  ! {issue_key}: {resp.status_code} {resp.text[:120]}")


def main() -> None:
    print("=== Creating Fix Versions (milestones) ===")
    project_id = _project_id()

    # Create the three versions (skips any that already exist).
    for name, _ in MILESTONES:
        create_version(name, project_id)

    # Map each epic summary -> the milestone name that owns it.
    epics = fetch_epics()          # {summary: key}
    print(f"Found {len(epics)} epics.")

    claimed = set()
    epickey_to_milestone: dict[str, str] = {}
    for name, summaries in MILESTONES:
        if summaries == ["*"]:
            continue
        for summ in summaries:
            key = epics.get(summ)
            if key:
                epickey_to_milestone[key] = name
                claimed.add(key)
    # M3 catch-all: every epic not already claimed.
    catch_all = next((n for n, s in MILESTONES if s == ["*"]), None)
    if catch_all:
        for summ, key in epics.items():
            if key not in claimed:
                epickey_to_milestone[key] = catch_all

    # Assign each issue the milestone of its parent epic. Orphans get no version.
    issues = fetch_issues_with_parent()
    assigned = 0
    for issue_key, parent in issues:
        milestone = epickey_to_milestone.get(parent) if parent else None
        if milestone:
            set_fix_version(issue_key, milestone)
            assigned += 1
    print(f"\nDone. Assigned {assigned}/{len(issues)} issues to milestones.")


if __name__ == "__main__":
    main()
