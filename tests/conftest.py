"""conftest.py — Shared test fixtures for the Jira AI test suite.

Centralizes the in-memory SQLite setup, FastAPI test client creation,
and database dependency override so individual test files don't need
to repeat this boilerplate.
"""

import os
import pytest

# Ensure test mode is active before any application imports.
os.environ.setdefault("TESTING", "true")
os.environ.setdefault("MOCK_LLM", "true")
os.environ.setdefault("BASIC_AUTH_USER", "demo")
os.environ.setdefault("BASIC_AUTH_PASS", "Dem06435")

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from src.jira_ai.api.db import get_db
from src.jira_ai.api.main import app
from src.jira_ai.database import Base


@pytest.fixture()
def db_engine():
    """Create a fresh in-memory SQLite engine for each test."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture()
def db_session(db_engine):
    """Provide a transactional database session that rolls back after each test."""
    Session = sessionmaker(bind=db_engine)
    session = Session()
    yield session
    session.close()


@pytest.fixture()
def client(db_engine):
    """Provide a FastAPI TestClient with the database dependency overridden."""
    Session = sessionmaker(bind=db_engine)

    def override_get_db():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    _client = TestClient(app, headers={"Authorization": "Basic ZGVtbzpEZW0wNjQzNQ=="})
    yield _client
    app.dependency_overrides.clear()
