"""
synthetic_metrics.py — Pure metric computation over the synthetic dataset.

Takes the in-memory dataset from synthetic_dataset.build_synthetic_dataset()
and computes the same metric shapes the real DB path produces, plus the
committed-vs-completed burn-up. No database, no SQL — pure Python so synthetic
and real data can be compared apples-to-apples.
"""

from datetime import datetime, UTC, date
from collections import defaultdict

from src.jira_ai.seeder.synthetic_dataset import build_synthetic_dataset


def _days_until(iso_date: str | None) -> int | None:
    if not iso_date:
        return None
    try:
        target = date.fromisoformat(iso_date[:10])
    except ValueError:
        return None
    return (target - datetime.now(UTC).date()).days


def _work_issues(data):
    return [i for i in data["issues"] if i["issue_type"] != "Epic"]


def compute_metrics(data=None) -> dict:
    """Assessment metrics (mirrors assessment._compute_metrics shape)."""
    data = data or build_synthetic_dataset()
    issues = data["issues"]
    work = _work_issues(data)
    links = data["links"]
    by_key = {i["key"]: i for i in issues}
    fv_dates = {v["name"]: v["release_date"] for v in data["fix_versions"]}
    sprint_by_name = {s["name"]: s for s in data["sprints"]}

    # Milestone completion, with release dates + days-to-release.
    ms = defaultdict(lambda: {"total": 0, "done": 0})
    for i in work:
        fv = i["fix_version"]
        if not fv:
            continue
        ms[fv]["total"] += 1
        if i["status_category"] == "Done":
            ms[fv]["done"] += 1
    milestone_completion = {}
    for name in sorted(ms, key=lambda n: (fv_dates.get(n) or "9999", n)):
        rd = fv_dates.get(name)
        t, dn = ms[name]["total"], ms[name]["done"]
        milestone_completion[name] = {
            "release_date": rd,
            "days_to_release": _days_until(rd),
            "total": t, "done": dn,
            "percent_done": round(100 * dn / t) if t else 0,
        }

    # Sprint progress, ordered by start date.
    sp = defaultdict(lambda: {"total": 0, "done": 0, "points": 0})
    for i in work:
        s = i["sprint"]
        if not s:
            continue
        sp[s]["total"] += 1
        sp[s]["points"] += i["story_points"] or 0
        if i["status_category"] == "Done":
            sp[s]["done"] += 1
    sprint_progress = []
    for s in data["sprints"]:
        name = s["name"]
        agg = sp.get(name, {"total": 0, "done": 0, "points": 0})
        sprint_progress.append({
            "sprint": name, "state": s["state"],
            "start_date": s["start_date"], "end_date": s["end_date"],
            "total": agg["total"], "done": agg["done"],
            "percent_done": round(100 * agg["done"] / agg["total"]) if agg["total"] else 0,
            "committed_points": s["committed_points"],
            "completed_points": s["completed_points"],
        })

    # Dependency health.
    blocked_issues = len({l["target_key"] for l in links})
    cross = 0
    pair_counts = defaultdict(int)
    for l in links:
        b, t = by_key.get(l["source_key"]), by_key.get(l["target_key"])
        if b and t and b["team"] and t["team"] and b["team"] != t["team"]:
            cross += 1
            pair_counts[(b["team"], t["team"])] += 1
    cross_team_pairs = [
        {"blocker_team": bt, "blocked_team": tt, "count": n}
        for (bt, tt), n in sorted(pair_counts.items(), key=lambda kv: -kv[1])
    ]

    # Schedule-risk: not-Done blocker holding up work whose sprint ends within 14 days.
    at_risk = []
    horizon = None
    today = datetime.now(UTC).date()
    for l in links:
        b, t = by_key.get(l["source_key"]), by_key.get(l["target_key"])
        if not (b and t):
            continue
        if b["status_category"] == "Done":
            continue
        ts = sprint_by_name.get(t["sprint"] or "")
        if not ts or not ts["end_date"]:
            continue
        end = date.fromisoformat(ts["end_date"][:10])
        if 0 <= (end - today).days <= 14 or end < today:
            at_risk.append({
                "blocker": b["key"], "blocker_summary": b["summary"],
                "blocker_status": b["status_category"], "blocker_team": b["team"],
                "blocked": t["key"], "blocked_summary": t["summary"],
                "blocked_team": t["team"], "blocked_sprint": t["sprint"],
                "blocked_sprint_end": ts["end_date"],
            })

    # Defects ratio across closed sprints
    closed_sprints = {s["name"] for s in data["sprints"] if s["state"] == "closed"}
    sprint_defect_ratios = []
    defects_per_sprint = []

    for sname in closed_sprints:
        # Group by team in sprint
        team_names = {
            i.get("team") for i in work
            if i.get("sprint") == sname and i.get("status_category") == "Done" and i.get("team")
        }
        team_ratios = []
        for tname in sorted(team_names):
            d_cnt = sum(1 for i in work if i.get("sprint") == sname and i.get("team") == tname and i.get("status_category") == "Done" and (i.get("issue_type") or "").lower() in ("bug", "technical debt", "tech debt"))
            o_cnt = sum(1 for i in work if i.get("sprint") == sname and i.get("team") == tname and i.get("status_category") == "Done" and (i.get("issue_type") or "").lower() not in ("bug", "technical debt", "tech debt"))
            tot_cnt = d_cnt + o_cnt

            d_sp = sum(i.get("story_points") or 0 for i in work
                       if i.get("sprint") == sname and i.get("team") == tname and i.get("status_category") == "Done"
                       and (i.get("issue_type") or "").lower() in ("bug", "technical debt", "tech debt"))
            o_sp = sum(i.get("story_points") or 0 for i in work
                       if i.get("sprint") == sname and i.get("team") == tname and i.get("status_category") == "Done"
                       and (i.get("issue_type") or "").lower() not in ("bug", "technical debt", "tech debt"))
            tot_sp = d_sp + o_sp

            if tot_sp > 0:
                raw_r = d_sp / tot_sp
                team_ratios.append(raw_r)
                sp_ratio = round(100.0 * raw_r, 1)
            elif tot_cnt > 0:
                raw_r = d_cnt / tot_cnt
                team_ratios.append(raw_r)
                sp_ratio = round(100.0 * raw_r, 1)
            else:
                sp_ratio = 0.0

            defects_per_sprint.append({
                "sprint": sname,
                "team": tname,
                "sprint_state": "closed",
                "bug_count": int(d_cnt),
                "other_count": int(o_cnt),
                "total_count": int(tot_cnt),
                "bug_sp": int(d_sp),
                "other_sp": int(o_sp),
                "total_sp": int(tot_sp),
                "defect_ratio_pct": sp_ratio,
            })

        if team_ratios:
            sprint_defect_ratios.append(sum(team_ratios) / len(team_ratios))

    # Active sprints (included in defects_per_sprint, but NOT added to sprint_defect_ratios)
    active_sprints = {s["name"] for s in data["sprints"] if s.get("state") == "active"}
    for sname in active_sprints:
        team_names = {
            i.get("team") for i in work
            if i.get("sprint") == sname and i.get("team")
        }
        for tname in sorted(team_names):
            d_cnt = sum(1 for i in work if i.get("sprint") == sname and i.get("team") == tname and (i.get("issue_type") or "").lower() in ("bug", "technical debt", "tech debt"))
            o_cnt = sum(1 for i in work if i.get("sprint") == sname and i.get("team") == tname and (i.get("issue_type") or "").lower() not in ("bug", "technical debt", "tech debt"))
            tot_cnt = d_cnt + o_cnt

            d_sp = sum(i.get("story_points") or 0 for i in work
                       if i.get("sprint") == sname and i.get("team") == tname
                       and (i.get("issue_type") or "").lower() in ("bug", "technical debt", "tech debt"))
            o_sp = sum(i.get("story_points") or 0 for i in work
                       if i.get("sprint") == sname and i.get("team") == tname
                       and (i.get("issue_type") or "").lower() not in ("bug", "technical debt", "tech debt"))
            tot_sp = d_sp + o_sp

            if tot_sp > 0:
                raw_r = d_sp / tot_sp
                sp_ratio = round(100.0 * raw_r, 1)
            elif tot_cnt > 0:
                raw_r = d_cnt / tot_cnt
                sp_ratio = round(100.0 * raw_r, 1)
            else:
                sp_ratio = 0.0

            defects_per_sprint.append({
                "sprint": sname,
                "team": tname,
                "sprint_state": "active",
                "bug_count": int(d_cnt),
                "other_count": int(o_cnt),
                "total_count": int(tot_cnt),
                "bug_sp": int(d_sp),
                "other_sp": int(o_sp),
                "total_sp": int(tot_sp),
                "defect_ratio_pct": sp_ratio,
            })

    defects_ratio = {
        "pct": round(100 * (sum(sprint_defect_ratios) / len(sprint_defect_ratios)), 1) if sprint_defect_ratios else None,
        "n": len(sprint_defect_ratios),
    }

    return {
        "total_issues": len(issues),
        "milestone_completion": milestone_completion,
        "project_milestone": data.get("project_milestone"),
        "sprint_progress": sprint_progress,
        "blocked_issues": blocked_issues,
        "cross_team_blockers": cross,
        "cross_team_pairs": cross_team_pairs,
        "at_risk_dependencies": at_risk,
        "defects_ratio": defects_ratio,
        "defects_per_sprint": defects_per_sprint,
    }


def burnup(data=None) -> list:
    """Committed vs completed points per sprint (burn-up basis)."""
    data = data or build_synthetic_dataset()
    return [
        {
            "sprint": s["name"], "state": s["state"],
            "committed_points": s["committed_points"],
            "completed_points": s["completed_points"],
        }
        for s in data["sprints"]
    ]


def remaining_work_points(data=None) -> int:
    """Total story points on issues not yet Done (work items only)."""
    data = data or build_synthetic_dataset()
    return sum((i["story_points"] or 0) for i in _work_issues(data)
               if i["status_category"] != "Done")


def velocity_pool(data=None) -> list:
    """Completed points of closed sprints — the Monte Carlo velocity sample."""
    data = data or build_synthetic_dataset()
    return [s["completed_points"] for s in data["sprints"] if s["state"] == "closed"]
