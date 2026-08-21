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
from src.jira_ai.api.routes.stakeholders import DEFAULT_STAKEHOLDERS, _read_stakeholders_from_disk


class TestStakeholdersEndpoint(unittest.TestCase):

    def setUp(self):
        self.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
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
        # Reset stakeholders to default state before each test
        self.client.post("/stakeholders/reset")

    def tearDown(self):
        self.session.close()
        app.dependency_overrides.clear()
        # Clean up by resetting to defaults
        self.client.post("/stakeholders/reset")

    def test_default_stakeholders_count(self):
        self.assertGreaterEqual(len(DEFAULT_STAKEHOLDERS), 4)
        ids = [s["id"] for s in DEFAULT_STAKEHOLDERS]
        self.assertIn("eng-lead", ids)
        self.assertIn("pm-default", ids)
        self.assertIn("exec", ids)
        self.assertIn("qa-lead", ids)

    def test_list_stakeholders(self):
        res = self.client.get("/stakeholders")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("stakeholders", data)
        self.assertGreaterEqual(len(data["stakeholders"]), 4)
        self.assertEqual(data.get("current_user"), "demo")

    def test_get_single_stakeholder(self):
        res = self.client.get("/stakeholders/eng-lead")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("stakeholder", data)
        sh = data["stakeholder"]
        self.assertEqual(sh["id"], "eng-lead")
        self.assertEqual(sh["role"], "Engineering Lead")

    def test_update_existing_standard_stakeholder(self):
        # Update existing Engineering Lead stakeholder
        payload = {
            "role": "Lead Systems Architect",
            "role_type": "engineering_lead",
            "description": "Focuses on technical debt and microservices scalability.",
            "other_notes": "Quarterly architecture reviews with core platform team.",
            "people": [
                {"name": "Marcus Vance", "email": "marcus.vance@company.internal"},
                {"name": "Alex Tech", "email": "alex.tech@company.internal"}
            ],
            "projects": ["CORE", "CHK"],
            "priority_areas": ["Architecture", "Scalability", "Tech Debt"]
        }
        res = self.client.put("/stakeholders/eng-lead", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data.get("updated"))
        sh = data.get("stakeholder")
        self.assertEqual(sh["role"], "Lead Systems Architect")
        self.assertEqual(len(sh["people"]), 2)
        self.assertEqual(sh["people"][1]["name"], "Alex Tech")
        self.assertEqual(sh["other_notes"], "Quarterly architecture reviews with core platform team.")

        # Verify get reflects the update
        get_res = self.client.get("/stakeholders/eng-lead")
        self.assertEqual(get_res.status_code, 200)
        get_sh = get_res.json()["stakeholder"]
        self.assertEqual(get_sh["role"], "Lead Systems Architect")

    def test_create_and_delete_stakeholder(self):
        # Create a new custom stakeholder
        new_payload = {
            "role": "Security Officer",
            "role_type": "security_lead",
            "description": "Focuses on SOC2 compliance and vuln tracking.",
            "other_notes": "Weekly security council briefings.",
            "people": [
                {"name": "Agent Smith", "email": "smith@sec.internal"}
            ],
            "projects": ["CHK", "MOB"],
            "priority_areas": ["Security", "Compliance"]
        }
        create_res = self.client.post("/stakeholders/item", json=new_payload)
        self.assertEqual(create_res.status_code, 200)
        new_sh = create_res.json().get("stakeholder")
        new_id = new_sh["id"]
        self.assertTrue(new_id)
        self.assertEqual(new_sh["role"], "Security Officer")

        # Verify it exists in list
        list_res = self.client.get("/stakeholders")
        sh_ids = [s["id"] for s in list_res.json()["stakeholders"]]
        self.assertIn(new_id, sh_ids)

        # Delete the stakeholder
        del_res = self.client.delete(f"/stakeholders/{new_id}")
        self.assertEqual(del_res.status_code, 200)
        self.assertTrue(del_res.json().get("deleted"))

        # Verify it is no longer in list
        list_res2 = self.client.get("/stakeholders")
        sh_ids2 = [s["id"] for s in list_res2.json()["stakeholders"]]
        self.assertNotIn(new_id, sh_ids2)

    def test_delete_standard_stakeholder_and_reset(self):
        # Delete qa-lead
        del_res = self.client.delete("/stakeholders/qa-lead")
        self.assertEqual(del_res.status_code, 200)

        # Verify qa-lead is deleted
        get_res = self.client.get("/stakeholders/qa-lead")
        self.assertEqual(get_res.status_code, 404)

        # Reset stakeholders
        reset_res = self.client.post("/stakeholders/reset")
        self.assertEqual(reset_res.status_code, 200)

        # Verify qa-lead is restored
        get_res2 = self.client.get("/stakeholders/qa-lead")
        self.assertEqual(get_res2.status_code, 200)
        self.assertEqual(get_res2.json()["stakeholder"]["id"], "qa-lead")


if __name__ == "__main__":
    unittest.main()
