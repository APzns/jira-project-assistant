"""
create_dependencies.py — Creates realistic 'Blocks' dependencies in Jira.

Picks ~NUM_LINKS blocker->blocked pairs, biased toward cross-epic and
cross-team relationships (so cross-team blocker risk has signal), and targets
non-Done issues as the blocked side (a blocked-but-Done issue looks odd).

Jira has no batch endpoint for links, so each pair is a separate
POST /rest/api/3/issueLink call.
"""

import random
import requests

from src.jira_ai.seeder.jira_common import BASE_URL, PROJECT_KEY, auth_header

NUM_LINKS = 40
CROSS_TEAM_BIAS = 0.75   # fraction of links we try to make cross-team
TEAM_FIELD_ID = "customfield_10001"


def _fetch_candidates() -> list[dict]:
    """Return non-epic issues with key, parent epic key, team name, and done flag."""
    out, token = [], None
    while True:
        payload = {
            "jql": f"project = {PROJECT_KEY} AND issuetype != Epic",
            "fields": ["parent", "status", TEAM_FIELD_ID],
            "maxResults": 100,
        }
        if token:
            payload["nextPageToken"] = token
        data = requests.post(
            f"{BASE_URL}/rest/api/3/search/jql",
            headers=auth_header(), json=payload,
        ).json()
        for i in data.get("issues", []):
            f = i.get("fields", {})
            team = f.get(TEAM_FIELD_ID) or {}
            status_cat = ((f.get("status") or {}).get("statusCategory") or {}).get("key")
            out.append({
                "key": i["key"],
                "epic": (f.get("parent") or {}).get("key"),
                "team": team.get("name") if isinstance(team, dict) else None,
                "done": status_cat == "done",
            })
        if data.get("isLast", True) or not data.get("nextPageToken"):
            break
        token = data["nextPageToken"]
    return out


def create_link(blocker: str, blocked: str) -> bool:
    resp = requests.post(
        f"{BASE_URL}/rest/api/3/issueLink",
        headers=auth_header(),
        json={
            "type": {"name": "Blocks"},
            "outwardIssue": {"key": blocker},
            "inwardIssue": {"key": blocked},
        },
    )
    if resp.status_code >= 300:
        print(f"  ! {blocker} blocks {blocked}: {resp.status_code} {resp.text[:120]}")
        return False
    return True


def main() -> None:
    print("=== Creating 'Blocks' dependencies ===")
    issues = _fetch_candidates()
    print(f"Loaded {len(issues)} candidate issues.")

    # Blocked side: prefer non-Done issues so dependencies look active.
    not_done = [i for i in issues if not i["done"]]
    blocked_pool = not_done if not_done else issues

    seen: set[tuple[str, str]] = set()
    created = 0
    attempts = 0
    max_attempts = NUM_LINKS * 20

    while created < NUM_LINKS and attempts < max_attempts:
        attempts += 1
        blocker = random.choice(issues)
        blocked = random.choice(blocked_pool)

        if blocker["key"] == blocked["key"]:
            continue
        pair = (blocker["key"], blocked["key"])
        if pair in seen or (blocked["key"], blocker["key"]) in seen:
            continue

        # Bias: prefer cross-team pairs most of the time.
        cross_team = (
            blocker["team"] and blocked["team"] and blocker["team"] != blocked["team"]
        )
        if not cross_team and random.random() < CROSS_TEAM_BIAS:
            continue  # skip same-team pair this round, try again

        if create_link(blocker["key"], blocked["key"]):
            seen.add(pair)
            created += 1
            tag = "cross-team" if cross_team else "same-team"
            print(f"  [{created}/{NUM_LINKS}] {blocker['key']} blocks {blocked['key']} ({tag})")

    print(f"\nDone. Created {created} Blocks links "
          f"({sum(1 for a, b in seen)} unique pairs).")


if __name__ == "__main__":
    main()
