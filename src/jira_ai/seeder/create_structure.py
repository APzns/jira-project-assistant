"""
create_structure.py — Sub-stage A: create the M0 fix-version and the 8 epics.

Team-managed project (id 10034). Epic issue type id = 10045.
Children are linked to epics later (Sub-stage B) via the `parent` field.
Each epic is tagged with its milestone fix-version at creation.

Run once:
    python -m src.jira_ai.seeder.create_structure
"""

import requests
from src.jira_ai.ingestion.jira_client import (
    BASE_URL, _auth_header, PROJECT_KEY, fetch_project_versions,
)

PROJECT_ID = "10034"
EPIC_TYPE_ID = "10045"


# --- M0 version to create (M1/M2/M3 already exist) ---------------------------
NEW_VERSIONS = ["M0 - Preparation"]

# --- 8 epics: (summary, milestone-name-prefix) ------------------------------
EPICS = [
    ("Discovery & Requirements", "M0"),
    ("Architecture & Setup",     "M0"),
    ("Checkout Redesign",        "M1"),
    ("Security & Compliance",    "M2"),
    ("Core Launch Features",     "M3"),
    ("Integration & Migration",  "M3"),
    ("Hardening & UAT",          "M3"),
    ("Launch & Go-Live",         "M3"),
]


def _create_version(name: str) -> None:
    r = requests.post(f"{BASE_URL}/rest/api/3/version", headers=_auth_header(),
                      json={"name": name, "projectId": int(PROJECT_ID)})
    if r.status_code >= 400:
        print(f"  !! version '{name}' failed: {r.status_code} {r.text[:200]}")
    else:
        print(f"  version created: {name} (id={r.json().get('id')})")


def _version_map() -> dict:
    """Map milestone prefix -> version name, from live project versions."""
    out = {}
    for v in fetch_project_versions():
        for pref in ("M0", "M1", "M2", "M3"):
            if v["name"].startswith(pref):
                out[pref] = v["name"]
    return out


def _create_epic(summary: str, version_name: str | None) -> str | None:
    fields = {
        "project": {"id": PROJECT_ID},
        "issuetype": {"id": EPIC_TYPE_ID},
        "summary": summary,
    }
    if version_name:
        fields["fixVersions"] = [{"name": version_name}]
    r = requests.post(f"{BASE_URL}/rest/api/3/issue", headers=_auth_header(),
                      json={"fields": fields})
    if r.status_code >= 400:
        print(f"  !! epic '{summary}' failed: {r.status_code} {r.text[:250]}")
        return None
    key = r.json().get("key")
    print(f"  epic created: {key}  {summary}  [{version_name}]")
    return key


def main() -> None:
    print("Creating versions...")
    for name in NEW_VERSIONS:
        _create_version(name)

    vmap = _version_map()
    print("version map:", vmap)

    print("Creating epics...")
    created = {}
    for summary, pref in EPICS:
        vname = vmap.get(pref)
        if vname is None:
            print(f"  !! no version for prefix {pref}; creating epic without version")
        key = _create_epic(summary, vname)
        if key:
            created[summary] = key

    print("\nEpic keys (save these for Sub-stage B):")
    for summary, key in created.items():
        print(f"  {key}  <- {summary}")


if __name__ == "__main__":
    main()
