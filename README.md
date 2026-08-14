# Program Intelligence — AI Program Management Assistant

An AI-powered program-management tool that reads a project's plan (charter, risks, decisions) alongside live Jira data and produces a program-status assessment: an overall RAG verdict, per-milestone status, triggered risks, a delivery forecast, and recommended actions — with charts and tables as the supporting evidence layer.

Built as a portfolio project to demonstrate end-to-end delivery: data ingestion, a database, an API, an LLM reasoning layer, and a dashboard.

## Why this exists

Most Jira dashboards report *what happened*. This tool interprets *what it means*. It compares the program's stated intent (goals, milestones, risk thresholds, deliberate trade-offs) against reality (live issue data) and answers the questions a Technical Program Manager actually asks: Are we on track? What's about to go wrong? What should we do this week?

## Architecture

```
Jira  ->  Ingestion  ->  Postgres  ->  FastAPI  ->  Dashboard (dark, 3 tabs)
                                          |
                          +---------------+----------------+
                          v               v                v
                     /stats (metrics)  /ask (NL->SQL)   /assess (AI briefing)
                                                            ^
                                              project_data/*.md (plan/intent)
                                                     + Gemini reasoning
```

- **Ingestion** pulls Jira issues into Postgres (idempotent upsert).
- **Metrics** are computed deterministically in SQL — trustworthy numbers.
- **/ask** turns a natural-language question into a read-only SQL query.
- **/assess** combines computed metrics + the project plan and uses Gemini to produce a structured program assessment, cached in the database.

## Tech stack

- **Python / FastAPI** — API layer
- **PostgreSQL + SQLAlchemy** — data store and ORM
- **Google Gemini (google-genai SDK)** — reasoning layer for /assess and /ask
- **Chart.js** — dashboard charts
- **Docker** — local Postgres and the deployment container image

## Project structure

```
src/jira_ai/
  ingestion/      # Jira pull + SQLAlchemy models (Issue, AssessmentCache)
  api/
    routes/       # ask, assess, stats, docs endpoints
    services/     # metrics, assessment, context, llm
frontend/         # static dashboard (index.html, styles.css, app.js)
project_data/     # the program "intent": charter, risks, decisions, etc.
```

## The project_data files

The assessment agent reasons over these markdown files, which capture the *intent* Jira can't hold:

- **charter.md** — goal, workstreams, milestones, planned velocity, success criteria
- **risks.md** — risk register with concrete, checkable triggers
- **decisions.md** — deliberate trade-offs, so the agent doesn't flag them as problems
- **definitions.md** — what "on track / at risk / off track" mean, thresholds
- **stakeholders.md** — who cares about what

## Setup

Prerequisites: Python 3.11+, Docker, a Gemini API key.

1. Clone and create a virtual environment:

```
python -m venv venv
venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

2. Create a `.env` file (see `.env.example`) with your `GEMINI_API_KEY` and `DATABASE_URL`.

3. Start Postgres (Docker), then create tables and ingest data:

```
python -c "from src.jira_ai.ingestion.models import init_db; init_db()"
python -m src.jira_ai.ingestion.run_ingestion
```

4. Run the API:

```
uvicorn src.jira_ai.api.main:app --reload
```

5. Serve the frontend:

```
cd frontend
python -m http.server 5500
```

Open http://127.0.0.1:5500

## Features

- **Assessment tab** — AI program briefing (RAG status, milestones, risks, forecast, actions) with a data-freshness timestamp. Loads the last cached report instantly; "Refresh report" regenerates it. Includes a collapsible follow-up question box with history.
- **Charts tab** — status, type, priority, and sprint-velocity charts.
- **Documentation tab** — the project_data files rendered on one page.

## Design decisions

- **Metrics computed in code, judgment left to the LLM.** Numbers and risk-threshold checks are deterministic SQL; Gemini only interprets and phrases.
- **Assessment cached in the database.** Generating a report is a slow, rate-limited LLM call, so the last result is stored and served instantly; the DB (not a local file) is used because Cloud Run instances are ephemeral.
- **Structured output.** /assess returns a fixed JSON schema so the UI renders reliable panels.
- **Charts as an evidence layer.** The AI narrative sits above the raw data so a reader can verify it.

## Data Refresh

The database is a local cache of Jira data. To refresh it with the latest issues, statuses, sprints, and story points, re-run the ingestion:

```
python -m src.jira_ai.ingestion.run_ingestion
```

This performs a full pull of all issues and upserts them into Postgres (`session.merge()`), so it is safe to run repeatedly — no duplicates are created. Any changes made in Jira (status updates, closed sprints, new issues) are reflected in the dashboard and the `/ask` endpoint after the next run.

### Current approach

Refresh is **manual** — the ingestion command is run on demand (e.g. before a demo). At the current scale (~220 issues) a full re-fetch is fast and simple.

### Production plan

In the deployed setup, ingestion runs as a scheduled **Cloud Run job** triggered by **Cloud Scheduler** (e.g. hourly) against Cloud SQL, so the dashboard always reflects Jira within the schedule interval.

### Future enhancements

- **Incremental sync** — fetch only recently changed issues using a JQL filter (`updated >= -1d`) instead of a full pull. Useful at larger scale.
- **Jira webhooks** — push updates to the API on change for near-real-time refresh, at the cost of a public endpoint and delivery-failure handling.

## Roadmap


