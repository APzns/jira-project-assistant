"""
run_ingestion.py — Entry point that pulls Jira issues into the database.

Fetches all issues (including custom fields discovered at runtime), maps the
raw Jira JSON into Issue rows, and upserts them so the job is repeatable.
Also rebuilds the issue_links, fix_versions and sprints tables from Jira each run.
"""

from datetime import datetime, UTC

from src.jira_ai.ingestion.jira_client import (
    fetch_all_issues, discover_custom_fields, fetch_project_versions,
    fetch_sprints,
)
from src.jira_ai.ingestion.models import (
    Issue, IssueLink, FixVersion, Sprint, SessionLocal, init_db,
)


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
    A closed issue may have belonged to several sprints; the last is current.
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
    """fixVersions is a list; take the first version's name and id if present.
    Returns (name, id) — both None if no fix version."""
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
    """Jira Team field is an object; take its display name ('name' or 'title')."""
    if isinstance(team, dict):
        return team.get("name") or team.get("title")
    return None


def _extract_blocked_keys(issuelinks) -> list[str]:
    """Return the keys this issue BLOCKS (outward 'Blocks' direction only).

    On the blocker's issue, a Blocks link appears as type.name='Blocks' with
    an outwardIssue = the blocked issue. The same link on the blocked issue
    appears as an inwardIssue ('is blocked by'), which we skip so each link
    is captured exactly once.
    """
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

    # Custom fields are read by their discovered IDs.
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
    """Flatten a raw Jira project version dict into a FixVersion ORM object.

    Uses the paginated /version endpoint, where releaseDate is an ISO
    'YYYY-MM-DD' string (the non-paginated /versions endpoint returns epoch ms).
    """
    rd = raw.get("releaseDate")  # ISO string, or absent when no date set
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
    print("=== Jira ingestion ===")
    init_db()

    print("Discovering custom fields...")
    cf = discover_custom_fields()
    print(f"  Custom fields: {cf}")

    print("Fetching issues from Jira...")
    raw_issues = fetch_all_issues(cf)

    print(f"Storing {len(raw_issues)} issues in the database...")
    session = SessionLocal()
    try:
        for raw in raw_issues:
            session.merge(_map_issue(raw, cf))
        session.commit()
        print(f"Done. {len(raw_issues)} issues ingested.")

        # Rebuild the dependency links table from scratch each run so it stays
        # in sync with Jira (links can be added or removed between runs).
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

        # Rebuild the fix_versions table from Jira project versions each run,
        # same truncate-then-reinsert pattern as issue_links above.
        print("Fetching project versions...")
        raw_versions = fetch_project_versions()
        session.query(FixVersion).delete()
        for rv in raw_versions:
            session.add(_map_version(rv))
        session.commit()
        print(f"Done. {len(raw_versions)} fix versions stored.")

        # Rebuild the sprints table from the Agile board each run, same
        # truncate-then-reinsert pattern.
        print("Fetching sprints...")
        raw_sprints = fetch_sprints()
        session.query(Sprint).delete()
        for rs in raw_sprints:
            session.add(_map_sprint(rs))
        session.commit()
        print(f"Done. {len(raw_sprints)} sprints stored.")
    finally:
        session.close()


if __name__ == "__main__":
    main()
