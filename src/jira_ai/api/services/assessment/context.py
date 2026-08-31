"""context.py — Data metrics collection & normalization for program assessment."""

import json
import logging
from datetime import datetime, timezone, date
from sqlalchemy import text


from src.jira_ai.seeder import synthetic_metrics, forecast

logger = logging.getLogger("jira_ai")


def _days_until(iso_date: str | None) -> int | None:
    """Whole days from today until an ISO 'YYYY-MM-DD' date (negative = past)."""
    if not iso_date:
        return None
    try:
        target = date.fromisoformat(iso_date[:10])
    except ValueError:
        return None
    return (target - datetime.now(timezone.utc).date()).days


def _pick(d: dict, *keys, default=0):
    """Return the first present, non-None value among keys."""
    for k in keys:
        v = d.get(k)
        if v is not None:
            return v
    return default


def _normalize_sprint_progress(rows: list[dict]) -> list[dict]:
    """Coerce any sprint_progress list (real or synthetic) into the canonical schema."""
    out = []
    for s in rows:
        total = _pick(s, "total", "total_issues", default=0)
        done = _pick(s, "done", "done_issues", default=0)
        completed_points = _pick(s, "completed_points", "done_points", "completed", default=0)
        committed_points = _pick(s, "committed_points", "story_points", "total_points", "points", default=0)
        pct = s.get("percent_done")
        if pct is None:
            pct = round(100 * done / total, 1) if total else 0.0
        out.append({
            "sprint": s.get("sprint"),
            "state": s.get("state"),
            "start_date": s.get("start_date"),
            "end_date": s.get("end_date"),
            "total": int(total or 0),
            "done": int(done or 0),
            "percent_done": pct,
            "completed_points": int(completed_points or 0),
            "committed_points": int(committed_points or 0),
        })
    return out


def _project_sql_condition(project_key: str | None, table_alias: str = "i") -> str:
    """SQL WHERE clause condition for project filtering."""
    if not project_key or project_key.upper() in ("ALL", "GLOBAL"):
        return "1=1"
    pkey = project_key.upper()
    if pkey == "HRZ":
        return "1=1"
    if pkey == "CORE":
        return f"({table_alias}.key LIKE 'CORE-%' OR {table_alias}.key LIKE 'INF-%' OR {table_alias}.team = 'Platform Core' OR {table_alias}.team = 'Data Insights')"
    return f"{table_alias}.key LIKE '{pkey}-%'"


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


def _sql_team_expression(table_alias: str = "i", default_team: str = "Unassigned") -> str:
    """Return SQL expression to resolve issue team, falling back to prefix mapping then default."""
    return f"""coalesce(
        {table_alias}.team,
        CASE
            WHEN {table_alias}.key LIKE 'CHK-%' THEN 'Checkout Squad'
            WHEN {table_alias}.key LIKE 'MOB-%' THEN 'Mobile Team'
            WHEN {table_alias}.key LIKE 'CORE-%' OR {table_alias}.key LIKE 'INF-%' THEN 'Platform Core'
            WHEN {table_alias}.key LIKE 'PAY-%' THEN 'Payments Squad'
            WHEN {table_alias}.key LIKE 'AIP-%' THEN 'AI Engine Squad'
            ELSE '{default_team}'
        END
    )"""


def _compute_metrics(db, project_key: str | None = None) -> dict:
    """Compute exact, deterministic metrics snapshot from SQL database, optionally filtered by project_key."""

    def scalar(sql, **params):
        return db.execute(text(sql), params).scalar()

    proj_cond_i = _project_sql_condition(project_key, "i")
    proj_cond_i2 = _project_sql_condition(project_key, "i2")
    proj_cond_s = _project_sql_condition(project_key, "s")
    proj_cond_t = _project_sql_condition(project_key, "t")
    global_fv_cond = f"""(
        {proj_cond_i}
        OR (
            (i.fix_version_id IS NOT NULL OR i.fix_version IS NOT NULL)
            AND coalesce(v.name, i.fix_version) IN (
                SELECT coalesce(v2.name, i2.fix_version)
                FROM issues i2
                LEFT JOIN fix_versions v2 ON (v2.version_id = i2.fix_version_id OR v2.name = i2.fix_version)
                WHERE (i2.fix_version_id IS NOT NULL OR i2.fix_version IS NOT NULL) AND {proj_cond_i2}
            )
        )
    )"""
    def_team = _default_team_for_project(project_key)
    team_expr_i = _sql_team_expression("i", def_team)
    team_expr_s = _sql_team_expression("s", def_team)
    team_expr_t = _sql_team_expression("t", def_team)

    total = scalar(f"SELECT count(*) FROM issues i WHERE {proj_cond_i}") or 0

    milestone_rows = db.execute(text(f"""
        SELECT coalesce(v.name, i.fix_version) AS name,
               v.release_date,
               count(*) AS total,
               count(*) FILTER (WHERE i.status_category = 'Done') AS done,
               count(*) FILTER (WHERE i.status_category = 'In Review') AS in_review,
               count(*) FILTER (WHERE i.status_category = 'In Progress') AS in_progress,
               count(*) FILTER (WHERE i.status_category = 'To Do') AS todo
        FROM issues i
        LEFT JOIN fix_versions v ON (v.version_id = i.fix_version_id OR v.name = i.fix_version)
        WHERE (i.fix_version_id IS NOT NULL OR i.fix_version IS NOT NULL) AND i.issue_type <> 'Epic'
          AND {global_fv_cond}
        GROUP BY coalesce(v.name, i.fix_version), v.release_date
        ORDER BY v.release_date NULLS LAST, name
    """)).fetchall()
    
    milestone_completion = {}
    from src.jira_ai.api.services.metrics import _get_project_milestones
    p_milestones = _get_project_milestones(project_key)
    
    if p_milestones and len(p_milestones) > 0:
        ms_list = sorted(p_milestones, key=lambda x: x.get("deadline", "9999-12-31"))
        grouped = {}
        for ms in ms_list:
            grouped[ms["name"]] = {
                "release_date": ms["deadline"],
                "days_to_release": _days_until(ms["deadline"]),
                "total": 0, "done": 0, "in_review": 0, "in_progress": 0, "todo": 0,
                "fix_versions": []
            }
        
        unassigned = {
            "release_date": None,
            "days_to_release": None,
            "total": 0, "done": 0, "in_review": 0, "in_progress": 0, "todo": 0,
            "fix_versions": []
        }
        
        for r in milestone_rows:
            fv_name = r[0]
            rd = r[1]
            t = int(r[2])
            fv_data = {
                "fix_version": fv_name,
                "release_date": rd,
                "days_to_release": _days_until(rd),
                "total": t,
                "done": int(r[3]),
                "in_review": int(r[4]),
                "in_progress": int(r[5]),
                "todo": int(r[6]),
                "percent_done": round(100 * int(r[3]) / t) if t else 0,
            }
            
            assigned = False
            if rd:
                for ms_name, ms_data in grouped.items():
                    if ms_data["release_date"] and ms_data["release_date"] >= rd:
                        ms_data["fix_versions"].append(fv_data)
                        ms_data["total"] += t
                        ms_data["done"] += int(r[3])
                        ms_data["in_review"] += int(r[4])
                        ms_data["in_progress"] += int(r[5])
                        ms_data["todo"] += int(r[6])
                        assigned = True
                        break
            if not assigned:
                unassigned["fix_versions"].append(fv_data)
                unassigned["total"] += t
                unassigned["done"] += int(r[3])
                unassigned["in_review"] += int(r[4])
                unassigned["in_progress"] += int(r[5])
                unassigned["todo"] += int(r[6])
                
        for ms_name, ms_data in grouped.items():
            if ms_data["total"] > 0:
                t = ms_data["total"]
                ms_data["percent_done"] = round(100 * ms_data["done"] / t)
                ms_data["pct_done"] = ms_data["percent_done"]
                ms_data["pct_in_review"] = round(100 * ms_data["in_review"] / t)
                ms_data["pct_in_progress"] = round(100 * ms_data["in_progress"] / t)
                ms_data["pct_todo"] = round(100 * ms_data["todo"] / t)
                milestone_completion[ms_name] = ms_data
                
        if unassigned["total"] > 0:
            t = unassigned["total"]
            unassigned["percent_done"] = round(100 * unassigned["done"] / t)
            unassigned["pct_done"] = unassigned["percent_done"]
            unassigned["pct_in_review"] = round(100 * unassigned["in_review"] / t)
            unassigned["pct_in_progress"] = round(100 * unassigned["in_progress"] / t)
            unassigned["pct_todo"] = round(100 * unassigned["todo"] / t)
            milestone_completion["Unassigned / Future"] = unassigned
    else:
        portfolio_milestones = set()
        if project_key and project_key.upper() not in ("ALL", "GLOBAL", "HRZ"):
            pm = _get_project_milestones("HRZ")
            if pm:
                portfolio_milestones = {m.get("name", "").lower() for m in pm}
                
        for r in milestone_rows:
            fv_name = r[0]
            if fv_name and fv_name.lower() in portfolio_milestones:
                continue
            rd = r[1]
            t = int(r[2])
            milestone_completion[fv_name] = {
                "release_date": rd,
                "days_to_release": _days_until(rd),
                "total": t,
                "done": int(r[3]),
                "in_review": int(r[4]),
                "in_progress": int(r[5]),
                "todo": int(r[6]),
                "percent_done": round(100 * r[3] / t) if t else 0,
                "pct_done": round(100 * r[3] / t) if t else 0,
                "pct_in_review": round(100 * r[4] / t) if t else 0,
                "pct_in_progress": round(100 * r[5] / t) if t else 0,
                "pct_todo": round(100 * r[6] / t) if t else 0,
            }

    project_milestone = None
    dated = [(name, info) for name, info in milestone_completion.items() if info["release_date"]]
    if dated:
        project_milestone = max(dated, key=lambda kv: kv[1]["release_date"])[0]

    sprint_rows = db.execute(text(f"""
        SELECT i.sprint,
               s.state, s.start_date, s.end_date,
               count(*) AS total,
               count(*) FILTER (WHERE i.status_category = 'Done') AS done,
               coalesce(sum(i.story_points), 0) AS points,
               coalesce(sum(i.story_points) FILTER (WHERE i.status_category = 'Done'), 0) AS done_points
        FROM issues i
        LEFT JOIN sprints s ON s.name = i.sprint
        WHERE i.sprint IS NOT NULL AND i.issue_type <> 'Epic'
          AND {proj_cond_i}
        GROUP BY i.sprint, s.state, s.start_date, s.end_date
        ORDER BY s.start_date NULLS LAST, i.sprint
    """)).fetchall()
    sprint_progress = _normalize_sprint_progress([
        {
            "sprint": r[0],
            "state": r[1],
            "start_date": r[2],
            "end_date": r[3],
            "total": int(r[4]),
            "done": int(r[5]),
            "percent_done": round(100 * r[5] / r[4]) if r[4] else 0,
            "committed_points": int(r[6]),
            "completed_points": int(r[7]),
        }
        for r in sprint_rows
    ])

    team_rows = db.execute(text(f"""
        SELECT i.sprint, {team_expr_i} AS team,
               coalesce(sum(i.story_points), 0) AS committed,
               coalesce(sum(i.story_points) FILTER (WHERE i.status_category = 'Done'), 0) AS completed,
               s.start_date
        FROM issues i
        LEFT JOIN sprints s ON s.name = i.sprint
        WHERE i.sprint IS NOT NULL AND i.issue_type <> 'Epic'
          AND {proj_cond_i}
        GROUP BY i.sprint, {team_expr_i}, s.start_date
        ORDER BY s.start_date NULLS LAST, i.sprint
    """)).fetchall()

    _sprints, _teams = [], []
    _committed, _completed = {}, {}
    for sprint, team, committed, completed, _start in team_rows:
        if sprint not in _sprints:
            _sprints.append(sprint)
        if team not in _teams:
            _teams.append(team)
        _committed.setdefault(team, {})[sprint] = int(committed)
        _completed.setdefault(team, {})[sprint] = int(completed)

    points_by_sprint_team = {
        "sprints": _sprints,
        "teams": _teams,
        "committed": {t: [_committed.get(t, {}).get(s, 0) for s in _sprints] for t in _teams},
        "completed": {t: [_completed.get(t, {}).get(s, 0) for s in _sprints] for t in _teams},
    }

    blocked_issues = scalar(f"""
        SELECT count(DISTINCT l.target_key)
        FROM issue_links l
        JOIN issues s ON s.key = l.source_key
        JOIN issues t ON t.key = l.target_key
        WHERE t.status_category <> 'Done' AND s.status_category <> 'Done'
          AND ({proj_cond_s} OR {proj_cond_t})
    """) or 0

    cross_team_blockers = scalar(f"""
        SELECT count(*)
        FROM issue_links l
        JOIN issues s ON s.key = l.source_key
        JOIN issues t ON t.key = l.target_key
        WHERE s.team IS NOT NULL AND t.team IS NOT NULL AND s.team <> t.team
          AND t.status_category <> 'Done' AND s.status_category <> 'Done'
          AND ({proj_cond_s} OR {proj_cond_t})
    """) or 0

    cross_team_rows = db.execute(text(f"""
        SELECT s.team AS blocker_team, t.team AS blocked_team, count(*) AS n
        FROM issue_links l
        JOIN issues s ON s.key = l.source_key
        JOIN issues t ON t.key = l.target_key
        WHERE s.team IS NOT NULL AND t.team IS NOT NULL AND s.team <> t.team
          AND t.status_category <> 'Done' AND s.status_category <> 'Done'
          AND ({proj_cond_s} OR {proj_cond_t})
        GROUP BY s.team, t.team ORDER BY n DESC
    """)).fetchall()
    cross_team_pairs = [
        {"blocker_team": r[0], "blocked_team": r[1], "count": int(r[2])}
        for r in cross_team_rows
    ]

    conflict_rows = db.execute(text(f"""
        SELECT l.source_key AS blocker, s.summary AS blocker_summary,
               {team_expr_s} AS blocker_team, bs.start_date AS blocker_start,
               l.target_key AS blocked, t.summary AS blocked_summary,
               {team_expr_t} AS blocked_team, ts.start_date AS blocked_start,
               s.sprint AS blocker_sprint, bs.end_date AS blocker_sprint_end,
               t.sprint AS blocked_sprint, ts.end_date AS blocked_sprint_end
        FROM issue_links l
        JOIN issues s ON s.key = l.source_key
        JOIN issues t ON t.key = l.target_key
        LEFT JOIN sprints bs ON bs.name = s.sprint
        LEFT JOIN sprints ts ON ts.name = t.sprint
        WHERE t.status_category <> 'Done'
          AND s.status_category <> 'Done'
          AND ({proj_cond_s} OR {proj_cond_t})
          AND (
               s.sprint IS NULL
               OR bs.start_date IS NULL
               OR (ts.start_date IS NOT NULL AND bs.start_date >= ts.start_date)
          )
        ORDER BY ts.start_date NULLS LAST, l.target_key
    """)).fetchall()
    dependency_conflict_items = []
    for r in conflict_rows:
        blocker_start = r[3]
        reason = "blocker unplanned" if blocker_start is None else "blocker starts at/after blocked"
        dependency_conflict_items.append({
            "blocker": r[0], "blocker_summary": r[1], "blocker_team": r[2],
            "blocker_sprint": r[8], "blocker_sprint_end": r[9],
            "blocked": r[4], "blocked_summary": r[5], "blocked_team": r[6],
            "blocked_sprint": r[10], "blocked_sprint_end": r[11],
            "reason": reason,
        })
    dependency_conflicts = {
        "count": len(dependency_conflict_items),
        "items": dependency_conflict_items,
    }

    unresolved_bugs = scalar(f"""
        SELECT count(*) FROM issues i
        WHERE i.issue_type = 'Bug' AND i.status_category <> 'Done'
          AND {proj_cond_i}
    """) or 0

    _closed_sp = [s for s in sprint_progress if s.get("state") == "closed"]
    _tot_comm = sum(s["committed_points"] for s in _closed_sp)
    _tot_comp = sum(s["completed_points"] for s in _closed_sp)
    predictability = {
        "pct": round(100.0 * _tot_comp / _tot_comm, 1) if _tot_comm else None,
        "n": len(_closed_sp),
    }

    _avg_vel = (sum(s["completed_points"] for s in _closed_sp) / len(_closed_sp) if _closed_sp else 0)
    _next = next((s for s in sprint_progress if s.get("state") == "active"), None) \
        or next((s for s in sprint_progress if s.get("state") == "future"), None)
    if _next and _avg_vel:
        overcommit_next = {
            "sprint": _next.get("sprint"),
            "committed": _next.get("committed_points"),
            "avg_velocity": round(_avg_vel, 1),
            "pct": round(100 * (_next.get("committed_points", 0) - _avg_vel) / _avg_vel, 1),
        }
    else:
        overcommit_next = {"sprint": None, "committed": None,
                           "avg_velocity": round(_avg_vel, 1) if _avg_vel else None,
                           "pct": None}

    overcommit_by_team = []
    _next_sprint_name = _next.get("sprint") if _next else None
    if _next_sprint_name:
        pbt = points_by_sprint_team
        _sprint_list = pbt["sprints"]
        try:
            _next_idx = _sprint_list.index(_next_sprint_name)
        except ValueError:
            _next_idx = None
        _closed_names = {s["sprint"] for s in sprint_progress if s.get("state") == "closed"}
        _closed_idx = [i for i, sn in enumerate(_sprint_list) if sn in _closed_names]
        if _next_idx is not None:
            for team in pbt["teams"]:
                committed_list = pbt["committed"].get(team, [])
                completed_list = pbt["completed"].get(team, [])
                team_committed_next = (committed_list[_next_idx] if _next_idx < len(committed_list) else 0)
                vels = [completed_list[i] for i in _closed_idx if i < len(completed_list) and completed_list[i] > 0]
                team_avg_vel = round(sum(vels) / len(vels), 1) if vels else None
                pct = round(100 * (team_committed_next - team_avg_vel) / team_avg_vel, 1) if team_avg_vel else None
                overcommit_by_team.append({
                    "team": team,
                    "committed": team_committed_next,
                    "avg_velocity": team_avg_vel,
                    "pct": pct,
                })
            overcommit_by_team.sort(key=lambda t: (t["pct"] is None, -(t["pct"] or 0)))

    team_predictability = []
    pbt = points_by_sprint_team
    _sprint_list = pbt.get("sprints", [])
    _closed_names = {s["sprint"] for s in sprint_progress if s.get("state") == "closed"}
    _closed_idx = [i for i, sn in enumerate(_sprint_list) if sn in _closed_names]
    for team in pbt.get("teams", []):
        c_list = pbt.get("committed", {}).get(team, [])
        d_list = pbt.get("completed", {}).get(team, [])
        team_ratios = []
        tot_c, tot_d = 0, 0
        for i in _closed_idx:
            c = c_list[i] if i < len(c_list) else 0
            d = d_list[i] if i < len(d_list) else 0
            if c > 0:
                team_ratios.append(d / c)
                tot_c += c
                tot_d += d
        pct = round(100 * (sum(team_ratios) / len(team_ratios)), 1) if team_ratios else None
        team_predictability.append({
            "team": team,
            "pct": pct,
            "total_committed": tot_c,
            "total_completed": tot_d,
            "n_sprints": len(team_ratios),
        })
    team_predictability.sort(key=lambda x: (x["pct"] is None, -(x["pct"] or 0)))

    delayed_rows = db.execute(text(f"""
        SELECT coalesce(v.name, i.fix_version) AS name,
               v.release_date,
               coalesce(v.released, false) AS released,
               i.key, i.summary, {team_expr_i} AS team,
               i.resolved, i.status_category, i.sprint, i.status
        FROM issues i
        LEFT JOIN fix_versions v ON (v.version_id = i.fix_version_id OR v.name = i.fix_version)
        WHERE (i.fix_version_id IS NOT NULL OR i.fix_version IS NOT NULL)
          AND i.issue_type <> 'Epic'
          AND {global_fv_cond}
        ORDER BY v.release_date NULLS LAST, name, i.key
    """)).fetchall()

    _rel_groups: dict[str, dict] = {}
    _unrel_groups: dict[str, dict] = {}
    _today = datetime.now(timezone.utc).date()
    for name, rdate, released, key, summary, team, resolved, status_cat, sprint, status in delayed_rows:
        rd = rdate
        if not rd:
            continue
        try:
            rd_date = date.fromisoformat(str(rd)[:10])
        except ValueError:
            continue

        if released:
            if not resolved:
                continue
            try:
                res_date = date.fromisoformat(str(resolved)[:10])
            except (ValueError, TypeError):
                continue
            if res_date <= rd_date:
                continue
            delay_days = (res_date - rd_date).days
            grp = _rel_groups.setdefault(name, {
                "fix_version": name, "release_date": rd, "released": True,
                "issues": [],
            })
        else:
            if status_cat == "Done":
                continue
            if _today <= rd_date:
                continue
            delay_days = (_today - rd_date).days
            grp = _unrel_groups.setdefault(name, {
                "fix_version": name, "release_date": rd, "released": False,
                "issues": [],
            })

        grp["issues"].append({
            "key": key, "summary": summary, "team": team,
            "sprint": sprint, "status": status,
            "delay_days": delay_days,
        })

    def _finalize(groups):
        out = []
        for g in groups.values():
            g["delayed_count"] = len(g["issues"])
            g["issues"].sort(key=lambda x: x["delay_days"], reverse=True)
            out.append(g)
        out.sort(key=lambda g: g["release_date"])
        return out

    delayed_by_fixversion = {
        "released": _finalize(_rel_groups),
        "unreleased": _finalize(_unrel_groups),
    }

    overdue_row = db.execute(text(f"""
        SELECT
            coalesce(sum(i.story_points), 0) AS total_pts,
            coalesce(sum(i.story_points) FILTER (WHERE i.status_category <> 'Done'), 0) AS late_pts
        FROM issues i
        JOIN fix_versions v ON (v.version_id = i.fix_version_id OR v.name = i.fix_version)
        WHERE v.overdue = true
          AND i.issue_type <> 'Epic'
          AND {global_fv_cond}
    """)).fetchone()
    _total_pts = float(overdue_row[0] or 0)
    _late_pts = float(overdue_row[1] or 0)
    overdue_points_pct = round(100 * _late_pts / _total_pts, 1) if _total_pts else 0.0

    remaining_points = scalar(f"""
        SELECT coalesce(sum(story_points), 0)
        FROM issues i
        WHERE i.issue_type <> 'Epic' AND i.status_category <> 'Done'
          AND {proj_cond_i}
    """) or 0
    velocity_pool = [s["completed_points"] for s in sprint_progress
                     if s.get("state") == "closed" and s["completed_points"] > 0]
    forecast_mc = forecast.monte_carlo_from(int(remaining_points), velocity_pool)

    status_rows = db.execute(text(f"""
        SELECT coalesce(v.name, i.fix_version, '(none)') AS fixversion,
               {team_expr_i} AS team,
               i.issue_type,
               count(*) AS total,
               count(*) FILTER (WHERE i.status_category = 'To Do') AS todo,
               count(*) FILTER (WHERE i.status_category = 'In Progress') AS in_progress,
               count(*) FILTER (WHERE i.status_category = 'In Review') AS in_review,
               count(*) FILTER (WHERE i.status_category = 'Done') AS done
        FROM issues i
        LEFT JOIN fix_versions v ON (v.version_id = i.fix_version_id OR v.name = i.fix_version)
        WHERE i.issue_type <> 'Epic'
          AND {global_fv_cond}
        GROUP BY coalesce(v.name, i.fix_version, '(none)'), {team_expr_i}, i.issue_type
        ORDER BY fixversion, team, i.issue_type
    """)).fetchall()
    status_breakdown = [
        {
            "fixversion": fv, "team": team, "issue_type": itype,
            "total": int(tot), "todo": int(td), "in_progress": int(ip),
            "in_review": int(ir), "done": int(dn),
        }
        for fv, team, itype, tot, td, ip, ir, dn in status_rows
    ]

    progress_rows = db.execute(text(f"""
        SELECT coalesce(i.sprint, '(none)') AS sprint,
               coalesce(s.state, 'none') AS sprint_state,
               coalesce(v.name, i.fix_version, '(none)') AS fixversion,
               CASE WHEN v.released THEN 'closed' ELSE 'active' END AS fixversion_state,
               v.release_date,
               {team_expr_i} AS team,
               i.issue_type,
               i.key,
               i.summary,
               i.status,
               i.status_category,
               i.story_points
        FROM issues i
        LEFT JOIN sprints s ON s.name = i.sprint
        LEFT JOIN fix_versions v ON (v.version_id = i.fix_version_id OR v.name = i.fix_version)
        WHERE i.issue_type <> 'Epic'
          AND {global_fv_cond}
        ORDER BY sprint, team, i.issue_type, i.key
    """)).fetchall()
    progress_issues = []
    for sp, sp_state, fv, fv_state, rdate, tm, itype, k, sm, st, stc, spoints in progress_rows:
        rd = rdate
        progress_issues.append({
            "sprint": sp, "sprint_state": sp_state, 
            "fixversion": fv, "fixversion_state": fv_state,
            "release_date": str(rd) if rd else None,
            "team": tm, "issue_type": itype,
            "key": k, "summary": sm, "status": st, "status_category": stc,
            "story_points": spoints
        })

    bug_open = scalar(f"SELECT count(*) FROM issues i WHERE i.issue_type = 'Bug' AND i.status_category <> 'Done' AND {proj_cond_i}") or 0
    bug_closed = scalar(f"SELECT count(*) FROM issues i WHERE i.issue_type = 'Bug' AND i.status_category = 'Done' AND {proj_cond_i}") or 0
    bug_points = scalar(f"SELECT COALESCE(SUM(story_points),0) FROM issues i WHERE i.issue_type = 'Bug' AND {proj_cond_i}") or 0
    _all_points = scalar(f"SELECT COALESCE(SUM(story_points),0) FROM issues i WHERE {proj_cond_i}") or 0

    defect_rows = db.execute(text(f"""
        SELECT i.sprint, {team_expr_i} AS team,
               COUNT(CASE WHEN LOWER(i.issue_type) IN ('bug', 'technical debt', 'tech debt') THEN 1 END) as bug_count,
               COUNT(CASE WHEN LOWER(i.issue_type) NOT IN ('bug', 'technical debt', 'tech debt') AND i.issue_type <> 'Epic' THEN 1 END) as other_count,
               COUNT(CASE WHEN i.issue_type <> 'Epic' THEN 1 END) as total_count,
               COALESCE(SUM(CASE WHEN LOWER(i.issue_type) IN ('bug', 'technical debt', 'tech debt') THEN i.story_points ELSE 0 END), 0) as bug_sp,
               COALESCE(SUM(CASE WHEN LOWER(i.issue_type) NOT IN ('bug', 'technical debt', 'tech debt') AND i.issue_type <> 'Epic' THEN i.story_points ELSE 0 END), 0) as other_sp,
               COALESCE(SUM(CASE WHEN i.issue_type <> 'Epic' THEN i.story_points ELSE 0 END), 0) as total_sp
        FROM issues i
        JOIN sprints s ON (i.sprint_id = s.sprint_id OR i.sprint = s.name)
        WHERE s.state = 'closed' AND i.status_category = 'Done'
          AND {proj_cond_i}
        GROUP BY i.sprint, {team_expr_i}
        ORDER BY i.sprint, {team_expr_i}
    """)).fetchall()

    defects_per_sprint = []
    _team_sp_ratios: dict[str, list[float]] = {}
    _sprint_team_ratios: dict[str, list[float]] = {}

    for r in defect_rows:
        sprint, team, bug_count, other_count, total_count, bug_sp, other_sp, total_sp = r
        if total_sp > 0:
            raw_ratio = 100.0 * bug_sp / total_sp
        elif total_count > 0:
            raw_ratio = 100.0 * bug_count / total_count
        else:
            raw_ratio = 0.0

        sp_ratio = round(raw_ratio, 1)
        _team_sp_ratios.setdefault(team, []).append(raw_ratio)
        _sprint_team_ratios.setdefault(sprint, []).append(raw_ratio)

        defects_per_sprint.append({
            "sprint": sprint,
            "team": team,
            "sprint_state": "closed",
            "bug_count": int(bug_count),
            "other_count": int(other_count),
            "total_count": int(total_count),
            "bug_sp": int(bug_sp),
            "other_sp": int(other_sp),
            "total_sp": int(total_sp),
            "defect_ratio_pct": sp_ratio,
        })

    # Active Sprint Breakdown (included in table, but excluded from overall defect ratio calculation)
    active_defect_rows = db.execute(text(f"""
        SELECT i.sprint, {team_expr_i} AS team, s.state as sprint_state,
               COUNT(CASE WHEN LOWER(i.issue_type) IN ('bug', 'technical debt', 'tech debt') THEN 1 END) as bug_count,
               COUNT(CASE WHEN LOWER(i.issue_type) NOT IN ('bug', 'technical debt', 'tech debt') AND i.issue_type <> 'Epic' THEN 1 END) as other_count,
               COUNT(CASE WHEN i.issue_type <> 'Epic' THEN 1 END) as total_count,
               COALESCE(SUM(CASE WHEN LOWER(i.issue_type) IN ('bug', 'technical debt', 'tech debt') THEN i.story_points ELSE 0 END), 0) as bug_sp,
               COALESCE(SUM(CASE WHEN LOWER(i.issue_type) NOT IN ('bug', 'technical debt', 'tech debt') AND i.issue_type <> 'Epic' THEN i.story_points ELSE 0 END), 0) as other_sp,
               COALESCE(SUM(CASE WHEN i.issue_type <> 'Epic' THEN i.story_points ELSE 0 END), 0) as total_sp
        FROM issues i
        JOIN sprints s ON (i.sprint_id = s.sprint_id OR i.sprint = s.name)
        WHERE s.state = 'active'
          AND {proj_cond_i}
        GROUP BY i.sprint, {team_expr_i}, s.state
        ORDER BY i.sprint, {team_expr_i}
    """)).fetchall()

    for r in active_defect_rows:
        sprint, team, sprint_state, bug_count, other_count, total_count, bug_sp, other_sp, total_sp = r
        if total_sp > 0:
            raw_ratio = 100.0 * bug_sp / total_sp
        elif total_count > 0:
            raw_ratio = 100.0 * bug_count / total_count
        else:
            raw_ratio = 0.0

        sp_ratio = round(raw_ratio, 1)

        defects_per_sprint.append({
            "sprint": sprint,
            "team": team,
            "sprint_state": "active",
            "bug_count": int(bug_count),
            "other_count": int(other_count),
            "total_count": int(total_count),
            "bug_sp": int(bug_sp),
            "other_sp": int(other_sp),
            "total_sp": int(total_sp),
            "defect_ratio_pct": sp_ratio,
        })

    # Step 2: Sprint Defect Ratio = average of team ratios in each closed sprint
    sprint_defect_ratios = [
        sum(ratios) / len(ratios)
        for ratios in _sprint_team_ratios.values()
        if ratios
    ]

    # Step 3: Total Defects Ratio = average of Sprint Defect Ratios across closed sprints
    overall_sp_ratio = (
        round(sum(sprint_defect_ratios) / len(sprint_defect_ratios), 1)
        if sprint_defect_ratios
        else 0.0
    )

    bug_stats = {
        "open": bug_open,
        "closed": bug_closed,
        "total": bug_open + bug_closed,
        "capacity_drag_pct": round(100 * bug_points / _all_points, 1) if _all_points else 0.0,
        "defects_per_sprint": defects_per_sprint,
        "defects_ratio_pct": overall_sp_ratio,
    }

    defects_ratio = {
        "pct": overall_sp_ratio,
        "n": len(sprint_defect_ratios),
    }

    team_defects_ratio = []
    for team, ratios in _team_sp_ratios.items():
        pct = round(sum(ratios) / len(ratios), 1) if ratios else None
        team_defects_ratio.append({
            "team": team,
            "pct": pct,
            "n_sprints": len(ratios),
        })
    team_defects_ratio.sort(key=lambda x: (x["pct"] is None, -(x["pct"] or 0)))

    return {
        "project_key": project_key or "ALL",
        "bug_stats": bug_stats,
        "status_breakdown": status_breakdown,
        "progress_issues": progress_issues,
        "total_issues": total,
        "milestone_completion": milestone_completion,
        "project_milestone": project_milestone,
        "sprint_progress": sprint_progress,
        "points_by_sprint_team": points_by_sprint_team,
        "blocked_issues": blocked_issues,
        "cross_team_blockers": cross_team_blockers,
        "cross_team_pairs": cross_team_pairs,
        "dependency_conflicts": dependency_conflicts,
        "unresolved_bugs": unresolved_bugs,
        "defects_ratio": defects_ratio,
        "team_defects_ratio": team_defects_ratio,
        "predictability": predictability,
        "team_predictability": team_predictability,
        "overcommit_next": overcommit_next,
        "overcommit_by_team": overcommit_by_team,
        "delayed_by_fixversion": delayed_by_fixversion,
        "overdue_points_pct": overdue_points_pct,
        "forecast_monte_carlo": forecast_mc,
    }



def _synthetic_metrics() -> dict:
    """Synthetic metrics generator adapter."""
    metrics = synthetic_metrics.compute_metrics()
    metrics["burn_up"] = synthetic_metrics.burnup()
    metrics["forecast_monte_carlo"] = forecast.monte_carlo()

    if isinstance(metrics.get("sprint_progress"), list):
        metrics["sprint_progress"] = _normalize_sprint_progress(metrics["sprint_progress"])

    closed = [s for s in synthetic_metrics.burnup() if s.get("state") == "closed"]
    committed = sum((s.get("committed_points") or 0) for s in closed)
    completed = sum((s.get("completed_points") or 0) for s in closed)
    late = max(committed - completed, 0)
    metrics["overdue_points_pct"] = round(100 * late / committed, 1) if committed else 0.0

    metrics.setdefault("points_by_sprint_team",
                       {"sprints": [], "teams": [], "committed": {}, "completed": {}})

    dr_val = metrics.get("defects_ratio", {}).get("pct")
    metrics.setdefault("bug_stats", {
        "open": 0, "closed": 0, "total": 0,
        "capacity_drag_pct": dr_val or 0.0,
        "defects_per_sprint": metrics.get("defects_per_sprint", []),
        "defects_ratio_pct": dr_val,
    })
    metrics.setdefault("dependency_conflicts", {"count": 0, "items": []})
    metrics.setdefault("unresolved_bugs", 0)
    metrics.setdefault("defects_ratio", {"pct": None})
    metrics.setdefault("team_defects_ratio", [])
    metrics.setdefault("predictability", {"pct": None, "n": 0})
    metrics.setdefault("team_predictability", [])
    metrics.setdefault("overcommit_next",
                       {"sprint": None, "committed": None,
                        "avg_velocity": None, "pct": None})
    metrics.setdefault("overcommit_by_team", [])
    metrics.setdefault("delayed_by_fixversion", {"released": [], "unreleased": []})
    return metrics
