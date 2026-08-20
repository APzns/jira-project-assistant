"""
setup_demo_data.py — One-command setup of demo datasets in Jira.

Runs the full data-population flow in the correct dependency order:

  1. Seed epics and issues            (issues must exist first)
  2. Enrich with due dates + points   (updates the issues in place)
  3. Create sprints and assign issues (sprints need issues to exist)
  4. Create FixVersions               (needs epics + issues to exist)

Usage:
  python -m src.jira_ai.seeder.setup_demo_data --project PAY
  python -m src.jira_ai.seeder.setup_demo_data --project AIP --profile ai-platform
  python -m src.jira_ai.seeder.setup_demo_data --project CHK --force
"""

import argparse
import sys
import requests

from src.jira_ai.seeder.jira_common import BASE_URL, auth_header, resolve_project_key
from src.jira_ai.seeder.profiles import get_profile
from src.jira_ai.seeder import (
    seed_jira, enrich_issues, create_sprints, create_versions,
)


def project_has_issues(project_key: str) -> bool:
    """Return True if the project already contains any issues."""
    resp = requests.post(
        f"{BASE_URL}/rest/api/3/search/jql",
        headers=auth_header(),
        json={"jql": f"project = {project_key}", "fields": ["key"], "maxResults": 1},
    )
    resp.raise_for_status()
    return len(resp.json().get("issues", [])) > 0


def main() -> None:
    parser = argparse.ArgumentParser(description="One-command Jira demo dataset setup.")
    parser.add_argument("--project", "-p", default=None, help="Target Jira project key (e.g. PAY, AIP, CHK, CORE, MOB)")
    parser.add_argument("--profile", "-t", default=None, help="Domain profile (ecommerce, platform, mobile, ai-platform, fintech, general)")
    parser.add_argument("--force", "-f", action="store_true", help="Force run even if project already has issues")

    args = parser.parse_args()

    target_key = resolve_project_key(args.project)
    profile = get_profile(args.profile or target_key)

    print(f"=== Demo Data Setup for Project [{target_key}] ===")
    print(f"Domain Profile: '{profile.name}' ({profile.display_title})\n")

    # Guard: creating issues is not idempotent, so refuse to run on a project
    # that already has data unless the user explicitly forces it.
    if project_has_issues(target_key) and not args.force:
        print(f"Project '{target_key}' already contains issues.")
        print("Running again would create duplicate issues.")
        print("To seed anyway, re-run with --force:")
        print(f"  python -m src.jira_ai.seeder.setup_demo_data --project {target_key} --force")
        sys.exit(1)

    # Step 1: create epics and child issues.
    print(f"--- Step 1/4: Seeding epics and child issues for {target_key} ---")
    seed_jira.main(project_key=target_key, profile_name=profile.name)

    # Step 2: enrich existing issues with due dates and story points.
    print(f"\n--- Step 2/4: Enriching issues with due dates and story points for {target_key} ---")
    enrich_issues.main(project_key=target_key)

    # Step 3: create sprints and assign issues to them.
    print(f"\n--- Step 3/4: Creating sprints and assigning issues for {target_key} ---")
    create_sprints.main(project_key=target_key, profile_name=profile.name)

    # Step 4: create FixVersions and assign them to issues.
    print(f"\n--- Step 4/4: Creating FixVersions for {target_key} ---")
    create_versions.main(project_key=target_key, profile_name=profile.name)

    print(f"\n=== Demo data setup complete for [{target_key}] ===")
    print("Next: run ingestion to pull this data into the analytical database:")
    print(f"  python -m src.jira_ai.ingestion.run_ingestion --project {target_key}")
    print("Or to sync all projects:")
    print("  python -m src.jira_ai.ingestion.run_ingestion --all")


if __name__ == "__main__":
    main()
