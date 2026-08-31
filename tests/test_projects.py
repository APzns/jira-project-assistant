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
from src.jira_ai.api.routes.projects import DEFAULT_PROJECTS, _read_projects_from_disk
from src.jira_ai.ingestion.models import Base


class TestProjectsEndpoint(unittest.TestCase):

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
        # Reset projects to clean state before each test
        self.client.post("/projects/reset")

    def tearDown(self):
        self.session.close()
        app.dependency_overrides.clear()

    def test_default_projects_count(self):
        self.assertEqual(len(DEFAULT_PROJECTS), 3)
        keys = [p["key"] for p in DEFAULT_PROJECTS]
        self.assertIn("CHK", keys)
        self.assertIn("CORE", keys)
        self.assertIn("MOB", keys)
        self.assertNotIn("HRZ", keys)

    def test_list_projects(self):
        res = self.client.get("/projects")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("projects", data)
        self.assertEqual(len(data["projects"]), 3)
        self.assertEqual(data.get("current_user"), "demo")

    def test_get_project_detail(self):
        res = self.client.get("/projects/CHK")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("project", data)
        self.assertEqual(data["project"]["key"], "CHK")
        self.assertEqual(data["project"]["name"], "Checkout & Commerce Flow")
        self.assertIn("assignments", data)

    def test_get_project_detail_not_found(self):
        res = self.client.get("/projects/NONEXISTENT")
        self.assertEqual(res.status_code, 404)

    def test_create_project(self):
        payload = {
            "key": "PAY",
            "name": "Payments Platform",
            "description": "Global multi-currency checkout & recurring billing engine.",
            "lead": "Sarah Connor",
            "target_release": "Q1 2027 (v1.0)",
            "status": "on-track",
            "progress_pct": 25,
            "progress_sp": "100 / 400 SP",
            "blockers_count": 0,
            "tags": ["Payments", "Billing", "Stripe"]
        }
        res = self.client.post("/projects", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data.get("created"))
        self.assertEqual(data["project"]["key"], "PAY")
        self.assertEqual(data["project"]["name"], "Payments Platform")
        self.assertEqual(data["project"]["archived"], False)

        # Verify it shows in list
        list_res = self.client.get("/projects")
        keys = [p["key"] for p in list_res.json()["projects"]]
        self.assertIn("PAY", keys)

    def test_create_duplicate_project_fails(self):
        payload = {
            "key": "CHK",
            "name": "Duplicate Checkout",
            "description": "Should fail",
        }
        res = self.client.post("/projects", json=payload)
        self.assertEqual(res.status_code, 400)

    def test_update_project(self):
        update_payload = {
            "name": "Checkout Flow Replatform",
            "status": "delayed",
            "progress_pct": 75,
            "blockers_count": 4
        }
        res = self.client.put("/projects/CHK", json=update_payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data.get("updated"))
        self.assertEqual(data["project"]["name"], "Checkout Flow Replatform")
        self.assertEqual(data["project"]["status"], "delayed")
        self.assertEqual(data["project"]["progress_pct"], 75)
        self.assertEqual(data["project"]["blockers_count"], 4)

    def test_archive_and_unarchive_project(self):
        # Archive
        res = self.client.post("/projects/CHK/archive")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data.get("archived"))
        self.assertEqual(data["project"]["archived"], True)

        # Listing with include_archived=False should omit CHK
        active_res = self.client.get("/projects?include_archived=false")
        active_keys = [p["key"] for p in active_res.json()["projects"]]
        self.assertNotIn("CHK", active_keys)

        # Unarchive
        res2 = self.client.post("/projects/CHK/unarchive")
        self.assertEqual(res2.status_code, 200)
        data2 = res2.json()
        self.assertTrue(data2.get("unarchived"))
        self.assertEqual(data2["project"]["archived"], False)

        # Listing with include_archived=False should now include CHK
        active_res2 = self.client.get("/projects?include_archived=false")
        active_keys2 = [p["key"] for p in active_res2.json()["projects"]]
        self.assertIn("CHK", active_keys2)

    def test_delete_project_and_cleanup(self):
        # Create a project first
        self.client.post("/projects", json={"key": "TESTDEL", "name": "To Be Deleted"})
        
        # Delete it
        res = self.client.delete("/projects/TESTDEL")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json().get("deleted"))

        # Verify not found in list or detail
        detail_res = self.client.get("/projects/TESTDEL")
        self.assertEqual(detail_res.status_code, 404)


if __name__ == "__main__":
    unittest.main()
