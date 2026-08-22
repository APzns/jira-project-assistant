"""
seed_project_settings.py — Initializes the project_settings table in PostgreSQL
and populates it with the 4 default Jira projects used in the demo dashboard.
"""
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from src.jira_ai.ingestion.models import Base, ProjectSetting

from dotenv import load_dotenv
load_dotenv()

db_url = os.environ.get("DATABASE_URL")
if not db_url:
    raise ValueError("DATABASE_URL must be set")

engine = create_engine(db_url)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

DEFAULT_PROJECTS = [
    {
        "key": "CHK",
        "name": "Checkout & Commerce Flow",
        "description": "Modernization of the core checkout flow, including new payment gateways and one-click purchasing.",
        "target_release": "2024-Q3",
        "tags": "E-Commerce,High Priority,Payments",
        "ai_guidelines": "",
        "at_risk_blockers": 2,
        "at_risk_delay_days": 5
    },
    {
        "key": "CORE",
        "name": "Platform Core & Analytics Foundation",
        "description": "Infrastructure upgrade and migration to the new event-driven analytics pipeline.",
        "target_release": "2024-Q2",
        "tags": "Infrastructure,Data",
        "ai_guidelines": "",
        "at_risk_blockers": 2,
        "at_risk_delay_days": 5
    },
    {
        "key": "MOB",
        "name": "Mobile Parity & Security Guild",
        "description": "Bringing iOS and Android applications to feature parity with the web platform, and implementing zero-trust.",
        "target_release": "2024-Q4",
        "tags": "Mobile,Security,Compliance",
        "ai_guidelines": "",
        "at_risk_blockers": 2,
        "at_risk_delay_days": 5
    },
    {
        "key": "HRZ",
        "name": "Project Horizon",
        "description": "Next-generation AI features and predictive modeling for user recommendations.",
        "target_release": "2025-Q1",
        "tags": "AI,Experimental",
        "ai_guidelines": "This project is highly experimental. It has high R&D variance. Ignore typical velocity dips.",
        "at_risk_blockers": 3,
        "at_risk_delay_days": 14
    }
]

def main():
    print("Creating project_settings table if it doesn't exist...")
    # This will create tables that don't exist yet, leaving existing ones alone.
    Base.metadata.create_all(bind=engine)

    print("Seeding default projects...")
    with SessionLocal() as db:
        for p in DEFAULT_PROJECTS:
            existing = db.query(ProjectSetting).filter(ProjectSetting.key == p["key"]).first()
            if not existing:
                new_setting = ProjectSetting(**p)
                db.add(new_setting)
                print(f"Added project: {p['key']}")
            else:
                print(f"Project already exists: {p['key']}")
        db.commit()
        print("Done!")

if __name__ == "__main__":
    main()
