"""migrate.py — add sprint_id/fix_version_id columns and create the sprints table."""

from sqlalchemy import text
from src.jira_ai.ingestion.models import engine, Base

def main():
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE issues ADD COLUMN IF NOT EXISTS sprint_id VARCHAR"))
        conn.execute(text("ALTER TABLE issues ADD COLUMN IF NOT EXISTS fix_version_id VARCHAR"))
    print("issue columns added")

    Base.metadata.create_all(engine)
    print("sprints table ensured")

if __name__ == "__main__":
    main()
