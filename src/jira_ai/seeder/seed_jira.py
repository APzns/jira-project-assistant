"""
seed_jira.py — Seeds a Jira Cloud instance with realistic dummy data.

Creates a set of Epics (grouping layer) and a batch of child issues
(Stories/Tasks/Bugs/Features) with a spread of statuses and priorities,
tailored to the target project's domain profile (e-commerce, platform, mobile, AI, fintech).
"""

import argparse
import random
import sys

import requests
from faker import Faker

from src.jira_ai.seeder.jira_common import (
    BASE_URL, auth_header, get_jira_session, resolve_project_key,
)
from src.jira_ai.seeder.profiles import DomainProfile, get_profile

fake = Faker()

NUM_ISSUES = 60               # how many child issues to create (60 per project is fast and realistic)
EPIC_UNASSIGNED_RATE = 0.15    # ~15% of issues stay without an Epic (realism)

PREFERRED_CHILD_TYPES = ["Story", "Task", "Bug", "Feature"]
EPIC_TYPE_NAME = "Epic"

TEAM_FIELD_ID = "customfield_10001"
PRIORITIES = ["Highest", "High", "Medium", "Low", "Lowest"]

IN_PROGRESS_KEYWORDS = ["progress", "review", "doing"]
DONE_KEYWORDS = ["done", "complete", "closed", "resolved"]


_session = None

def get_session():
    global _session
    if _session is None:
        _session = get_jira_session()
    return _session

def api_get(path, **kwargs):
    r = get_session().get(f"{BASE_URL}{path}", timeout=25, **kwargs)
    r.raise_for_status()
    return r.json()


def api_post(path, payload):
    r = get_session().post(f"{BASE_URL}{path}", json=payload, timeout=25)
    if r.status_code >= 300:
        print(f"  ! Error {r.status_code}: {r.text}")
        r.raise_for_status()
    return r.json() if r.text else {}


def adf(text):
    """Jira Cloud accepts descriptions in Atlassian Document Format (ADF)."""
    return {
        "type": "doc",
        "version": 1,
        "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": text}]}
        ],
    }


def discover_issue_types(project_key: str) -> set[str]:
    """Return a set of issue type names available in the target project."""
    data = api_get(
        "/rest/api/3/issue/createmeta",
        params={"projectKeys": project_key, "expand": "projects.issuetypes"},
    )
    projects = data.get("projects", [])
    if not projects:
        raise RuntimeError(
            f"No create metadata for project '{project_key}'. Check the key."
        )
    return {it["name"] for it in projects[0].get("issuetypes", [])}


def count_existing_epics(project_key: str) -> int:
    """Return how many Epic issues already exist in the project."""
    jql = f'project = "{project_key}" AND issuetype = "{EPIC_TYPE_NAME}"'
    data = api_get("/rest/api/3/search/jql", params={"jql": jql, "maxResults": 50})
    return len(data.get("issues", []))


def random_summary(issue_type: str, profile: DomainProfile) -> str:
    """Build a plausible-looking issue summary based on its type and domain profile."""
    if issue_type == "Bug" and profile.bug_topics and random.random() < 0.6:
        return random.choice(profile.bug_topics)

    verbs = profile.verbs.get(issue_type, ["Improve", "Adjust", "Update", "Handle"])
    verb = random.choice(verbs)
    subject = random.choice(profile.subjects)
    return f"{verb} {subject}".capitalize()


def get_available_transitions(issue_key: str) -> dict[str, str]:
    """Return a mapping of transition name -> transition id for an issue."""
    data = api_get(f"/rest/api/3/issue/{issue_key}/transitions")
    return {t["name"]: t["id"] for t in data.get("transitions", [])}


def move_issue_by_keywords(issue_key: str, keywords: list[str]) -> bool:
    """Transition an issue using the first transition matching any keyword."""
    transitions = get_available_transitions(issue_key)
    for name, tid in transitions.items():
        if any(kw in name.lower() for kw in keywords):
            api_post(
                f"/rest/api/3/issue/{issue_key}/transitions",
                {"transition": {"id": tid}},
            )
            return True
    return False


def create_epics(project_key: str, profile: DomainProfile, has_epic_type: bool) -> list[str]:
    """Create Epics tailored to the project profile."""
    if not has_epic_type:
        print("  (Epic type not available in this project — skipping Epics.)")
        return []

    existing = count_existing_epics(project_key)
    if existing:
        raise RuntimeError(
            f"Project already has {existing} Epic(s). Refusing to seed to avoid "
            f"duplicate epics. Delete existing issues first, or use a fresh project."
        )

    epics = []
    for epic_spec in profile.epics:
        fields = {
            "project": {"key": project_key},
            "summary": epic_spec.summary,
            "description": adf(epic_spec.description),
            "issuetype": {"name": EPIC_TYPE_NAME},
            "priority": {"name": random.choice(PRIORITIES)},
        }
        result = api_post("/rest/api/3/issue", {"fields": fields})
        key = result.get("key")
        epics.append(key)
        print(f"  Epic created: {key} — {epic_spec.summary}")
    return epics


def create_issue(project_key: str, index: int, child_types: list[str], epics: list[str], profile: DomainProfile) -> str:
    """Create a single child issue linked to an Epic with profile-tailored attributes."""
    issue_type = random.choice(child_types)

    fields = {
        "project": {"key": project_key},
        "summary": random_summary(issue_type, profile),
        "description": adf(fake.paragraph(nb_sentences=random.randint(2, 5))),
        "issuetype": {"name": issue_type},
        "priority": {"name": random.choice(PRIORITIES)},
        "labels": random.sample(profile.labels, k=min(len(profile.labels), random.randint(0, 2))),
    }

    if epics and random.random() > EPIC_UNASSIGNED_RATE:
        epic_key = random.choice(epics)
        fields["parent"] = {"key": epic_key}

    result = api_post("/rest/api/3/issue", {"fields": fields})
    issue_key = result.get("key")
    parent = fields.get("parent", {}).get("key", "—")
    print(f"[{index + 1}/{NUM_ISSUES}] Created {issue_key} ({issue_type}, epic: {parent})")

    # Status spread: ~50% Done, ~25% In Progress/Review, ~25% stays in start state.
    roll = random.random()
    if roll < 0.50:
        move_issue_by_keywords(issue_key, DONE_KEYWORDS)
    elif roll < 0.75:
        move_issue_by_keywords(issue_key, IN_PROGRESS_KEYWORDS)

    return issue_key


def verify_connection(project_key: str) -> None:
    """Fail fast: confirm credentials and target project before seeding."""
    me = api_get("/rest/api/3/myself")
    print(f"Connected as: {me.get('displayName')} ({me.get('emailAddress')})")
    proj = api_get(f"/rest/api/3/project/{project_key}")
    print(f"Target project: {proj.get('name')} [{proj.get('key')}]")


def resolve_child_types(available: set[str]) -> list[str]:
    """Keep only preferred child types that exist in this project."""
    usable = [t for t in PREFERRED_CHILD_TYPES if t in available]
    if not usable:
        raise RuntimeError(
            f"None of {PREFERRED_CHILD_TYPES} exist. Available: {sorted(available)}"
        )
    return usable


def main(project_key: str | None = None, profile_name: str | None = None) -> list[str]:
    parser = argparse.ArgumentParser(description="Seed a Jira project with realistic dummy data.")
    parser.add_argument("--project", "-p", default=None, help="Target Jira project key (e.g. PAY, CHK, CORE, AIP)")
    parser.add_argument("--profile", "-t", default=None, help="Domain dataset profile (ecommerce, platform, mobile, ai-platform, fintech, general)")

    # If called as script with args, parse them; otherwise use passed parameters
    if len(sys.argv) > 1 and sys.argv[0].endswith("seed_jira.py"):
        args = parser.parse_args()
        target_key = resolve_project_key(args.project or project_key)
        target_profile_name = args.profile or profile_name
    else:
        target_key = resolve_project_key(project_key)
        target_profile_name = profile_name

    profile = get_profile(target_profile_name or target_key)

    print(f"=== Jira Seeder for Project [{target_key}] ===")
    print(f"Using Domain Profile: '{profile.name}' ({profile.display_title})\n")

    verify_connection(target_key)

    available = discover_issue_types(target_key)
    print(f"Available issue types: {sorted(available)}")

    has_epic = EPIC_TYPE_NAME in available
    child_types = resolve_child_types(available)
    print(f"Using child types: {child_types}")
    print(f"Epic grouping: {'enabled' if has_epic else 'disabled'}\n")

    print("Creating Epics (grouping layer)...")
    epics = create_epics(target_key, profile, has_epic)
    print()

    created = 0
    issue_keys = []
    for i in range(NUM_ISSUES):
        try:
            k = create_issue(target_key, i, child_types, epics, profile)
            issue_keys.append(k)
            created += 1
        except Exception as e:
            print(f"  ! Skipped issue {i + 1}: {e}")

    print(f"\nDone. Created {len(epics)} Epics and {created}/{NUM_ISSUES} issues in project {target_key}.")
    return issue_keys


if __name__ == "__main__":
    main()
