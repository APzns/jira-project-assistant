---
name: ingest-jira
description: Workflow for querying Jira Cloud or Server REST endpoints, extracting sprint & issue entities, and writing normalized tables into the PostgreSQL database.
---

# Skill: Ingest Jira Data

This skill provides step-by-step instructions for extracting data from active Jira projects and loading it into the local PostgreSQL analytical storage.

## Ingestion Steps

1. **Authentication**: Uses Jira API token with Basic Auth over HTTPS.
2. **Entity Extraction**:
   - Issues: keys, summaries, story points, status, fixVersions, assignees, components.
   - Sprints: sprint names, start dates, end dates, completed dates, states.
   - Changelog: status transitions and story point revisions.
3. **Database Write**: Upsert into `issues` and `sprints` tables with idempotency.
