import os
import sys
import unittest

sys.path.insert(0, os.path.abspath("."))

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from src.jira_ai.api.db import get_db
from src.jira_ai.api.main import app
from src.jira_ai.ingestion.models import Base, Issue, Sprint, FixVersion


class TestProjectDashboards(unittest.TestCase):

    def setUp(self):
        self.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.session = self.Session()

        # Seed sample data with CHK and CORE issues
        s1 = Sprint(sprint_id=1, name="Sprint 1 - Foundation", state="closed")
        v1 = FixVersion(version_id=1, name="v1.0.0-alpha", released=False)
        self.session.add_all([s1, v1])

        i1 = Issue(
            key="CHK-1",
            summary="Checkout Flow Redesign",
            issue_type="Story",
            status="Done",
            status_category="Done",
            story_points=5,
            sprint="Sprint 1 - Foundation",
            sprint_id=1,
            fix_version="v1.0.0-alpha",
            fix_version_id=1,
            team="Checkout Squad",
        )
        i2 = Issue(
            key="CORE-1",
            summary="Platform Core Microservice",
            issue_type="Story",
            status="In Progress",
            status_category="In Progress",
            story_points=8,
            sprint="Sprint 1 - Foundation",
            sprint_id=1,
            fix_version="v1.0.0-alpha",
            fix_version_id=1,
            team="Platform Core",
        )
        self.session.add_all([i1, i2])
        self.session.commit()

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

    def test_stats_summary_all(self):
        res = self.client.get("/stats/summary")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["total_issues"], 2)
        self.assertEqual(data["project_key"], "ALL")

    def test_stats_summary_chk_filter(self):
        res = self.client.get("/stats/summary?project_key=CHK")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["total_issues"], 1)
        self.assertEqual(data["project_key"], "CHK")
        # Verify only CHK-1 is in delivery issues
        keys = [i["key"] for i in data["delivery_issues"]]
        self.assertEqual(keys, ["CHK-1"])

    def test_stats_summary_core_filter(self):
        res = self.client.get("/stats/summary?project_key=CORE")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["total_issues"], 1)
        self.assertEqual(data["project_key"], "CORE")
        keys = [i["key"] for i in data["delivery_issues"]]
        self.assertEqual(keys, ["CORE-1"])

    def test_stats_summary_nonexistent_project_empty(self):
        res = self.client.get("/stats/summary?project_key=NONEXISTENT")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["total_issues"], 0)
        self.assertEqual(data["project_key"], "NONEXISTENT")
        self.assertEqual(len(data["delivery_issues"]), 0)

    def test_assess_latest_with_project_key(self):
        res_latest = self.client.get("/assess/latest?project_key=CHK")
        self.assertEqual(res_latest.status_code, 200)
        data_latest = res_latest.json()
        self.assertIn("cached", data_latest)

    def test_stats_telemetry(self):
        res = self.client.get("/stats/telemetry")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("telemetry", data)
        self.assertGreater(len(data["telemetry"]), 0)
        first = data["telemetry"][0]
        self.assertIn("key", first)
        self.assertIn("predictability_pct", first)
        self.assertIn("unresolved_bugs", first)
        self.assertIn("mc_delay_days", first)


if __name__ == "__main__":
    unittest.main()
