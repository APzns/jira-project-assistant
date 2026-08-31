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
import json
from pathlib import Path

def _get_project_milestones(project_key: str | None) -> list[dict] | None:
    if not project_key:
        return None
    try:
        p_path = Path(__file__).resolve().parents[4] / ".agents" / "settings" / "projects.json"
        if p_path.exists():
            with open(p_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                for p in data.get("projects", []):
                    if p.get("key") == project_key.upper():
                        return p.get("milestones")
    except Exception:
        pass
    return None

def _filter_by_project(query, project_key: str | None):
    """Filter an Issue-based query by project key."""
    if not project_key or project_key.upper() in ("ALL", "GLOBAL"):
        return query
    pkey = project_key.upper()
    if pkey == "HRZ":
        return query
    if pkey == "CORE":
        return query.filter(
            Issue.key.like("CORE-%") | 
            Issue.key.like("INF-%") | 
            (Issue.team == "Platform Core") | 
            (Issue.team == "Data Insights")
        ).filter(
            ~Issue.key.like("APS-%"),
            ~Issue.key.like("HRZ-%")
        )
    return query.filter(Issue.key.like(f"{pkey}-%"))


def _default_team_for_project(project_key: str | None) -> str:
    """Return an intuitive default squad name when issue.team is null."""
    if not project_key or project_key.upper() in ("ALL", "GLOBAL", "HRZ"):
        return "Unassigned"
    pkey = project_key.upper()
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
    return "Unassigned"


def _resolve_team_for_issue(issue_team: str | None, issue_key: str | None = None, project_key: str | None = None) -> str:
    """Resolve an issue's team from its explicit team, key prefix, or project default."""
    if issue_team and str(issue_team).strip() and str(issue_team).strip().lower() not in ("none", "null", ""):
        return str(issue_team).strip()
    if issue_key:
        pkey = str(issue_key).split("-")[0].upper()
        if pkey == "CHK":
            return "Checkout Squad"
        if pkey == "MOB":
            return "Mobile Team"
        if pkey in ("CORE", "INF"):
            return "Platform Core"
        if pkey == "PAY":
            return "Payments Squad"
        if pkey == "AIP":
            return "AI Engine Squad"
    return _default_team_for_project(project_key)


def _milestone_release_date(name: str, db_value):
    """Return the DB release_date without relying on hardcoded fallback milestones."""
    return db_value


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
    team_expr = case(
        (Issue.team.isnot(None), Issue.team),
        (Issue.key.like("CHK-%"), "Checkout Squad"),
        (Issue.key.like("MOB-%"), "Mobile Team"),
        (Issue.key.like("CORE-%") | Issue.key.like("INF-%"), "Platform Core"),
        (Issue.key.like("PAY-%"), "Payments Squad"),
        (Issue.key.like("AIP-%"), "AI Engine Squad"),
        else_=_default_team_for_project(project_key),
    )

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
    in_review_case = case((Issue.status_category == "In Review", 1), else_=0)
    in_progress_case = case((Issue.status_category == "In Progress", 1), else_=0)
    todo_case = case((Issue.status_category == "To Do", 1), else_=0)

    q = (
        db.query(
            Issue.fix_version,
            func.count(Issue.key).label("total"),
            func.coalesce(func.sum(done_case), 0).label("done"),
            func.coalesce(func.sum(in_review_case), 0).label("in_review"),
            func.coalesce(func.sum(in_progress_case), 0).label("in_progress"),
            func.coalesce(func.sum(todo_case), 0).label("todo"),
            FixVersion.release_date,
            FixVersion.released,
        )
        .outerjoin(FixVersion, FixVersion.name == Issue.fix_version)
        .filter(Issue.fix_version.isnot(None))
        .filter(Issue.issue_type != "Epic")
    )
    # We want global progress for the fix versions, but we ONLY want to list
    # fix versions that the current project actually participates in.
    if project_key and project_key.upper() not in ("ALL", "GLOBAL"):
        subq = db.query(Issue.fix_version).filter(Issue.fix_version.isnot(None))
        subq = _filter_by_project(subq, project_key)
        q = q.filter(Issue.fix_version.in_(subq))
    rows = (
        q.group_by(Issue.fix_version, FixVersion.release_date, FixVersion.released)
        .order_by(FixVersion.release_date.nullslast(), Issue.fix_version)
        .all()
    )
    results = [
        {
            "fix_version": fix_version,
            "release_date": _milestone_release_date(fix_version, release_date),
            "released": bool(released) if released is not None else False,
            "total_issues": total,
            "done_issues": done,
            "in_review_issues": in_review,
            "in_progress_issues": in_progress,
            "todo_issues": todo,
            "percent_done": round(100 * done / total, 1) if total else 0.0,
            "pct_done": round(100 * done / total, 1) if total else 0.0,
            "pct_in_review": round(100 * in_review / total, 1) if total else 0.0,
            "pct_in_progress": round(100 * in_progress / total, 1) if total else 0.0,
            "pct_todo": round(100 * todo / total, 1) if total else 0.0,
        }
        for fix_version, total, done, in_review, in_progress, todo, release_date, released in rows
    ]
    results.sort(key=lambda x: (str(x["release_date"]) if x["release_date"] else '9999-12-31', x["fix_version"]))
    
    project_milestones = _get_project_milestones(project_key)
    if project_milestones and len(project_milestones) > 0:
        ms_list = sorted(project_milestones, key=lambda x: x.get("deadline", "9999-12-31"))
        
        grouped = []
        for ms in ms_list:
            grouped.append({
                "milestone": ms.get("name"),
                "deadline": ms.get("deadline"),
                "total_issues": 0,
                "done_issues": 0,
                "in_review_issues": 0,
                "in_progress_issues": 0,
                "todo_issues": 0,
                "percent_done": 0.0,
                "pct_done": 0.0,
                "pct_in_review": 0.0,
                "pct_in_progress": 0.0,
                "pct_todo": 0.0,
                "fix_versions": []
            })
            
        unassigned = {
            "milestone": "Unassigned / Future",
            "deadline": None,
            "total_issues": 0,
            "done_issues": 0,
            "in_review_issues": 0,
            "in_progress_issues": 0,
            "todo_issues": 0,
            "percent_done": 0.0,
            "pct_done": 0.0,
            "pct_in_review": 0.0,
            "pct_in_progress": 0.0,
            "pct_todo": 0.0,
            "fix_versions": []
        }
        
        for fv in results:
            rel_date = fv.get("release_date")
            assigned = False
            if rel_date:
                for g in grouped:
                    if g["deadline"] and g["deadline"] >= rel_date:
                        g["fix_versions"].append(fv)
                        g["total_issues"] += fv["total_issues"]
                        g["done_issues"] += fv["done_issues"]
                        g["in_review_issues"] += fv["in_review_issues"]
                        g["in_progress_issues"] += fv["in_progress_issues"]
                        g["todo_issues"] += fv["todo_issues"]
                        assigned = True
                        break
            if not assigned:
                unassigned["fix_versions"].append(fv)
                unassigned["total_issues"] += fv["total_issues"]
                unassigned["done_issues"] += fv["done_issues"]
                unassigned["in_review_issues"] += fv["in_review_issues"]
                unassigned["in_progress_issues"] += fv["in_progress_issues"]
                unassigned["todo_issues"] += fv["todo_issues"]
                
        final_results = []
        for g in grouped:
            if g["total_issues"] > 0:
                t = g["total_issues"]
                g["percent_done"] = round(100 * g["done_issues"] / t, 1)
                g["pct_done"] = g["percent_done"]
                g["pct_in_review"] = round(100 * g["in_review_issues"] / t, 1)
                g["pct_in_progress"] = round(100 * g["in_progress_issues"] / t, 1)
                g["pct_todo"] = round(100 * g["todo_issues"] / t, 1)
            final_results.append(g)
            
        if unassigned["fix_versions"]:
            if unassigned["total_issues"] > 0:
                t = unassigned["total_issues"]
                unassigned["percent_done"] = round(100 * unassigned["done_issues"] / t, 1)
                unassigned["pct_done"] = unassigned["percent_done"]
                unassigned["pct_in_review"] = round(100 * unassigned["in_review_issues"] / t, 1)
                unassigned["pct_in_progress"] = round(100 * unassigned["in_progress_issues"] / t, 1)
                unassigned["pct_todo"] = round(100 * unassigned["todo_issues"] / t, 1)
            final_results.append(unassigned)
            
        return final_results
        
    # If no project-specific milestones, filter out portfolio milestones
    portfolio_milestones = set()
    if project_key and project_key.upper() not in ("ALL", "GLOBAL", "HRZ"):
        pm = _get_project_milestones("HRZ")
        if pm:
            portfolio_milestones = {m.get("name", "").lower() for m in pm}
            
    filtered_results = []
    for fv in results:
        fv_name = fv.get("fix_version")
        if fv_name and fv_name.lower() in portfolio_milestones:
            continue
        filtered_results.append(fv)
            
    return filtered_results


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
    
    portfolio_milestones = set()
    if project_key and project_key.upper() not in ("ALL", "GLOBAL", "HRZ"):
        pm = _get_project_milestones("HRZ")
        if pm:
            portfolio_milestones = {m.get("name", "").lower() for m in pm}
            
    for name, info in mc.items():
        if name and name.lower() in portfolio_milestones:
            continue
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
    milestones.sort(key=lambda x: (str(x["release_date"]) if x["release_date"] else '9999-12-31', x["fix_version"]))

    sprints = [s["name"] for s in data.get("sprints", [])]
    teams = []
    committed_grid: dict[str, dict[str, int]] = {}
    completed_grid: dict[str, dict[str, int]] = {}
    for i in data.get("issues", []):
        if i.get("issue_type") == "Epic":
            continue
        s = i.get("sprint")
        t = _resolve_team_for_issue(i.get("team"), i.get("key"), project_key)
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
            "team": _resolve_team_for_issue(i.get("team"), i.get("key"), project_key), "story_points": i.get("story_points"),
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
    return [
        {
            "key": r.key, "summary": r.summary, "sprint": r.sprint,
            "team": _resolve_team_for_issue(r.team, r.key, project_key), "story_points": r.story_points,
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

