---
name: ingest-jira
description: Ingests and synchronizes issues, sprints, epics, fix-versions, and dependency links from live Jira instances (REST API/JQL) or deterministic synthetic datasets into PostgreSQL analytical storage, clearing skill analysis cache upon completion.
---

# Skill: Ingest Jira Data

This skill defines the data ingestion, synchronization, and caching workflow for Jira project data used in Project Horizon analytics.

## Responsibilities & Workflow

1. **Authentication & Connection**:
   - Uses Jira Cloud/Server API tokens with Basic Auth over HTTPS.
   - Discovers custom field IDs (Story Points, Sprint, Team) dynamically at runtime.

2. **Entity Ingestion & Normalization**:
   - **Issues**: Keys, summaries, issue types, statuses (normalized to `To Do`, `In Progress`, `Done`), priorities, epics, assignees, components, and due dates.
   - **Sprints**: Sprint names, start dates, end dates, completed dates, states (`active`, `closed`, `future`).
   - **Fix Versions**: Milestone versions, target release dates, and release states.
   - **Dependencies**: Normalized directional `Blocks` issue links.

3. **Cache Invalidation & Metrics Warmup**:
   - Automatically executes `warmup_assessment_cache()` for all registered projects.
   - Invalidates `SkillCache` records so subsequent skill analysis requests fetch fresh data.

## Execution Commands

- **Ingest all registered projects from Live Jira**:
  ```bash
  python -m src.jira_ai.ingestion.run_ingestion --all
  ```
- **Ingest a specific project**:
  ```bash
  python -m src.jira_ai.ingestion.run_ingestion --project CHK
  ```
- **Seed synthetic demo data**:
  ```bash
  python -m src.jira_ai.seeder.seed_jira --project CHK
  ```
