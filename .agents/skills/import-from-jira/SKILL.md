---
name: import-from-jira
description: Ingests and synchronizes issues, sprints, epics, and changelog history from Jira instances or synthetic data sources into the program analytics database.
---

# Skill: Import from Jira

This skill defines the data ingestion and synchronization workflow for Jira project data used in Project Horizon analytics.

## Responsibilities

1. **Jira API Connection & Querying**:
   - Query Jira REST API (JQL) for issues matching project keys.
   - Fetch associated sprint metadata, fix-versions, issue links (dependencies/blockers), and changelog entries.

2. **Data Normalization & Storage**:
   - Normalize issue statuses into standard categories (`To Do`, `In Progress`, `Done`).
   - Store normalized records into the PostgreSQL `issues` and `sprints` tables.
   - Maintain historical sprint commitment vs. completed story point snapshots for velocity tracking.

3. **Dependency Mapping**:
   - Extract `blocks` and `is blocked by` links to construct the program dependency graph.
   - Detect cross-sprint dependency inversions (where a prerequisite is scheduled later than the dependent work).

## Usage

When running ingestion via CLI or agent commands:
- Seed database with synthetic demo data: `python -m src.jira_ai.db.seed`
- Trigger ingestion from live Jira API: `python -m src.jira_ai.ingestion.fetch_jira`
