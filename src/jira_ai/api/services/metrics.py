"""
metrics.py — Computes dashboard metrics from the issues table.

Each function runs an aggregation query and returns plain Python data that the
API serializes to JSON. Keeping the logic here (separate from the HTTP routes)
makes it easy to test and reuse.

Data source is selectable via `mode`:
  - "real"      : metrics from the live DB (default)
  - "synthetic" : metrics from the in-memory synthetic generator
"""

from datetime import datetime, UTC
from collections import defaultdict
import os
from sqlalchemy import func, case
from sqlalchemy.orm import Session

from src.jira_ai.ingestion.models import Issue, Sprint, FixVersion
from src.jira_ai.seeder import synthetic_metrics  # NEW


# NEW: known milestone target dates. Used as a fallback when a fix-version row
# has no release_date (or no matching row at all), so the dashboard's
# "release date" column is never empty for the M0-M3 program milestones.
MILESTONE_RELEASE_DATES = {
    "M0 - Preparation":          "2026-07-17",
    "M1 - Checkout redesign":    "2026-07-31",
    "M2 - Security & compliance": "2026-08-28",
    "M3 - Launch-ready":         "2026-10-09",
}


def _filter_by_project(query, project_key: str | None):
    """Filter an Issue-based query by project key."""
    if not project_key or project_key.upper() in ("ALL", "GLOBAL"):
        return query
    pkey = project_key.upper()
    if pkey == "HRZ":
        return query.filter(Issue.key.like("APS-%") | Issue.key.like("HRZ-%"))
    if pkey == "CORE":
        return query.filter(Issue.key.like("CORE-%") | Issue.key.like("INF-%") | (Issue.team == "Platform Core") | (Issue.team == "Data Insights"))
    return query.filter(Issue.key.like(f"{pkey}-%"))


def _default_team_for_project(project_key: str | None) -> str:
    """Return an intuitive default squad name when issue.team is null."""
    if not project_key or project_key.upper() in ("ALL", "GLOBAL"):
        return "Core Team"
    pkey = project_key.upper()
    if pkey == "HRZ":
        return "Horizon Squad"
    if pkey == "CHK":
        return "Checkout Squad"
    if pkey in ("CORE", "INF"):
        return "Platform Core"
    if pkey == "MOB":
        return "Mobile Team"
    if pkey == "PAY":
        return "Payments Squad"
    if pkey == "AIP":
        return "AI Engine Squad"
    return f"{pkey} Team"


def _milestone_release_date(name: str, db_value):
    """Prefer the DB release_date; fall back to the known milestone map."""
    if db_value:
        return db_value
    return MILESTONE_RELEASE_DATES.get(name)


def _count_by(db: Session, column, project_key: str | None = None) -> dict:
    """Generic helper: count issues grouped by a given column with optional project filtering."""
    q = db.query(column, func.count(Issue.key))
    q = _filter_by_project(q, project_key)
    rows = q.group_by(column).all()
    return {(value if value is not None else "None"): count for value, count in rows}


def total_issues(db: Session, project_key: str | None = None) -> int:
    """Total number of issues in the database, optionally filtered by project."""
    q = db.query(func.count(Issue.key))
    q = _filter_by_project(q, project_key)
    return q.scalar() or 0


def by_status(db: Session, project_key: str | None = None) -> dict:
    """Issue counts grouped by status."""
    return _count_by(db, Issue.status, project_key=project_key)


def by_type(db: Session, project_key: str | None = None) -> dict:
    """Issue counts grouped by type."""
    return _count_by(db, Issue.issue_type, project_key=project_key)


def by_priority(db: Session, project_key: str | None = None) -> dict:
    """Issue counts grouped by priority."""
    return _count_by(db, Issue.priority, project_key=project_key)


def by_epic(db: Session, project_key: str | None = None) -> dict:
    """Issue counts grouped by epic key (None = not under an epic)."""
    return _count_by(db, Issue.epic_key, project_key=project_key)


def velocity_by_sprint(db: Session, project_key: str | None = None) -> list[dict]:
    """Per-sprint issue count and total story points (velocity basis)."""
    q = (
        db.query(
            Issue.sprint,
            func.count(Issue.key),
            func.coalesce(func.sum(Issue.story_points), 0),
            Sprint.state,
            Sprint.start_date,
            Sprint.end_date,
        )
        .outerjoin(Sprint, Sprint.name == Issue.sprint)
        .filter(Issue.sprint.isnot(None))
        .filter(Issue.issue_type != "Epic")
    )
    q = _filter_by_project(q, project_key)
    rows = (
        q.group_by(Issue.sprint, Sprint.state, Sprint.start_date, Sprint.end_date)
        .order_by(Sprint.start_date.nullslast(), Issue.sprint)
        .all()
    )
    return [
        {
            "sprint": sprint,
            "issues": count,
            "story_points": points,
            "state": state,
            "start_date": start_date,
            "end_date": end_date,
        }
        for sprint, count, points, state, start_date, end_date in rows
    ]


def sprint_progress(db: Session, project_key: str | None = None) -> list[dict]:
    """Per-sprint completion: done vs total issues and story points."""
    done_case = case((Issue.status_category == "Done", 1), else_=0)
    done_points = case((Issue.status_category == "Done", Issue.story_points), else_=0)

    q = (
        db.query(
            Issue.sprint,
            func.count(Issue.key).label("total"),
            func.coalesce(func.sum(done_case), 0).label("done"),
            func.coalesce(func.sum(Issue.story_points), 0).label("total_points"),
            func.coalesce(func.sum(done_points), 0).label("done_points"),
            Sprint.state,
            Sprint.start_date,
            Sprint.end_date,
        )
        .outerjoin(Sprint, Sprint.name == Issue.sprint)
        .filter(Issue.sprint.isnot(None))
        .filter(Issue.issue_type != "Epic")
    )
    q = _filter_by_project(q, project_key)
    rows = (
        q.group_by(Issue.sprint, Sprint.state, Sprint.start_date, Sprint.end_date)
        .order_by(Sprint.start_date.nullslast(), Issue.sprint)
        .all()
    )
    result = []
    for sprint, total, done, total_pts, done_pts, state, start, end in rows:
        result.append({
            "sprint": sprint,
            "state": state,
            "start_date": start,
            "end_date": end,
            "total_issues": total,
            "done_issues": done,
            "percent_done": round(100 * done / total, 1) if total else 0.0,
            "total_points": total_pts,
            "done_points": done_pts,
        })
    return result


def points_by_sprint_team(db: Session, project_key: str | None = None) -> dict:
    """Committed vs completed story points per sprint, split by team."""
    done_points = case((Issue.status_category == "Done", Issue.story_points), else_=0)
    default_team = _default_team_for_project(project_key)
    team_expr = func.coalesce(Issue.team, default_team)

    q = (
        db.query(
            Issue.sprint,
            team_expr.label("team"),
            func.coalesce(func.sum(Issue.story_points), 0).label("committed"),
            func.coalesce(func.sum(done_points), 0).label("completed"),
            Sprint.start_date,
        )
        .outerjoin(Sprint, Sprint.name == Issue.sprint)
        .filter(Issue.sprint.isnot(None))
        .filter(Issue.issue_type != "Epic")
    )
    q = _filter_by_project(q, project_key)
    rows = (
        q.group_by(Issue.sprint, team_expr, Sprint.start_date)
        .order_by(Sprint.start_date.nullslast(), Issue.sprint)
        .all()
    )

    sprints, teams = [], []
    committed_grid: dict[str, dict[str, int]] = {}
    completed_grid: dict[str, dict[str, int]] = {}
    for sprint, team, committed, completed, _start in rows:
        if sprint not in sprints:
            sprints.append(sprint)
        if team not in teams:
            teams.append(team)
        committed_grid.setdefault(team, {})[sprint] = committed
        completed_grid.setdefault(team, {})[sprint] = completed

    return {
        "sprints": sprints,
        "teams": teams,
        "committed": {t: [committed_grid.get(t, {}).get(s, 0) for s in sprints] for t in teams},
        "completed": {t: [completed_grid.get(t, {}).get(s, 0) for s in sprints] for t in teams},
    }


def milestone_progress(db: Session, project_key: str | None = None) -> list[dict]:
    """Per-milestone (fix version) completion: done vs total issues."""
    done_case = case((Issue.status_category == "Done", 1), else_=0)

    q = (
        db.query(
            Issue.fix_version,
            func.count(Issue.key).label("total"),
            func.coalesce(func.sum(done_case), 0).label("done"),
            FixVersion.release_date,
            FixVersion.released,
        )
        .outerjoin(FixVersion, FixVersion.name == Issue.fix_version)
        .filter(Issue.fix_version.isnot(None))
        .filter(Issue.issue_type != "Epic")
    )
    q = _filter_by_project(q, project_key)
    rows = (
        q.group_by(Issue.fix_version, FixVersion.release_date, FixVersion.released)
        .order_by(FixVersion.release_date.nullslast(), Issue.fix_version)
        .all()
    )
    return [
        {
            "fix_version": fix_version,
            "release_date": _milestone_release_date(fix_version, release_date),
            "released": bool(released) if released is not None else False,
            "total_issues": total,
            "done_issues": done,
            "percent_done": round(100 * done / total, 1) if total else 0.0,
        }
        for fix_version, total, done, release_date, released in rows
    ]


def overdue_count(db: Session, project_key: str | None = None) -> int:
    """Risk metric: non-Done issues whose sprint has already ended."""
    now_iso = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S")
    q = (
        db.query(func.count(Issue.key))
        .join(Sprint, Sprint.name == Issue.sprint)
        .filter(Issue.issue_type != "Epic")
        .filter(Issue.status_category != "Done")
        .filter(Sprint.end_date.isnot(None))
        .filter(Sprint.end_date < now_iso)
    )
    q = _filter_by_project(q, project_key)
    return q.scalar() or 0


def last_ingested(db: Session) -> str | None:
    """When the issues data was most recently written by the ingestion job."""
    value = db.query(func.max(Issue.ingested_at)).scalar()
    return value.isoformat() if value is not None else None


# ---------------------------------------------------------------------------
# Synthetic dashboard summary (mirrors the real shape)
# ---------------------------------------------------------------------------
def _synthetic_dashboard_summary(project_key: str | None = None) -> dict:
    """Build the dashboard summary from the synthetic generator, matching the
    real payload shape exactly so the frontend needs no branching.
    """
    data = synthetic_metrics.build_synthetic_dataset()
    m = synthetic_metrics.compute_metrics(data)
    burn = synthetic_metrics.burnup(data)

    velocity = []
    for b in burn:
        velocity.append({
            "sprint": b.get("sprint"),
            "issues": b.get("issues", 0),
            "story_points": b.get("committed_points",
                                  b.get("committed", b.get("points", 0))),
            "state": b.get("state"),
            "start_date": b.get("start_date"),
            "end_date": b.get("end_date"),
        })

    progress = []
    for b in burn:
        committed = b.get("committed_points", b.get("committed", 0)) or 0
        completed = b.get("completed_points", b.get("completed", 0)) or 0
        progress.append({
            "sprint": b.get("sprint"),
            "state": b.get("state"),
            "start_date": b.get("start_date"),
            "end_date": b.get("end_date"),
            "total_issues": b.get("issues", 0),
            "done_issues": b.get("done_issues", 0),
            "percent_done": round(100 * completed / committed, 1) if committed else 0.0,
            "total_points": committed,
            "done_points": completed,
        })

    mc = m.get("milestone_completion", {})
    milestones = []
    for name, info in mc.items():
        total = info.get("total", 0)
        done = info.get("done", 0)
        milestones.append({
            "fix_version": name,
            "release_date": _milestone_release_date(name, info.get("release_date")),
            "released": False,
            "total_issues": total,
            "done_issues": done,
            "percent_done": info.get("percent_done",
                                     round(100 * done / total, 1) if total else 0.0),
        })

    sprints = [s["name"] for s in data.get("sprints", [])]
    teams = []
    committed_grid: dict[str, dict[str, int]] = {}
    completed_grid: dict[str, dict[str, int]] = {}
    for i in data.get("issues", []):
        if i.get("issue_type") == "Epic":
            continue
        s = i.get("sprint")
        t = i.get("team") or _default_team_for_project(project_key)
        sp = i.get("story_points") or 0
        if not s:
            continue
        if t not in teams:
            teams.append(t)
        committed_grid.setdefault(t, {})[s] = committed_grid.get(t, {}).get(s, 0) + sp
        if i.get("status_category") == "Done":
            completed_grid.setdefault(t, {})[s] = completed_grid.get(t, {}).get(s, 0) + sp

    points_by_st = {
        "sprints": sprints,
        "teams": teams,
        "committed": {t: [committed_grid.get(t, {}).get(s, 0) for s in sprints] for t in teams},
        "completed": {t: [completed_grid.get(t, {}).get(s, 0) for s in sprints] for t in teams},
    }

    by_status = defaultdict(int)
    by_type = defaultdict(int)
    by_priority = defaultdict(int)
    by_epic = defaultdict(int)
    for i in data.get("issues", []):
        by_status[i.get("status") or "None"] += 1
        by_type[i.get("issue_type") or "None"] += 1
        by_priority[i.get("priority") or "None"] += 1
        by_epic[i.get("epic_key") or "None"] += 1

    delivery_issues = [
        {
            "key": i["key"], "summary": i["summary"], "sprint": i.get("sprint"),
            "team": i.get("team") or _default_team_for_project(project_key), "story_points": i.get("story_points"),
            "status": i.get("status"), "status_category": i.get("status_category"), 
            "milestone": i.get("fix_version"),
        }
        for i in data.get("issues", [])
        if i.get("issue_type") not in ("Epic", "Sub-task")
    ]

    return {
        "project_key": project_key or "ALL",
        "jira_base": os.getenv("JIRA_BASE_URL", ""),
        "total_issues": m.get("total_issues", 0),
        "by_status": dict(by_status),
        "by_type": dict(by_type),
        "by_priority": dict(by_priority),
        "by_epic": dict(by_epic),
        "velocity_by_sprint": velocity,
        "sprint_progress": progress,
        "points_by_sprint_team": points_by_st,
        "milestone_progress": milestones,
        "overdue_count": m.get("overdue_count", 0),
        "last_ingested": None,  # synthetic data isn't ingested
        "delivery_issues": delivery_issues,
    }


def issues_for_delivery(db: Session, project_key: str | None = None) -> list:
    q = db.query(
        Issue.key, Issue.summary, Issue.sprint, Issue.team,
        Issue.story_points, Issue.status, Issue.status_category, Issue.fix_version,
    ).filter(Issue.issue_type != "Epic", Issue.issue_type != "Sub-task")
    q = _filter_by_project(q, project_key)
    rows = q.all()
    default_team = _default_team_for_project(project_key)
    return [
        {
            "key": r.key, "summary": r.summary, "sprint": r.sprint,
            "team": r.team or default_team, "story_points": r.story_points,
            "status": r.status, "status_category": r.status_category, 
            "milestone": r.fix_version,
        }
        for r in rows
    ]


def dashboard_summary(db: Session, mode: str = "real", project_key: str | None = None) -> dict:
    """Bundle all metrics into a single response for the dashboard, scoped by project_key."""
    if mode == "synthetic":
        return _synthetic_dashboard_summary(project_key=project_key)
    return {
        "project_key": project_key or "ALL",
        "jira_base": os.getenv("JIRA_BASE_URL", ""),
        "total_issues": total_issues(db, project_key=project_key),
        "by_status": by_status(db, project_key=project_key),
        "by_type": by_type(db, project_key=project_key),
        "by_priority": by_priority(db, project_key=project_key),
        "by_epic": by_epic(db, project_key=project_key),
        "velocity_by_sprint": velocity_by_sprint(db, project_key=project_key),
        "sprint_progress": sprint_progress(db, project_key=project_key),
        "points_by_sprint_team": points_by_sprint_team(db, project_key=project_key),
        "milestone_progress": milestone_progress(db, project_key=project_key),
        "overdue_count": overdue_count(db, project_key=project_key),
        "last_ingested": last_ingested(db),
        "delivery_issues": issues_for_delivery(db, project_key=project_key),
    }

