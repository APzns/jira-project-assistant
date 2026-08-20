"""
create_versions.py — Creates FixVersions on Jira and assigns issues.

FixVersions are created via POST /rest/api/3/version with release dates,
then assigned to epics and child issues based on the target project's domain profile.
"""

import argparse
import sys
import time
from datetime import datetime, timedelta, UTC

from src.jira_ai.seeder.jira_common import (
    BASE_URL, get_jira_session, resolve_project_key,
)
from src.jira_ai.seeder.profiles import DomainProfile, get_profile


def _project_id(project_key: str) -> str:
    """FixVersions need the numeric project ID."""
    session = get_jira_session()
    resp = session.get(f"{BASE_URL}/rest/api/3/project/{project_key}", timeout=25)
    resp.raise_for_status()
    return resp.json()["id"]


def create_version(name: str, release_date: str, description: str, project_id: str) -> int:
    """Create a project FixVersion; skip if it already exists."""
    session = get_jira_session()
    payload = {
        "name": name,
        "projectId": int(project_id),
        "description": description,
        "releaseDate": release_date,
    }
    resp = session.post(
        f"{BASE_URL}/rest/api/3/version",
        json=payload,
        timeout=25,
    )
    if resp.status_code >= 300:
        print(f"  (FixVersion '{name}' may already exist: {resp.status_code})")
        return -1
    vid = resp.json().get("id")
    print(f"  FixVersion created: {name} (id {vid}, release date {release_date})")
    return vid


def fetch_epics(project_key: str) -> dict[str, str]:
    """Return {epic_summary: epic_key} for all epics in the project."""
    session = get_jira_session()
    data = session.post(
        f"{BASE_URL}/rest/api/3/search/jql",
        json={"jql": f"project = {project_key} AND issuetype = Epic",
              "fields": ["summary"], "maxResults": 50},
        timeout=25,
    ).json()
    return {i.get("fields", {}).get("summary"): i["key"]
            for i in data.get("issues", [])}


def fetch_issues_with_parent(project_key: str) -> list[tuple[str, str | None]]:
    """Return [(issue_key, parent_epic_key), ...] for all non-epic issues."""
    session = get_jira_session()
    out, token = [], None
    while True:
        payload = {"jql": f"project = {project_key} AND issuetype != Epic",
                   "fields": ["parent"], "maxResults": 100}
        if token:
            payload["nextPageToken"] = token
        data = session.post(f"{BASE_URL}/rest/api/3/search/jql", json=payload, timeout=25).json()
        for i in data.get("issues", []):
            parent = (i.get("fields", {}).get("parent") or {}).get("key")
            out.append((i["key"], parent))
        if data.get("isLast", True) or not data.get("nextPageToken"):
            break
        token = data["nextPageToken"]
    return out


def set_fix_version(issue_key: str, version_name: str) -> None:
    """Set a single FixVersion on an issue."""
    session = get_jira_session()
    resp = session.put(
        f"{BASE_URL}/rest/api/3/issue/{issue_key}",
        json={"fields": {"fixVersions": [{"name": version_name}]}},
        timeout=25,
    )
    if resp.status_code >= 300:
        print(f"  ! {issue_key}: {resp.status_code} {resp.text[:120]}")


def main(project_key: str | None = None, profile_name: str | None = None) -> None:
    parser = argparse.ArgumentParser(description="Create FixVersions and assign issues.")
    parser.add_argument("--project", "-p", default=None, help="Target Jira project key")
    parser.add_argument("--profile", "-t", default=None, help="Domain dataset profile")

    if len(sys.argv) > 1 and sys.argv[0].endswith("create_versions.py"):
        args = parser.parse_args()
        target_key = resolve_project_key(args.project or project_key)
        target_profile_name = args.profile or profile_name
    else:
        target_key = resolve_project_key(project_key)
        target_profile_name = profile_name

    profile = get_profile(target_profile_name or target_key)

    print(f"=== Creating FixVersions for Project [{target_key}] ({profile.name}) ===")
    proj_num_id = _project_id(target_key)
    now = datetime.now(UTC)

    # Create FixVersions
    for vspec in profile.fix_versions:
        r_date = (now + timedelta(days=vspec.days_offset)).strftime("%Y-%m-%d")
        create_version(vspec.name, r_date, vspec.description, proj_num_id)

    # Map epic summary to FixVersion
    epic_summary_to_version = {
        spec.summary: spec.fix_version_name for spec in profile.epics
    }

    # Fetch live epics
    epics = fetch_epics(target_key)
    print(f"Found {len(epics)} epics in project {target_key}.")

    epickey_to_version: dict[str, str] = {}
    for summ, key in epics.items():
        vname = epic_summary_to_version.get(summ)
        if vname:
            epickey_to_version[key] = vname
            # Also set the fix version on the epic issue itself
            set_fix_version(key, vname)

    # Assign each child issue the FixVersion of its parent epic
    issues = fetch_issues_with_parent(target_key)
    assigned = 0
    for issue_key, parent in issues:
        vname = epickey_to_version.get(parent) if parent else None
        if vname:
            set_fix_version(issue_key, vname)
            assigned += 1
            if assigned % 20 == 0:
                print(f"  Assigned FixVersion to {assigned}/{len(issues)} issues")
        time.sleep(0.02)

    print(f"\nDone. Assigned FixVersions to {assigned}/{len(issues)} issues in project {target_key}.")


if __name__ == "__main__":
    main()
