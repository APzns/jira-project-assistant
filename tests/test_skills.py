import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, os.path.abspath("."))

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from src.jira_ai.api.db import get_db
from src.jira_ai.api.main import app
from src.jira_ai.api.routes.settings import _read_settings_from_disk, DEFAULT_PROFILES
from src.jira_ai.api.routes.skills import _load_skill_md, _resolve_request_settings, SkillRequest
from src.jira_ai.ingestion.models import Base, AssessmentCache


class TestSkillsAndReportSettings(unittest.TestCase):

    def setUp(self):
        self.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.session = self.Session()

        def override_get_db():
            db = self.Session()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override_get_db
        self.client = TestClient(app, headers={"Authorization": "Basic ZGVtbzpEZW0wNjQzNQ=="})

    def tearDown(self):
        self.session.close()
        app.dependency_overrides.clear()

    def test_generate_report_skill_md_exists(self):
        content = _load_skill_md("generate-report")
        self.assertTrue(len(content) > 50)
        self.assertIn("Generate Report", content)

    def test_default_profiles_structure(self):
        data = _read_settings_from_disk()
        self.assertIn("profiles", data)
        self.assertTrue(len(data["profiles"]) >= 3)
        self.assertIn("active_profile_id", data)

    def test_resolve_request_settings_with_custom_instructions(self):
        req = SkillRequest(
            profile_id="default-exec",
            custom_instructions="Focus exclusively on checkout blockers and Black Friday risk.",
        )
        resolved = _resolve_request_settings(req)
        self.assertEqual(resolved["profile_id"], "default-exec")
        self.assertEqual(resolved["custom_instructions"], "Focus exclusively on checkout blockers and Black Friday risk.")

    def test_get_and_post_settings(self):
        # GET /settings
        res = self.client.get("/settings")
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertIn("profiles", body)
        self.assertIn("active_profile_id", body)

        # POST /settings with custom profile
        custom_profiles = [
            *body["profiles"],
            {
                "id": "my-custom-test-profile",
                "name": "QA & Defect Deep Dive",
                "is_default": False,
                "stakeholder": "engineer",
                "focus_teams": ["Checkout Squad"],
                "focus_epics": ["Mobile Parity"],
                "risk_categories": ["dependency"],
                "min_risk_severity": "high",
                "summary_verbosity": "detailed",
                "custom_instructions": "Focus on high-severity unassigned bugs.",
            },
        ]
        save_res = self.client.post("/settings", json={
            "active_profile_id": "my-custom-test-profile",
            "profiles": custom_profiles,
        })
        self.assertEqual(save_res.status_code, 200)
        saved_body = save_res.json()["settings"]
        self.assertEqual(saved_body["active_profile_id"], "my-custom-test-profile")
        self.assertEqual(saved_body["custom_instructions"], "Focus on high-severity unassigned bugs.")

    def test_generate_report_endpoint(self):
        # POST /skills/generate-report with fallback synthesis
        payload = {
            "profile_id": "default-exec",
            "custom_instructions": "Highlight milestone M2 delivery risks.",
        }
        res = self.client.post("/skills/generate-report", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["skill"], "generate-report")
        self.assertIn("overall_status", data)
        self.assertIn("milestones", data)
        self.assertIn("key_risks", data)
        self.assertIn("recommendations", data)
        self.assertIn("executive_summary", data)


if __name__ == "__main__":
    unittest.main()
