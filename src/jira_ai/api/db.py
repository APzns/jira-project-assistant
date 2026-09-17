"""
db.py — Database session dependency for the FastAPI app.

Reuses the SQLAlchemy engine/session defined in the centralized database module.
"""

from src.jira_ai.database import SessionLocal


def get_db():
    """FastAPI dependency that yields a database session and closes it after."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
