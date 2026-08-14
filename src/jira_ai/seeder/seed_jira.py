"""
seed_jira.py — Seeds a Jira Cloud instance with realistic dummy data.

Creates a set of Epics (grouping layer) and a batch of child issues
(Stories/Tasks/Bugs) with a spread of statuses and priorities, so that
downstream dashboards and analytics have meaningful data to show.

This version auto-discovers the project's available issue types, so it
adapts to non-default Jira configurations. Workflow statuses in this
project: To Do (start), In Progress, In Review, Done.

Requirements:
    pip install requests faker python-dotenv

Configuration via environment variables (.env at the project root):
    JIRA_BASE_URL=https://your-domain.atlassian.net
    JIRA_EMAIL=you@email.com
    JIRA_API_TOKEN=xxxxxxxx
    JIRA_PROJECT_KEY=your-scrum-project-key
"""

import os
import random
import base64

import requests
from faker import Faker
from dotenv import load_dotenv

load_dotenv()
fake = Faker()

# --- Configuration --------------------------------------------------------
BASE_URL = os.environ["JIRA_BASE_URL"].rstrip("/")
EMAIL = os.environ["JIRA_EMAIL"]
API_TOKEN = os.environ["JIRA_API_TOKEN"]
PROJECT_KEY = os.environ["JIRA_PROJECT_KEY"]


NUM_ISSUES = 200              # how many child issues to create
NUM_EPICS = 6                  # how many Epics to create as the grouping layer
EPIC_UNASSIGNED_RATE = 0.15    # ~15% of issues stay without an Epic (realism)

# Preferred child types, in priority order. Only those that actually exist
# in this project (discovered at runtime) are used.
PREFERRED_CHILD_TYPES = ["Story", "Task", "Bug", "Feature"]
EPIC_TYPE_NAME = "Epic"

# Jira Team field custom-field ID (discovered earlier via /rest/api/3/field).
TEAM_FIELD_ID = "customfield_10001"

PRIORITIES = ["Highest", "High", "Medium", "Low", "Lowest"]
LABELS = ["tech-debt", "customer", "regression", "quick-win", "spike"]

# Charter epics in fixed order, each paired with the owning team's UUID.
# The first two (Checkout, Security) are referenced by the Decision Log and
# assessment logic, so they are created first for predictable key numbering.
# Team UUIDs come from each team's Atlassian profile page (segment after /team/).
CHARTER_EPICS = [
    ("Checkout redesign",       "ebe47db4-9843-4e5e-9454-2f99d25af498"),  # Checkout Squad
    ("Security & compliance",   "b81b36ee-ab0d-4f17-a9d5-bf2c281fdc80"),  # Security Guild
    ("Performance hardening",   "22e70f64-3e68-4822-a193-92941f5e5f8d"),  # Platform Core
    ("Analytics platform",      "58180c65-f38c-4d13-a0d9-51e8e6916e96"),  # Data Insights
    ("Mobile parity",           "f468534c-469b-4f4d-9736-5ed7e6095466"),  # Mobile Team
    ("Onboarding improvements", "41a9ad46-1e76-4868-ba2f-1c66e91306f3"),  # Growth Squad
]

# Target statuses to move issues toward, matched loosely against the
# workflow's transitions. Statuses: To Do (start), In Progress, In Review, Done.
IN_PROGRESS_KEYWORDS = ["progress", "review", "doing"]
DONE_KEYWORDS = ["done", "complete", "closed", "resolved"]

# --- HTTP client ----------------------------------------------------------

def auth_header():
    """Jira Cloud uses Basic Auth: base64-encoded 'email:token'."""
    raw = f"{EMAIL}:{API_TOKEN}".encode("utf-8")
    token = base64.b64encode(raw).decode("utf-8")
    return {
        "Authorization": f"Basic {token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }

def api_get(path, **kwargs):
    r = requests.get(f"{BASE_URL}{path}", headers=auth_header(), **kwargs)
    r.raise_for_status()
    return r.json()

def api_post(path, payload):
    r = requests.post(f"{BASE_URL}{path}", headers=auth_header(), json=payload)
    if r.status_code >= 300:
        # Jira returns readable validation messages — print them for debugging.
        print(f"  ! Error {r.status_code}: {r.text}")
        r.raise_for_status()
    return r.json() if r.text else {}

# --- Helpers --------------------------------------------------------------

def adf(text):
    """Jira Cloud accepts descriptions in Atlassian Document Format (ADF)."""
    return {
        "type": "doc",
        "version": 1,
        "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": text}]}
        ],
    }

def discover_issue_types():
    """Return a set of issue type names available in the target project."""
    data = api_get(
        "/rest/api/3/issue/createmeta",
        params={"projectKeys": PROJECT_KEY, "expand": "projects.issuetypes"},
    )
    projects = data.get("projects", [])
    if not projects:
        raise RuntimeError(
            f"No create metadata for project '{PROJECT_KEY}'. Check the key."
        )
    return {it["name"] for it in projects[0].get("issuetypes", [])}

def count_existing_epics():
    """Return how many Epic issues already exist in the project.

    Guards against accidental duplicate-epic creation on a re-run — the
    original cause of the Checkout/Security epics appearing under several keys.
    """
    jql = f'project = "{PROJECT_KEY}" AND issuetype = "{EPIC_TYPE_NAME}"'
    data = api_get("/rest/api/3/search/jql", params={"jql": jql, "maxResults": 50})
    return len(data.get("issues", []))


def random_summary(issue_type):
    """Build a plausible-looking issue summary based on its type."""
    verbs = {
        "Bug": ["crashes when", "fails to load", "returns 500 on", "freezes during"],
        "Task": ["refactor", "upgrade", "document", "configure", "clean up"],
        "Story": ["as a user I want to", "enable", "support", "allow"],
        "Feature": ["introduce", "roll out", "build", "launch"],
    }
    fallback = ["improve", "adjust", "handle", "update"]
    verb = random.choice(verbs.get(issue_type, fallback))
    subject = random.choice(
        ["login flow", "payment module", "dashboard", "export feature",
         "search", "notifications", "user profile", "API gateway"]
    )
    return f"{verb} {subject}".capitalize()

def get_available_transitions(issue_key):
    """Return a mapping of transition name -> transition id for an issue."""
    data = api_get(f"/rest/api/3/issue/{issue_key}/transitions")
    return {t["name"]: t["id"] for t in data.get("transitions", [])}

def move_issue_by_keywords(issue_key, keywords):
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

# --- Core logic -----------------------------------------------------------

def create_epics(has_epic_type):
    """Create one Epic per charter theme, in fixed order, each assigned to its
    owning team. Returns a list of (epic_key, team_uuid) tuples so child issues
    can inherit their epic's team.

    Uses CHARTER_EPICS in order (no random sampling) so theme-to-key mapping
    is predictable. Refuses to run if Epics already exist, to avoid the
    duplicate-epic problem caused by seeding a project more than once.
    """
    if not has_epic_type:
        print("  (Epic type not available in this project — skipping Epics.)")
        return []

    existing = count_existing_epics()
    if existing:
        raise RuntimeError(
            f"Project already has {existing} Epic(s). Refusing to seed to avoid "
            f"duplicate epics. Delete existing issues first, or use a fresh project."
        )

    epics = []   # list of (epic_key, team_uuid)
    for theme, team_uuid in CHARTER_EPICS[:NUM_EPICS]:
        fields = {
            "project": {"key": PROJECT_KEY},
            "summary": theme,
            "description": adf(f"Epic grouping work related to: {theme}."),
            "issuetype": {"name": EPIC_TYPE_NAME},
            "priority": {"name": random.choice(PRIORITIES)},
            TEAM_FIELD_ID: team_uuid,
        }
        result = api_post("/rest/api/3/issue", {"fields": fields})
        key = result.get("key")
        epics.append((key, team_uuid))
        print(f"  Epic created: {key} — {theme} (team {team_uuid})")
    return epics

def create_issue(index, child_types, epics):
    """Create a single child issue, optionally linked to an Epic. If linked,
    the issue inherits its Epic's team."""
    issue_type = random.choice(child_types)

    fields = {
        "project": {"key": PROJECT_KEY},
        "summary": random_summary(issue_type),
        "description": adf(fake.paragraph(nb_sentences=random.randint(2, 5))),
        "issuetype": {"name": issue_type},
        "priority": {"name": random.choice(PRIORITIES)},
        "labels": random.sample(LABELS, k=random.randint(0, 2)),
    }

    # Link to an Epic via the 'parent' field, unless this issue stays an orphan.
    # When linked, inherit the epic's team so team data mirrors epic ownership.
    if epics and random.random() > EPIC_UNASSIGNED_RATE:
        epic_key, team_uuid = random.choice(epics)
        fields["parent"] = {"key": epic_key}
        fields[TEAM_FIELD_ID] = team_uuid

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

def verify_connection():
    """Fail fast: confirm credentials and target project before seeding."""
    me = api_get("/rest/api/3/myself")
    print(f"Connected as: {me.get('displayName')} ({me.get('emailAddress')})")
    proj = api_get(f"/rest/api/3/project/{PROJECT_KEY}")
    print(f"Target project: {proj.get('name')} [{proj.get('key')}]")

def resolve_child_types(available):
    """Keep only preferred child types that exist in this project."""
    usable = [t for t in PREFERRED_CHILD_TYPES if t in available]
    if not usable:
        raise RuntimeError(
            f"None of {PREFERRED_CHILD_TYPES} exist. Available: {sorted(available)}"
        )
    return usable

def main():
    print("=== Jira seeder ===")
    verify_connection()

    available = discover_issue_types()
    print(f"Available issue types: {sorted(available)}")

    has_epic = EPIC_TYPE_NAME in available
    child_types = resolve_child_types(available)
    print(f"Using child types: {child_types}")
    print(f"Epic grouping: {'enabled' if has_epic else 'disabled'}\n")

    print("Creating Epics (grouping layer)...")
    epics = create_epics(has_epic)
    print()

    created = 0
    for i in range(NUM_ISSUES):
        try:
            create_issue(i, child_types, epics)
            created += 1
        except Exception as e:
            print(f"  ! Skipped issue {i + 1}: {e}")

    print(f"\nDone. Created {len(epics)} Epics and {created}/{NUM_ISSUES} issues.")

if __name__ == "__main__":
    main()
