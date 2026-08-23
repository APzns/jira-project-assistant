"""test_skills.py — Unit tests for the modular TPM Skill Suite and Skill Cache Layer."""

import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.abspath("."))

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from src.jira_ai.api.db import get_db
from src.jira_ai.api.main import app
from src.jira_ai.ingestion.models import Base
from src.jira_ai.api.services.skill_cache import (
    compute_cache_key,
    get_cached_skill,
    save_skill_cache,
    invalidate_skill_cache,
)


class TestSkillSuite(unittest.TestCase):

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

    def test_skill_cache_manager_direct(self):
        settings = {"profile_id": "p1", "focus_teams": ["Team A"]}
        key, shash = compute_cache_key("assess-risks", "CHK", settings)
        self.assertIn("assess-risks:CHK:", key)

        # Initially empty
        cached = get_cached_skill(self.session, "assess-risks", "CHK", settings)
        self.assertIsNone(cached)

        # Save result
        dummy_result = {"skill": "assess-risks", "summary": "Sample risk summary", "risks": []}
        save_skill_cache(self.session, "assess-risks", "CHK", settings, dummy_result)

        # Cache hit
        cached_hit = get_cached_skill(self.session, "assess-risks", "CHK", settings)
        self.assertIsNotNone(cached_hit)
        self.assertTrue(cached_hit.get("cached"))
        self.assertEqual(cached_hit.get("summary"), "Sample risk summary")

        # Invalidate
        deleted = invalidate_skill_cache(self.session, "CHK")
        self.assertEqual(deleted, 1)
        cached_after = get_cached_skill(self.session, "assess-risks", "CHK", settings)
        self.assertIsNone(cached_after)

    def test_analyze_status_endpoint_and_cache(self):
        payload = {"project_key": "CHK", "force_refresh": True}
        res1 = self.client.post("/skills/analyze-status", json=payload)
        self.assertEqual(res1.status_code, 200)
        data1 = res1.json()
        self.assertEqual(data1.get("skill"), "analyze-status")
        self.assertIn("overall_status", data1)
        self.assertIn("program_health_score", data1)
        self.assertIn("milestones", data1)
        self.assertIn("delays", data1)
        self.assertFalse(data1.get("cached", True))

        # Subsequent call without force_refresh should hit cache
        res2 = self.client.post("/skills/analyze-status", json={"project_key": "CHK"})
        self.assertEqual(res2.status_code, 200)
        data2 = res2.json()
        self.assertTrue(data2.get("cached"))

        # Subsequent call with force_refresh should bypass cache
        res3 = self.client.post("/skills/analyze-status", json={"project_key": "CHK", "force_refresh": True})
        self.assertEqual(res3.status_code, 200)
        data3 = res3.json()
        self.assertFalse(data3.get("cached", True))

    def test_assess_risks_endpoint(self):
        payload = {"project_key": "ALL", "force_refresh": True}
        res = self.client.post("/skills/assess-risks", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data.get("skill"), "assess-risks")
        self.assertIn("overall_risk_level", data)
        self.assertIn("blockers_count", data)
        self.assertIn("risks", data)
        self.assertIn("overcommitment_summary", data)

    def test_forecast_delivery_endpoint(self):
        payload = {"project_key": "ALL", "force_refresh": True}
        res = self.client.post("/skills/forecast-delivery", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data.get("skill"), "forecast-delivery")
        self.assertIn("monte_carlo", data)
        self.assertIn("forecast_delay_days", data)
        self.assertIn("critical_path", data)
        self.assertIn("trade_off_scenarios", data)

    def test_sprint_planning_endpoint(self):
        payload = {"project_key": "ALL", "force_refresh": True}
        res = self.client.post("/skills/sprint-planning", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data.get("skill"), "sprint-planning")
        self.assertIn("readiness_score", data)
        self.assertIn("backlog_hygiene", data)
        self.assertIn("capacity_analysis", data)
        self.assertIn("balancing_recommendations", data)

    def test_propose_next_steps_endpoint(self):
        payload = {"project_key": "ALL", "force_refresh": True}
        res = self.client.post("/skills/propose-next-steps", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data.get("skill"), "propose-next-steps")
        self.assertIn("actions", data)
        self.assertIn("summary", data)
        self.assertIn("profile_summary", data)
        self.assertIn("stakeholder_perspectives", data)
        perspectives = data.get("stakeholder_perspectives", {})
        self.assertIn("executive", perspectives)
        self.assertIn("engineering", perspectives)
        self.assertIn("product", perspectives)

    def test_generate_report_endpoint(self):
        payload = {"project_key": "ALL", "force_refresh": True}
        res = self.client.post("/skills/generate-report", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data.get("skill"), "generate-report")
        self.assertIn("title", data)
        self.assertIn("executive_summary", data)
        self.assertIn("overall_status", data)
        self.assertIn("milestones", data)
        self.assertIn("key_risks", data)
        self.assertIn("recommendations", data)


if __name__ == "__main__":
    unittest.main()
