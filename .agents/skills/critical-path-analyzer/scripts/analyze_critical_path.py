#!/usr/bin/env python3
"""
analyze_critical_path.py — Algorithmic DAG analysis for critical blocker paths and SPOFs.
Outputs a compact JSON summary to minimize LLM token consumption.
"""

import sys
import json
import argparse
from pathlib import Path
from collections import defaultdict, deque

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parents[4]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def load_data(project_key=None):
    """Load issues and links from database or fallback to deterministic synthetic dataset."""
    issues, links = [], []
    try:
        from src.jira_ai.ingestion.models import SessionLocal, Issue, IssueLink
        db = SessionLocal()
        query = db.query(Issue)
        if project_key and project_key.upper() not in ("ALL", "GLOBAL"):
            query = query.filter(Issue.key.like(f"{project_key.upper()}-%"))
        db_issues = query.all()
        if db_issues:
            issues = [
                {
                    "key": i.key,
                    "summary": i.summary,
                    "issue_type": i.issue_type,
                    "status": i.status,
                    "status_category": i.status_category,
                    "story_points": i.story_points or 0,
                    "team": i.team or "Unassigned",
                    "sprint": i.sprint,
                    "fix_version": i.fix_version,
                }
                for i in db_issues
            ]
            links = [
                {"source_key": l.source_key, "target_key": l.target_key, "link_type": l.link_type}
                for l in db.query(IssueLink).all()
            ]
        db.close()
    except Exception:
        pass

    if not issues:
        from src.jira_ai.seeder.synthetic_dataset import build_synthetic_dataset
        data = build_synthetic_dataset()
        issues = data["issues"]
        links = data["links"]
        if project_key and project_key.upper() not in ("ALL", "GLOBAL"):
            issues = [i for i in issues if i["key"].startswith(f"{project_key.upper()}-")]
            valid_keys = {i["key"] for i in issues}
            links = [l for l in links if l["source_key"] in valid_keys and l["target_key"] in valid_keys]

    return issues, links


def find_cycles(adj):
    """Detect cycles (circular dependencies) in directed graph."""
    visited = {}
    cycles = []

    def dfs(node, path):
        visited[node] = 1
        for neighbor in adj.get(node, []):
            if visited.get(neighbor) == 1:
                idx = path.index(neighbor) if neighbor in path else 0
                cycles.append(path[idx:] + [neighbor])
            elif visited.get(neighbor) == 0 or neighbor not in visited:
                dfs(neighbor, path + [neighbor])
        visited[node] = 2

    for node in list(adj.keys()):
        if node not in visited:
            dfs(node, [node])
    return cycles


def compute_critical_path(issues, links, target_version=None):
    """Computes critical paths, SPOFs, and graph metrics."""
    issue_map = {i["key"]: i for i in issues}
    
    # Adjacency list: source_key blocks target_key (source -> target)
    adj = defaultdict(list)
    in_degree = defaultdict(int)
    out_degree = defaultdict(int)
    all_nodes = set(issue_map.keys())

    for link in links:
        src, tgt = link["source_key"], link["target_key"]
        if src in issue_map and tgt in issue_map:
            adj[src].append(tgt)
            out_degree[src] += 1
            in_degree[tgt] += 1

    # Detect cycles
    cycles = find_cycles(adj)

    # Detect High-Fanout Blockers / SPOFs (blocking 3+ downstream issues)
    spof_candidates = []
    cross_team_blockers = []
    for src, targets in adj.items():
        src_issue = issue_map.get(src, {})
        src_team = src_issue.get("team", "Unknown")
        
        # Check cross team blocks
        for tgt in targets:
            tgt_issue = issue_map.get(tgt, {})
            tgt_team = tgt_issue.get("team", "Unknown")
            if src_team != tgt_team:
                cross_team_blockers.append({
                    "blocker_key": src,
                    "blocker_summary": src_issue.get("summary"),
                    "blocker_team": src_team,
                    "blocker_status": src_issue.get("status_category"),
                    "blocked_key": tgt,
                    "blocked_summary": tgt_issue.get("summary"),
                    "blocked_team": tgt_team,
                    "blocked_status": tgt_issue.get("status_category"),
                })

        if len(targets) >= 2 and src_issue.get("status_category") != "Done":
            spof_candidates.append({
                "key": src,
                "summary": src_issue.get("summary"),
                "team": src_team,
                "status": src_issue.get("status"),
                "status_category": src_issue.get("status_category"),
                "story_points": src_issue.get("story_points", 0),
                "blocks_count": len(targets),
                "blocked_keys": targets,
            })

    spof_candidates.sort(key=lambda x: x["blocks_count"], reverse=True)

    # Compute Longest Blocker Paths (Critical Paths)
    # Using dynamic programming / DAG longest path
    memo = {}

    def get_longest_path(node):
        if node in memo:
            return memo[node]
        node_sp = issue_map[node].get("story_points", 0) if issue_map[node].get("status_category") != "Done" else 0
        if not adj[node]:
            res = ([node], node_sp)
            memo[node] = res
            return res

        best_path = []
        max_sp = -1
        for neighbor in adj[node]:
            sub_path, sub_sp = get_longest_path(neighbor)
            if sub_sp > max_sp:
                max_sp = sub_sp
                best_path = sub_path

        res = ([node] + best_path, node_sp + max_sp)
        memo[node] = res
        return res

    all_paths = []
    # Start from root nodes (in-degree == 0 that have outgoing links)
    root_nodes = [n for n in all_nodes if in_degree[n] == 0 and out_degree[n] > 0]
    for root in root_nodes:
        path_keys, total_sp = get_longest_path(root)
        if len(path_keys) > 1:
            detailed_path = [
                {
                    "key": k,
                    "summary": issue_map[k].get("summary"),
                    "team": issue_map[k].get("team"),
                    "status": issue_map[k].get("status"),
                    "status_category": issue_map[k].get("status_category"),
                    "story_points": issue_map[k].get("story_points", 0),
                }
                for k in path_keys
            ]
            all_paths.append({
                "hop_count": len(path_keys),
                "total_story_points": total_sp,
                "path_keys": path_keys,
                "nodes": detailed_path,
            })

    all_paths.sort(key=lambda p: (p["hop_count"], p["total_story_points"]), reverse=True)

    summary = {
        "total_issues_analyzed": len(issues),
        "total_blocker_links": len(links),
        "circular_dependencies_count": len(cycles),
        "circular_loops": cycles,
        "spof_hub_blockers_count": len(spof_candidates),
        "spof_hub_blockers": spof_candidates[:5],
        "cross_team_blockers_count": len(cross_team_blockers),
        "cross_team_blockers_sample": cross_team_blockers[:8],
        "longest_critical_paths": all_paths[:3],
    }
    return summary


def main():
    parser = argparse.ArgumentParser(description="Analyze critical dependency paths in Jira issues.")
    parser.add_argument("--project-key", default=None, help="Filter by project key prefix")
    parser.add_argument("--target-version", default=None, help="Target Fix Version")
    args = parser.parse_args()

    issues, links = load_data(args.project_key)
    result = compute_critical_path(issues, links, args.target_version)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
