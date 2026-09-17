"""database.py — Centralized database connection and ORM setup."""

from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from src.jira_ai.config import get_settings

settings = get_settings()

if settings.database_url:
    engine = create_engine(
        settings.database_url,
        echo=False,
        pool_pre_ping=True,
        pool_recycle=300,
    )
else:
    _db_path = Path(__file__).resolve().parents[2] / "project_data" / "jira_ai.db"
    _db_path.parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(
        f"sqlite:///{_db_path}",
        echo=False,
        connect_args={"check_same_thread": False},
    )

SessionLocal = sessionmaker(bind=engine)


class Base(DeclarativeBase):
    """Base class for all ORM models."""
    pass


def init_db() -> None:
    """Create all tables if they do not exist yet."""
    import src.jira_ai.ingestion.models  # noqa: F401
    Base.metadata.create_all(engine)


def get_db():
    """FastAPI dependency that yields a database session and closes it after."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
