"""
models.py — SQLAlchemy models defining the database schema.

Stores a flattened, query-friendly copy of Jira issues so the API and
dashboard can read from a fast database instead of calling Jira live.
The database URL is read from the environment, so the same code works
locally (Docker Postgres) and in production (Cloud SQL) unchanged.
"""

import os
from datetime import datetime, timezone
from pathlib import Path
import time

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Mapped, mapped_column

from src.jira_ai.database import Base


class Issue(Base):
    """A single Jira issue, flattened into columns useful for metrics."""

    __tablename__ = "issues"

    # Jira issue key (e.g. "APS-3") is the natural primary key.
    key: Mapped[str] = mapped_column(String, primary_key=True)

    summary: Mapped[str] = mapped_column(String)
    issue_type: Mapped[str] = mapped_column(String)      # Story, Task, Bug, Feature, Epic
    status: Mapped[str] = mapped_column(String)           # To Do, In Progress, Done, ...
    status_category: Mapped[str] = mapped_column(String)  # To Do / In Progress / Done
    priority: Mapped[str | None] = mapped_column(String, nullable=True)

    # Epic linkage (parent). Null for issues not grouped under an epic.
    epic_key: Mapped[str | None] = mapped_column(String, nullable=True)

    assignee: Mapped[str | None] = mapped_column(String, nullable=True)

    # Comma-joined Jira labels (e.g. "tech-debt,customer"). Stored as a string for simple SQL filtering.
    labels: Mapped[str | None] = mapped_column(String, nullable=True)

    # Jira Team field (display name). Null if the issue has no team assigned.
    team: Mapped[str | None] = mapped_column(String, nullable=True)

    # --- Time and planning dimensions (used for progress and risk metrics) ---
    due_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    story_points: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sprint: Mapped[str | None] = mapped_column(String, nullable=True)        # sprint name
    fix_version: Mapped[str | None] = mapped_column(String, nullable=True)   # release name

    # --- Jira ID references (stable keys, alongside the human-readable names) ---
    sprint_id: Mapped[str | None] = mapped_column(String, nullable=True)       # Jira sprint ID, e.g. "36"
    fix_version_id: Mapped[str | None] = mapped_column(String, nullable=True)  # Jira version ID, e.g. "10000"

    created: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    resolved: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # When this row was last written by the ingestion job.
    ingested_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None)
    )


class AssessmentCache(Base):
    """Stores the most recently generated program assessment as JSON, so the
    dashboard can load the last report instantly without a Gemini call. The
    Refresh button regenerates and overwrites row id=1."""

    __tablename__ = "assessment_cache"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    payload: Mapped[str] = mapped_column(Text)   # the assessment JSON, as text
    generated_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None)
    )


class SkillCache(Base):
    """Stores generated skill analyses (e.g. analyze-status, assess-risks, forecast-delivery,
    sprint-planning, propose-next-steps, generate-report) keyed by deterministic signature
    (skill_name, project_key, settings_hash) so repeated UI views or assistant inquiries return instantly."""

    __tablename__ = "skill_cache"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    cache_key: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=False)
    skill_name: Mapped[str] = mapped_column(String, index=True, nullable=False)
    project_key: Mapped[str] = mapped_column(String, index=True, nullable=False, default="ALL")
    settings_hash: Mapped[str] = mapped_column(String, nullable=False)
    payload: Mapped[str] = mapped_column(Text, nullable=False)  # JSON payload
    generated_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None)
    )


class ProjectSetting(Base):
    """Stores user-configured display metadata, thresholds, and AI guidelines for tracked projects."""

    __tablename__ = "project_settings"

    key: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String)
    description: Mapped[str] = mapped_column(String)
    target_release: Mapped[str | None] = mapped_column(String, nullable=True)
    tags: Mapped[str | None] = mapped_column(String, nullable=True) # Comma separated
    ai_guidelines: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Thresholds
    at_risk_blockers: Mapped[int | None] = mapped_column(Integer, nullable=True, default=2)
    at_risk_delay_days: Mapped[int | None] = mapped_column(Integer, nullable=True, default=5)


class MetricsSnapshot(Base):
    __tablename__ = "metrics_snapshots"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    captured_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    synthetic: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    metrics_json: Mapped[str] = mapped_column(Text, nullable=False)


class IssueLink(Base):
    """A directional 'Blocks' dependency between two issues, mirrored from
    Jira's issuelinks. Normalized to the outward direction only, so each real
    link is stored exactly once: source_key blocks target_key."""

    __tablename__ = "issue_links"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source_key: Mapped[str] = mapped_column(String, nullable=False)   # the blocker
    target_key: Mapped[str] = mapped_column(String, nullable=False)   # the blocked
    link_type: Mapped[str] = mapped_column(String, nullable=False, default="Blocks")


class FixVersion(Base):
    __tablename__ = "fix_versions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    version_id: Mapped[str] = mapped_column(String, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    release_date: Mapped[str | None] = mapped_column(String, nullable=True)  # ISO "YYYY-MM-DD" or None
    released: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    overdue: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class Sprint(Base):
    """A Jira sprint, mirrored from the Agile API so the dashboard can show
    sprint dates and state without calling Jira live. Issues reference it by
    sprint_id (Issue.sprint_id) and also carry the display name (Issue.sprint)."""

    __tablename__ = "sprints"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    sprint_id: Mapped[str] = mapped_column(String, nullable=False)   # Jira sprint ID, e.g. "36"
    name: Mapped[str] = mapped_column(String, nullable=False)        # "Sprint 3 - Checkout Redesign"
    state: Mapped[str] = mapped_column(String, nullable=False)       # closed / active / future
    start_date: Mapped[str | None] = mapped_column(String, nullable=True)   # ISO datetime or None
    end_date: Mapped[str | None] = mapped_column(String, nullable=True)     # ISO datetime or None
    board_id: Mapped[str | None] = mapped_column(String, nullable=True)
    goal: Mapped[str | None] = mapped_column(String, nullable=True)
