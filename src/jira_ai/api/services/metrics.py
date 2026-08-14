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


def _milestone_release_date(name: str, db_value):
    """Prefer the DB release_date; fall back to the known milestone map."""
    if db_value:
        return db_value
    return MILESTONE_RELEASE_DATES.get(name)


def _count_by(db: Session, column) -> dict:
    """Generic helper: count issues grouped by a given column."""
    rows = db.query(column, func.count(Issue.key)).group_by(column).all()
    return {(value if value is not None else "None"): count for value, count in rows}


def total_issues(db: Session) -> int:
    """Total number of issues in the database."""
    return db.query(func.count(Issue.key)).scalar()


def by_status(db: Session) -> dict:
    """Issue counts grouped by status."""
    return _count_by(db, Issue.status)


def by_type(db: Session) -> dict:
    """Issue counts grouped by type."""
    return _count_by(db, Issue.issue_type)


def by_priority(db: Session) -> dict:
    """Issue counts grouped by priority."""
    return _count_by(db, Issue.priority)


def by_epic(db: Session) -> dict:
    """Issue counts grouped by epic key (None = not under an epic)."""
    return _count_by(db, Issue.epic_key)


def velocity_by_sprint(db: Session) -> list[dict]:
    """Per-sprint issue count and total story points (velocity basis).

    Joins the sprints table (by sprint name) so results are ordered by the
    sprint's real start date and carry its state and dates. Excludes epics,
    which never belong to a sprint. Sprints with no matching row in the
    sprints table still appear (falling back to name ordering, nulls last).
    """
    rows = (
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
        .group_by(Issue.sprint, Sprint.state, Sprint.start_date, Sprint.end_date)
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


def sprint_progress(db: Session) -> list[dict]:
    """Per-sprint completion: done vs total issues and story points.

    Ordered by the sprint's real start date. Excludes epics. 'done' uses the
    status_category so it tracks the Done column regardless of exact status
    name. Powers burn-up / sprint progress charts.
    """
    done_case = case((Issue.status_category == "Done", 1), else_=0)
    done_points = case((Issue.status_category == "Done", Issue.story_points), else_=0)

    rows = (
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
        .group_by(Issue.sprint, Sprint.state, Sprint.start_date, Sprint.end_date)
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

def points_by_sprint_team(db: Session) -> dict:
    """Committed vs completed story points per sprint, split by team.

    Returns:
      {
        sprints: [...],
        teams:   [...],
        committed: { team: [pts per sprint] },
        completed: { team: [pts per sprint] }
      }
    'completed' uses status_category = Done. 'committed' is all points planned
    into the sprint. Epics and issues with no sprint or no team are excluded.
    """
    done_points = case((Issue.status_category == "Done", Issue.story_points), else_=0)

    rows = (
        db.query(
            Issue.sprint,
            Issue.team,
            func.coalesce(func.sum(Issue.story_points), 0).label("committed"),
            func.coalesce(func.sum(done_points), 0).label("completed"),
            Sprint.start_date,
        )
        .outerjoin(Sprint, Sprint.name == Issue.sprint)
        .filter(Issue.sprint.isnot(None))
        .filter(Issue.team.isnot(None))
        .filter(Issue.issue_type != "Epic")
        .group_by(Issue.sprint, Issue.team, Sprint.start_date)
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



def milestone_progress(db: Session) -> list[dict]:
    """Per-milestone (fix version) completion: done vs total issues.

    Ordered by the version's release date. Excludes epics so counts reflect
    real deliverable work. Joins fix_versions for the release date, falling
    back to the known milestone map when the DB value is missing.
    """
    done_case = case((Issue.status_category == "Done", 1), else_=0)

    rows = (
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
        .group_by(Issue.fix_version, FixVersion.release_date, FixVersion.released)
        .order_by(FixVersion.release_date.nullslast(), Issue.fix_version)
        .all()
    )
    return [
        {
            "fix_version": fix_version,
            "release_date": _milestone_release_date(fix_version, release_date),  # NEW: fallback
            "released": bool(released) if released is not None else False,
            "total_issues": total,
            "done_issues": done,
            "percent_done": round(100 * done / total, 1) if total else 0.0,
        }
        for fix_version, total, done, release_date, released in rows
    ]


def overdue_count(db: Session) -> int:
    """Risk metric: non-Done issues whose sprint has already ended.

    Uses the sprint's end_date (the schedule source of truth) rather than
    per-issue due dates. Backlog issues (no sprint) are not counted, since
    without a sprint there is no schedule to be late against. Epics excluded.
    """
    now_iso = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S")
    return (
        db.query(func.count(Issue.key))
        .join(Sprint, Sprint.name == Issue.sprint)
        .filter(Issue.issue_type != "Epic")
        .filter(Issue.status_category != "Done")
        .filter(Sprint.end_date.isnot(None))
        .filter(Sprint.end_date < now_iso)
        .scalar()
    )


def last_ingested(db: Session) -> str | None:
    """When the issues data was most recently written by the ingestion job.
    Powers the 'data as of X' label on the dashboard."""
    value = db.query(func.max(Issue.ingested_at)).scalar()
    return value.isoformat() if value is not None else None


# ---------------------------------------------------------------------------
# Synthetic dashboard summary (mirrors the real shape)          # NEW (block)
# ---------------------------------------------------------------------------
def _synthetic_dashboard_summary() -> dict:
    """Build the dashboard summary from the synthetic generator, matching the
    real payload shape exactly so the frontend needs no branching.

    The synthetic generator exposes compute_metrics() (the eight assess keys)
    and burnup() (committed vs completed points per sprint). We derive the
    dashboard-shaped fields from those.
    """
    m = synthetic_metrics.compute_metrics()
    burn = synthetic_metrics.burnup()

    # velocity_by_sprint: one row per synthetic sprint. burnup() gives us
    # committed (~= story points) and completed points; use committed as the
    # velocity basis to match the real "sum of story_points" semantics.
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

    # sprint_progress: done vs committed points per sprint.
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
            "sprint_progress": sprint_progress(db),
            "points_by_sprint_team": points_by_sprint_team(db),   # <-- new
            "milestone_progress": milestone_progress(db),

        })

    # milestone_progress: reshape compute_metrics()'s milestone_completion
    # (a dict keyed by milestone name) into the list the dashboard expects.
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

    return {
        "total_issues": m.get("total_issues", 0),
        "by_status": m.get("by_status", {}),
        "by_type": m.get("by_type", {}),
        "by_priority": m.get("by_priority", {}),
        "by_epic": m.get("by_epic", {}),
        "velocity_by_sprint": velocity,
        "sprint_progress": progress,
        "milestone_progress": milestones,
        "overdue_count": m.get("overdue_count", 0),
        "last_ingested": None,  # synthetic data isn't ingested
    }


def issues_for_delivery(db: Session) -> list:
    rows = db.query(
        Issue.key, Issue.summary, Issue.sprint, Issue.team,
        Issue.story_points, Issue.status, Issue.status_category, Issue.fix_version,
    ).filter(Issue.issue_type != "Epic", Issue.issue_type != "Sub-task").all()
    return [
        {
            "key": r.key, "summary": r.summary, "sprint": r.sprint,
            "team": r.team, "story_points": r.story_points,
            "status": r.status, "status_category": r.status_category, 
            "milestone": r.fix_version,
        }
        for r in rows
    ]


def dashboard_summary(db: Session, mode: str = "real") -> dict:  # NEW: mode param
    """Bundle all metrics into a single response for the dashboard."""
    if mode == "synthetic":                   # NEW
        return _synthetic_dashboard_summary()  # NEW
    return {
        "jira_base": os.getenv("JIRA_BASE_URL", ""),
        "total_issues": total_issues(db),
        "by_status": by_status(db),
        "by_type": by_type(db),
        "by_priority": by_priority(db),
        "by_epic": by_epic(db),
        "velocity_by_sprint": velocity_by_sprint(db),
        "sprint_progress": sprint_progress(db),
        "milestone_progress": milestone_progress(db),
        "overdue_count": overdue_count(db),
        "last_ingested": last_ingested(db),
        "delivery_issues": issues_for_delivery(db),
    }
