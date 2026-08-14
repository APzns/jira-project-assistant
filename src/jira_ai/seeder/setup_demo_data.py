"""
setup_demo_data.py — One-command setup of the entire demo dataset in Jira.

Runs the full data-population flow in the correct dependency order:

  1. Seed epics and issues            (issues must exist first)
  2. Enrich with due dates + points   (updates the issues in place)
  3. Create sprints and assign issues (sprints need issues to exist)
  4. Create milestones (fix versions) (needs epics + issues to exist)

This is the single entry point for building a fresh demo. Individual step
modules remain available for running a stage in isolation.

Prerequisites that must be configured manually in Jira first:
  - A Scrum, team-managed project (project key set in .env)
  - Estimation / Story Points enabled (Project settings -> Features)

Usage:
  python -m src.jira_ai.seeder.setup_demo_data          # safe: refuses if data exists
  python -m src.jira_ai.seeder.setup_demo_data --force  # run anyway
"""

import sys
import requests

from src.jira_ai.seeder.jira_common import BASE_URL, PROJECT_KEY, auth_header
from src.jira_ai.seeder import (
    seed_jira, enrich_issues, create_sprints, create_versions,
)


def project_has_issues() -> bool:
    """Return True if the project already contains any issues."""
    resp = requests.post(
        f"{BASE_URL}/rest/api/3/search/jql",
        headers=auth_header(),
        json={"jql": f"project = {PROJECT_KEY}", "fields": ["key"], "maxResults": 1},
    )
    resp.raise_for_status()
    return len(resp.json().get("issues", [])) > 0


def main() -> None:
    force = "--force" in sys.argv

    print("=== Demo data setup ===\n")

    # Guard: creating issues is not idempotent, so refuse to run on a project
    # that already has data unless the user explicitly forces it.
    if project_has_issues() and not force:
        print("This project already contains issues.")
        print("Running again would create DUPLICATE issues.")
        print("If you really want to add another full batch, re-run with --force.")
        sys.exit(1)

    # Step 1: create epics and child issues.
    print("--- Step 1/4: Seeding epics and issues ---")
    seed_jira.main()

    # Step 2: enrich existing issues with due dates and story points.
    print("\n--- Step 2/4: Enriching with due dates and story points ---")
    enrich_issues.main()

    # Step 3: create sprints and assign issues to them.
    print("\n--- Step 3/4: Creating sprints and assigning issues ---")
    create_sprints.main()

    # Step 4: create fix versions (milestones) and assign them to issues.
    print("\n--- Step 4/4: Creating milestones (fix versions) ---")
    create_versions.main()

    print("\n=== Demo data setup complete ===")
    print("Next: run ingestion to pull this data into the database:")
    print("  python -m src.jira_ai.ingestion.run_ingestion")


if __name__ == "__main__":
    main()
