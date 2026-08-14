"""
dataset.py — Deterministic synthetic program dataset (DEMO).

Produces one coherent, fully self-consistent program in memory: sprints (with
committed vs completed story points), epics mapped to milestones M0-M3, ~200
issues following a completion ramp, teams, and blocking links (including a
cross-team cluster and a schedule-risk dependency). Everything is derived from
a fixed seed so it is identical run-to-run, and every derived metric is
consistent by construction — no stale snapshots, no drift.

This is the source of truth for "what good data looks like" while the real
Jira ingestion is being reworked. Nothing here touches the database.

Anchor: Sprint 3 is active, "today" sits inside it. Dates chain in 14-day
cycles from 2026-06-19 to 2026-10-09 (M3 / go-live).
"""

from functools import lru_cache
import random

TEAMS = ["Platform Core", "Checkout Squad", "Security Guild",
         "Growth Squad", "Mobile Team", "Data Insights"]

# (name, state, start, end, committed_pts, completed_pts)
# Closed sprints show realistic slippage (completed < committed).
# Active sprint is partway. Future sprints: committed scope, 0 completed.
SPRINTS = [
    ("Sprint 1 - Discovery",         "closed", "2026-06-19", "2026-07-03", 105,  92),
    ("Sprint 2 - Architecture",      "closed", "2026-07-03", "2026-07-17", 118, 101),
    ("Sprint 3 - Checkout Redesign", "active", "2026-07-17", "2026-07-31", 132,  18),
    ("Sprint 4 - Security",          "future", "2026-07-31", "2026-08-14", 140,   0),
    ("Sprint 5 - Core Features",     "future", "2026-08-14", "2026-08-28", 138,   0),
    ("Sprint 6 - Integration",       "future", "2026-08-28", "2026-09-11", 130,   0),
    ("Sprint 7 - Hardening & UAT",   "future", "2026-09-11", "2026-09-25", 120,   0),
    ("Sprint 8 - Go-Live",           "future", "2026-09-25", "2026-10-09", 110,   0),
]

# (epic_key, summary, milestone, sprint_index)
EPICS = [
    ("SYN-1", "Discovery & Requirements",   "M0 - Preparation",           0),
    ("SYN-2", "Architecture & Setup",       "M0 - Preparation",           1),
    ("SYN-3", "Checkout Redesign",          "M1 - Checkout redesign",     2),
    ("SYN-4", "Security & Compliance",      "M2 - Security & compliance", 3),
    ("SYN-5", "Core Launch Features",       "M3 - Launch-ready",          4),
    ("SYN-6", "Integration & Migration",    "M3 - Launch-ready",          5),
    ("SYN-7", "Hardening & UAT",            "M3 - Launch-ready",          6),
    ("SYN-8", "Launch & Go-Live",           "M3 - Launch-ready",          7),
]

# Milestone release dates (fix versions).
FIX_VERSIONS = [
    {"version_id": "9001", "name": "M0 - Preparation",           "release_date": "2026-07-17"},
    {"version_id": "9002", "name": "M1 - Checkout redesign",     "release_date": "2026-07-31"},
    {"version_id": "9003", "name": "M2 - Security & compliance", "release_date": "2026-08-14"},
    {"version_id": "9004", "name": "M3 - Launch-ready",          "release_date": "2026-10-09"},
]

# Per-sprint issue counts and the fraction Done / In Review at "today".
# Past sprints ~ their completion; active ~ early; future = 0 done.
# (count, frac_done, frac_in_review)  — rest split In Progress / To Do.
SPRINT_SHAPE = [
    (18, 0.94, 0.06),   # S1 closed
    (22, 0.90, 0.05),   # S2 closed
    (30, 0.07, 0.10),   # S3 active
    (32, 0.00, 0.00),   # S4 future
    (30, 0.00, 0.00),   # S5 future
    (26, 0.00, 0.00),   # S6 future
    (22, 0.00, 0.00),   # S7 future
    (20, 0.00, 0.00),   # S8 future
]

ISSUE_TYPES = ["Story", "Task", "Bug", "Feature"]
PRIORITIES = ["Lowest", "Low", "Medium", "High", "Highest"]
SUMMARIES = [
    "Build payment module", "Refactor api gateway", "Enable user profile",
    "Support notifications", "Roll out login flow", "Document export feature",
    "Upgrade search", "Fix checkout crash", "Add audit logging",
    "Harden session handling", "Migrate legacy data", "Wire analytics events",
]


def _status_for(rng, frac_done, frac_review):
    """Pick a status consistent with the sprint's completion shape."""
    r = rng.random()
    if r < frac_done:
        return "Done", "Done"
    if r < frac_done + frac_review:
        return "In Review", "In Progress"
    # Remainder: mostly To Do for future sprints, some In Progress for active.
    if rng.random() < 0.4:
        return "In Progress", "In Progress"
    return "To Do", "To Do"


@lru_cache(maxsize=1)
def build_synthetic_dataset(seed: int = 42) -> dict:
    """Return the full synthetic dataset. Cached: built once per process."""
    rng = random.Random(seed)

    sprints = [
        {
            "sprint_id": str(100 + i),
            "name": name,
            "state": state,
            "start_date": f"{start}T10:00:00.000Z",
            "end_date": f"{end}T10:00:00.000Z",
            "committed_points": committed,
            "completed_points": completed,
        }
        for i, (name, state, start, end, committed, completed) in enumerate(SPRINTS)
    ]

    issues = []
    next_id = 100
    # Epic issues themselves.
    for epic_key, summary, milestone, _si in EPICS:
        issues.append({
            "key": epic_key, "summary": summary, "issue_type": "Epic",
            "status": "In Progress", "status_category": "In Progress",
            "priority": "Medium", "epic_key": None, "team": None,
            "sprint": None, "sprint_id": None,
            "fix_version": milestone, "story_points": None,
        })

    # Work issues per sprint.
    for si, (count, frac_done, frac_review) in enumerate(SPRINT_SHAPE):
        epic_key, _es, milestone, _esi = EPICS[si]
        sprint = sprints[si]
        for _ in range(count):
            next_id += 1
            status, cat = _status_for(rng, frac_done, frac_review)
            issues.append({
                "key": f"SYN-{next_id}",
                "summary": rng.choice(SUMMARIES),
                "issue_type": rng.choice(ISSUE_TYPES),
                "status": status,
                "status_category": cat,
                "priority": rng.choice(PRIORITIES),
                "epic_key": epic_key,
                "team": rng.choice(TEAMS),
                "sprint": sprint["name"],
                "sprint_id": sprint["sprint_id"],
                "fix_version": milestone,
                "story_points": rng.choice([1, 2, 3, 5, 8]),
            })

    # --- Blocking links. Build a realistic cross-team cluster plus one
    # schedule-risk dependency (a not-Done blocker holding up near-term work). ---
    links = _build_links(rng, issues, sprints)

    return {
        "issues": issues,
        "links": links,
        "sprints": sprints,
        "fix_versions": FIX_VERSIONS,
        "project_milestone": "M3 - Launch-ready",
    }


def _build_links(rng, issues, sprints):
    """Create ~18 Blocks links: a cross-team cluster + a schedule-risk case."""
    work = [i for i in issues if i["issue_type"] != "Epic"]
    by_team = {}
    for i in work:
        by_team.setdefault(i["team"], []).append(i)

    links = []
    seen = set()

    def add(blocker, blocked):
        pair = (blocker["key"], blocked["key"])
        if (blocker["key"] == blocked["key"]) or pair in seen:
            return
        seen.add(pair)
        links.append({"source_key": blocker["key"],
                      "target_key": blocked["key"], "link_type": "Blocks"})

    # Cross-team cluster: Platform Core and Security Guild block others often.
    heavy_blockers = ["Platform Core", "Security Guild", "Checkout Squad"]
    for _ in range(14):
        bt = rng.choice(heavy_blockers)
        blocker = rng.choice(by_team.get(bt, work))
        blocked = rng.choice(work)
        if blocker["team"] != blocked["team"]:
            add(blocker, blocked)

    # A few same-team blocks for realism.
    for _ in range(4):
        a, b = rng.choice(work), rng.choice(work)
        add(a, b)

    # Deliberate schedule-risk: a not-Done blocker in the active sprint holds
    # up work in an imminent (active/near-future) sprint.
    active_name = next(s["name"] for s in sprints if s["state"] == "active")
    active_work = [i for i in work if i["sprint"] == active_name
                   and i["status_category"] != "Done"]
    if len(active_work) >= 2:
        add(active_work[0], active_work[1])

    return links
