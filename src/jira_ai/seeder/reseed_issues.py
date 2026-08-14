"""
reseed_issues.py — Sub-stage B: assign non-epic issues to epic+sprint+version
and set status per a per-sprint distribution.

DRY_RUN = True prints the plan only. Flip to False to write.
"""

import time
import requests
from sqlalchemy import text
from src.jira_ai.ingestion.jira_client import BASE_URL, _auth_header
from src.jira_ai.ingestion.models import SessionLocal

DRY_RUN = False
SLEEP = 0.15
AGILE = f"{BASE_URL}/rest/agile/1.0"
API = f"{BASE_URL}/rest/api/3"
TR = {"To Do": 11, "In Progress": 21, "In Review": 31, "Done": 41}

# Each row: sprint_id, epic_key, version, count, dist
# dist = explicit fractions for Done/In Review/To Do; In Progress = remainder.
PLAN = [
    (34,  "APS-428", "M0 - Preparation",           18, {"Done": 0.95, "In Review": 0.05}),
    (106, "APS-429", "M0 - Preparation",           22, {"Done": 0.90, "In Review": 0.10}),
    (36,  "APS-430", "M1 - Checkout redesign",     30, {"Done": 0.05, "In Review": 0.10, "To Do": 0.10}),  # rest In Progress
    (37,  "APS-431", "M2 - Security & compliance", 32, {"To Do": 1.00}),
    (107, "APS-432", "M3 - Launch-ready",          30, {"To Do": 1.00}),
    (108, "APS-433", "M3 - Launch-ready",          26, {"To Do": 1.00}),
    (109, "APS-434", "M3 - Launch-ready",          22, {"To Do": 1.00}),
    (110, "APS-435", "M3 - Launch-ready",          20, {"To Do": 1.00}),
]


def _keys():
    db = SessionLocal()
    rows = db.execute(text(
        "SELECT key FROM issues WHERE issue_type != 'Epic' ORDER BY key"
    )).scalars().all()
    db.close()
    return list(rows)


def _statuses_for(count, dist):
    """Build a list of `count` statuses. Explicit bands rounded; In Progress fills."""
    result = []
    for status in ("Done", "In Review", "To Do"):
        n = round(count * dist.get(status, 0))
        result += [status] * n
    # anything left over -> In Progress
    result += ["In Progress"] * (count - len(result))
    return result[:count] if len(result) >= count else result + ["In Progress"] * (count - len(result))


def _set_parent(key, epic_key):
    requests.put(f"{API}/issue/{key}", headers=_auth_header(),
                 json={"fields": {"parent": {"key": epic_key}}}).raise_for_status()

def _set_version(key, vname):
    requests.put(f"{API}/issue/{key}", headers=_auth_header(),
                 json={"fields": {"fixVersions": [{"name": vname}]}}).raise_for_status()

def _move_to_sprint(sprint_id, key):
    requests.post(f"{AGILE}/sprint/{sprint_id}/issue", headers=_auth_header(),
                  json={"issues": [key]}).raise_for_status()

def _transition(key, status_name):
    requests.post(f"{API}/issue/{key}/transitions", headers=_auth_header(),
                  json={"transition": {"id": str(TR[status_name])}}).raise_for_status()


def main():
    keys = _keys()
    total_planned = sum(p[3] for p in PLAN)
    print(f"DB non-epic issues: {len(keys)} | plan total: {total_planned} | DRY_RUN={DRY_RUN}")
    if len(keys) != total_planned:
        print(f"  !! mismatch: {len(keys)} keys vs {total_planned} planned")

    cursor = ok = err = 0
    for sprint_id, epic_key, vname, count, dist in PLAN:
        bucket = keys[cursor:cursor + count]
        cursor += count
        statuses = _statuses_for(len(bucket), dist)
        from collections import Counter
        print(f"\n=== Sprint {sprint_id} / {epic_key} / {vname} : {len(bucket)} issues "
              f"| {dict(Counter(statuses))} ===")
        for key, status in zip(bucket, statuses):
            if DRY_RUN:
                print(f"  [plan] {key} -> {epic_key}, sprint {sprint_id}, {vname}, {status}")
                continue
            try:
                _set_parent(key, epic_key);      time.sleep(SLEEP)
                _move_to_sprint(sprint_id, key); time.sleep(SLEEP)
                _set_version(key, vname);        time.sleep(SLEEP)
                _transition(key, status);        time.sleep(SLEEP)
                ok += 1
                if ok % 20 == 0:
                    print(f"    ...{ok} done")
            except requests.HTTPError as e:
                err += 1
                print(f"  !! {key} failed: {e} — {e.response.text[:150]}")

    leftover = keys[cursor:]
    if leftover:
        print(f"\nLeftover ({len(leftover)}): {leftover}")
    if not DRY_RUN:
        print(f"\nDone. ok={ok} err={err} leftover={len(leftover)}")


if __name__ == "__main__":
    main()
