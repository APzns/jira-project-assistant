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

from dotenv import load_dotenv
from sqlalchemy import Boolean, DateTime, Integer, String, Text, create_engine
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker


def run_with_retry(fn, retries: int = 4, base_delay: float = 1.0):
    """Run a DB operation, retrying on transient connection errors.

    Handles Neon cold starts: the first connect after the DB has scaled
    to zero can fail while it wakes up. We retry with increasing delay.
    """
    last_exc = None
    for attempt in range(retries):
        try:
            return fn()
        except OperationalError as exc:
            last_exc = exc
            if attempt < retries - 1:
                time.sleep(base_delay * (attempt + 1))  # 1s, 2s, 3s...
    raise last_exc


# Load environment variables explicitly from project root if available
_env_path = Path(__file__).resolve().parents[3] / ".env"
if _env_path.exists():
    load_dotenv(dotenv_path=_env_path)
else:
    load_dotenv()


class Base(DeclarativeBase):
    """Base class for all ORM models."""
    pass


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


DATABASE_URL = os.environ.get("DATABASE_URL", "")

if DATABASE_URL:
    engine = create_engine(
        DATABASE_URL,
        echo=False,
        pool_pre_ping=True,   # verify a connection is alive before using it;
                              # transparently reconnects if Neon suspended the DB
        pool_recycle=300,     # drop connections older than 5 min so they don't go stale
    )
else:
    _db_path = Path(__file__).resolve().parents[3] / "project_data" / "jira_ai.db"
    _db_path.parent.mkdir(parents=True, exist_ok=True)
    DATABASE_URL = f"sqlite:///{_db_path}"
    engine = create_engine(
        DATABASE_URL,
        echo=False,
        connect_args={"check_same_thread": False},
    )

SessionLocal = sessionmaker(bind=engine)


def init_db() -> None:
    """Create all tables if they do not exist yet."""
    if engine is not None:
        Base.metadata.create_all(engine)
