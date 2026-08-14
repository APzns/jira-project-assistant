"""
db.py — Database session dependency for the FastAPI app.

Reuses the SQLAlchemy engine/session defined in the ingestion models so the
API reads from the same database the ingestion job writes to.
"""

from src.jira_ai.ingestion.models import SessionLocal


def get_db():
    """FastAPI dependency that yields a database session and closes it after."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
