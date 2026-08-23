"""
run_ingestion.py — Entry point that pulls Jira issues into the analytical database.

Fetches issues (including custom fields discovered at runtime), maps the
raw Jira JSON into Issue rows, and upserts them so the job is repeatable.
Rebuilds the issue_links, fix_versions, and sprints tables from Jira for all
specified or registered projects.

Usage:
  python -m src.jira_ai.ingestion.run_ingestion                  # syncs all registered projects
  python -m src.jira_ai.ingestion.run_ingestion --project PAY   # syncs specific project
  python -m src.jira_ai.ingestion.run_ingestion --all           # syncs all projects
"""

import argparse
import json
import os
import sys
from datetime import datetime, UTC
from pathlib import Path

from src.jira_ai.ingestion.jira_client import (
    fetch_all_issues, discover_custom_fields, fetch_project_versions,
    fetch_sprints,
)
from src.jira_ai.ingestion.models import (
    Issue, IssueLink, FixVersion, Sprint, SessionLocal, init_db,
)
from src.jira_ai.api.services.assessment import warmup_assessment_cache
from src.jira_ai.api.services.skill_cache import invalidate_skill_cache, prune_stale_cache

_PROJECTS_SETTINGS_FILE = Path(__file__).resolve().parents[3] / ".agents" / "settings" / "projects.json"


def _read_registered_project_keys() -> list[str]:
    """Read all active project keys from the settings file."""
    try:
        if _PROJECTS_SETTINGS_FILE.exists():
            data = json.loads(_PROJECTS_SETTINGS_FILE.read_text(encoding="utf-8"))
            projects = data.get("projects", [])
            return [p["key"] for p in projects if not p.get("archived", False) and p.get("key")]
    except Exception as exc:
        print(f"  (Note: could not read projects.json: {exc})")
    return []


def _parse_date(value: str | None) -> datetime | None:
    """Parse a Jira ISO-8601 timestamp into a naive UTC datetime, or None."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def _extract_sprint(raw_sprint) -> tuple[str | None, str | None]:
    """
    Sprint is a list of sprint objects; take the most recent one's name and id.
    Returns (name, id) — both None if no sprint.
    """
    if not raw_sprint:
        return None, None
    if isinstance(raw_sprint, list) and raw_sprint:
        last = raw_sprint[-1]
        if isinstance(last, dict):
            sid = last.get("id")
            return last.get("name"), (str(sid) if sid is not None else None)
    return None, None


def _extract_fix_version(fix_versions) -> tuple[str | None, str | None]:
    """fixVersions is a list; take the first version's name and id if present."""
    if fix_versions and isinstance(fix_versions, list):
        first = fix_versions[0]
        vid = first.get("id")
        return first.get("name"), (str(vid) if vid is not None else None)
    return None, None


def _extract_labels(labels) -> str | None:
    """Jira labels is a list of strings; store as a comma-joined string."""
    if labels and isinstance(labels, list):
        return ",".join(labels)
    return None


def _extract_team(team) -> str | None:
    """Jira Team field is an object; take its display name."""
    if isinstance(team, dict):
        return team.get("name") or team.get("title")
    return None


def _extract_blocked_keys(issuelinks) -> list[str]:
    """Return the keys this issue BLOCKS (outward 'Blocks' direction only)."""
    blocked: list[str] = []
    if not isinstance(issuelinks, list):
        return blocked
    for link in issuelinks:
        if not isinstance(link, dict):
            continue
        if (link.get("type") or {}).get("name") != "Blocks":
            continue
        outward = link.get("outwardIssue")
        if isinstance(outward, dict) and outward.get("key"):
            blocked.append(outward["key"])
    return blocked


def _map_issue(raw: dict, cf: dict) -> Issue:
    """Flatten a raw Jira issue dict into an Issue ORM object."""
    fields = raw.get("fields", {})

    status = fields.get("status") or {}
    status_category = (status.get("statusCategory") or {}).get("name", "Unknown")
    priority = fields.get("priority") or {}
    assignee = fields.get("assignee") or {}
    parent = fields.get("parent") or {}
    issuetype = fields.get("issuetype") or {}

    story_points = fields.get(cf.get("story_points", ""))
    sprint_name, sprint_id = _extract_sprint(fields.get(cf.get("sprint", "")))
    fix_version_name, fix_version_id = _extract_fix_version(fields.get("fixVersions"))

    return Issue(
        key=raw["key"],
        summary=fields.get("summary", ""),
        issue_type=issuetype.get("name", "Unknown"),
        status=status.get("name", "Unknown"),
        status_category=status_category,
        priority=priority.get("name"),
        epic_key=parent.get("key"),
        assignee=assignee.get("displayName"),
        labels=_extract_labels(fields.get("labels")),
        team=_extract_team(fields.get(cf.get("team", ""))),
        due_date=_parse_date(fields.get("duedate")),
        story_points=int(story_points) if story_points is not None else None,
        sprint=sprint_name,
        sprint_id=sprint_id,
        fix_version=fix_version_name,
        fix_version_id=fix_version_id,
        created=_parse_date(fields.get("created")),
        updated=_parse_date(fields.get("updated")),
        resolved=_parse_date(fields.get("resolutiondate")),
        ingested_at=datetime.now(UTC).replace(tzinfo=None),
    )


def _map_version(raw: dict) -> FixVersion:
    """Flatten a raw Jira project FixVersion dict into a FixVersion ORM object."""
    rd = raw.get("releaseDate")
    return FixVersion(
        version_id=str(raw.get("id", "")),
        name=raw.get("name", ""),
        release_date=rd if rd else None,
        released=bool(raw.get("released", False)),
        archived=bool(raw.get("archived", False)),
        overdue=bool(raw.get("overdue", False)),
    )


def _map_sprint(raw: dict) -> Sprint:
    """Flatten a raw Jira Agile sprint dict into a Sprint ORM object."""
    return Sprint(
        sprint_id=str(raw.get("id", "")),
        name=raw.get("name", ""),
        state=raw.get("state", "unknown"),
        start_date=raw.get("startDate"),
        end_date=raw.get("endDate"),
        board_id=str(raw["originBoardId"]) if raw.get("originBoardId") is not None else None,
        goal=raw.get("goal"),
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingest issues and sprints from Jira into database.")
    parser.add_argument("--project", "-p", nargs="*", default=None, help="Specific project key(s) to ingest (e.g. PAY, CHK, AIP)")
    parser.add_argument("--all", "-a", action="store_true", help="Ingest all registered projects")

    args = parser.parse_args()

    # Determine target project keys
    if args.project:
        target_keys = [k.strip().upper() for k in args.project if k.strip()]
    elif args.all or not os.environ.get("JIRA_PROJECT_KEY"):
        registered = _read_registered_project_keys()
        target_keys = registered if registered else None
    else:
        env_key = os.environ.get("JIRA_PROJECT_KEY")
        target_keys = [env_key.strip().upper()] if env_key else None

    print("=== Jira Ingestion Pipeline ===")
    if target_keys:
        print(f"Target Project Keys: {target_keys}")
    else:
        print("Target Scope: All accessible Jira projects")

    init_db()

    print("Discovering custom fields...")
    cf = discover_custom_fields()
    print(f"  Custom fields: {cf}")

    print("Fetching issues from Jira...")
    raw_issues = fetch_all_issues(cf, project_keys=target_keys)

    print(f"Storing {len(raw_issues)} issues in the database...")
    session = SessionLocal()
    try:
        for raw in raw_issues:
            session.merge(_map_issue(raw, cf))
        session.commit()
        print(f"Done. {len(raw_issues)} issues upserted.")

        # Rebuild dependency links
        print("Rebuilding issue links...")
        session.query(IssueLink).delete()
        link_count = 0
        for raw in raw_issues:
            blocker = raw["key"]
            issuelinks = raw.get("fields", {}).get("issuelinks")
            for blocked in _extract_blocked_keys(issuelinks):
                session.add(IssueLink(
                    source_key=blocker, target_key=blocked, link_type="Blocks"
                ))
                link_count += 1
        session.commit()
        print(f"Done. {link_count} Blocks links stored.")

        # Fetch and store FixVersions
        print("Fetching FixVersions...")
        raw_versions = []
        if target_keys:
            for pkey in target_keys:
                raw_versions.extend(fetch_project_versions(pkey))
        else:
            # If no target keys specified, extract project keys from fetched issues
            discovered_pkeys = {r["key"].split("-")[0] for r in raw_issues if "-" in r.get("key", "")}
            for pkey in discovered_pkeys:
                raw_versions.extend(fetch_project_versions(pkey))

        session.query(FixVersion).delete()
        seen_vids = set()
        for rv in raw_versions:
            vid = str(rv.get("id", ""))
            if vid and vid not in seen_vids:
                seen_vids.add(vid)
                session.add(_map_version(rv))
        session.commit()
        print(f"Done. {len(seen_vids)} FixVersions stored.")

        # Fetch and store Sprints
        print("Fetching sprints...")
        raw_sprints = fetch_sprints(project_keys=target_keys)
        session.query(Sprint).delete()
        seen_sprints = set()
        for rs in raw_sprints:
            sid = str(rs.get("id", ""))
            if sid and sid not in seen_sprints:
                seen_sprints.add(sid)
                session.add(_map_sprint(rs))
        session.commit()
        print(f"Done. {len(seen_sprints)} sprints stored.")

        # Warm up metrics snapshot & baseline assessments for all registered projects
        print("Pre-computing metrics & warming assessment cache for all projects...")
        warmed = warmup_assessment_cache(session, mode="real", force=True)
        print(f"Done. Assessment cache warmed for projects: {', '.join(warmed)}")

        # Clear skill analysis cache so subsequent skill runs pick up the new data
        invalidated_count = invalidate_skill_cache(session)
        pruned_count = prune_stale_cache(session, max_age_days=7, max_rows=150)
        print(f"Done. Cache refreshed: cleared {invalidated_count} active entries, pruned {pruned_count} stale records.")
    finally:
        session.close()

    print("\n=== Ingestion Complete ===")


if __name__ == "__main__":
    main()
