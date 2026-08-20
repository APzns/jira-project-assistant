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
from src.jira_ai.api.routes.reports import DEFAULT_TEMPLATES, _read_reports_from_disk
from src.jira_ai.ingestion.models import Base


class TestReportsEndpoint(unittest.TestCase):

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

    def test_default_templates_count_is_5(self):
        self.assertEqual(len(DEFAULT_TEMPLATES), 5)
        template_ids = [t["id"] for t in DEFAULT_TEMPLATES]
        self.assertIn("report-exec-brief", template_ids)
        self.assertIn("report-pm-weekly", template_ids)
        self.assertIn("report-dependency-blocker", template_ids)
        self.assertIn("report-squad-quality", template_ids)
        self.assertIn("report-milestone-forecast", template_ids)

    def test_get_reports_returns_5_templates(self):
        res = self.client.get("/reports")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("templates", data)
        self.assertEqual(len(data["templates"]), 5)
        
        # Verify specific report names
        names = [t["name"] for t in data["templates"]]
        self.assertIn("Executive Program Status Briefing", names)
        self.assertIn("Weekly TPM Sprint & Delivery Health", names)
        self.assertIn("Cross-Team Dependency & Blocker Matrix", names)
        self.assertIn("Squad Quality & Defect Deep-Dive", names)
        self.assertIn("Milestone Delivery & Monte Carlo Forecast", names)

    def test_reset_reports_restores_5_templates(self):
        res = self.client.post("/reports/reset")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data.get("reset"))
        templates = data.get("data", {}).get("templates", [])
        self.assertEqual(len(templates), 5)

    def test_all_templates_have_valid_blocks(self):
        res = self.client.get("/reports")
        self.assertEqual(res.status_code, 200)
        templates = res.json().get("templates", [])
        valid_block_types = {
            "executive_summary",
            "health_kpis",
            "burndown",
            "monte_carlo",
            "dependency_matrix",
            "quality_defects",
            "action_plan",
            "milestone_timeline",
        }
        for t in templates:
            self.assertTrue(len(t["blocks"]) > 0, f"Template {t['id']} has no blocks")
            for block in t["blocks"]:
                self.assertIn(block["block_type"], valid_block_types, f"Invalid block type {block['block_type']} in template {t['id']}")
                self.assertTrue(block["title"], f"Block in {t['id']} missing title")


    def test_get_single_template(self):
        res = self.client.get("/reports/report-exec-brief")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("template", data)
        self.assertEqual(data["template"]["id"], "report-exec-brief")
        self.assertEqual(data["template"]["name"], "Executive Program Status Briefing")

    def test_get_nonexistent_template_returns_404(self):
        res = self.client.get("/reports/non-existent-template-id")
        self.assertEqual(res.status_code, 404)

    def test_create_update_and_delete_template(self):
        # 1. Create
        create_payload = {
            "name": "Custom Test Sprint Report",
            "description": "A customized sprint health report for testing.",
            "is_default": False,
            "stakeholder_ids": ["pm-default"],
            "stakeholder_notes": "Focus on velocity",
            "blocks": [
                {"id": "health_kpis", "block_type": "health_kpis", "title": "KPI Health", "enabled": True, "order": 1}
            ]
        }
        res = self.client.post("/reports/create", json=create_payload)
        self.assertEqual(res.status_code, 200)
        created = res.json().get("template")
        self.assertIsNotNone(created)
        tpl_id = created["id"]
        self.assertEqual(created["name"], "Custom Test Sprint Report")

        # 2. Update
        update_payload = {
            "name": "Updated Test Sprint Report",
            "description": "Updated description",
            "is_default": False,
            "stakeholder_ids": ["pm-default", "exec-sponsor"],
            "blocks": [
                {"id": "health_kpis", "block_type": "health_kpis", "title": "KPI Health", "enabled": True, "order": 1},
                {"id": "burndown", "block_type": "burndown", "title": "Burndown", "enabled": True, "order": 2}
            ]
        }
        res_update = self.client.put(f"/reports/{tpl_id}", json=update_payload)
        self.assertEqual(res_update.status_code, 200)
        updated = res_update.json().get("template")
        self.assertEqual(updated["name"], "Updated Test Sprint Report")
        self.assertEqual(len(updated["blocks"]), 2)

        # 3. Delete
        res_del = self.client.delete(f"/reports/{tpl_id}")
        self.assertEqual(res_del.status_code, 200)

        # 4. Verify 404 after delete
        res_after = self.client.get(f"/reports/{tpl_id}")
        self.assertEqual(res_after.status_code, 404)

        # Reset templates to clean up disk
        self.client.post("/reports/reset")

    def test_suggest_report_universal_checkout(self):
        payload = {
            "stakeholder_ids": ["exec-sponsor", "sec-lead", "eng-lead-core", "pm-default"],
            "user_prompt": "I want to create a report for project Checkout Flow Replatform which would be universal for all stakeholders in the project",
            "chat_history": []
        }
        res = self.client.post("/reports/suggest", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("reply", data)
        self.assertIn("proposed_template", data)
        tpl = data["proposed_template"]
        self.assertTrue(tpl.get("name"))
        self.assertTrue(len(tpl.get("blocks", [])) >= 3)
        self.assertIn(tpl.get("export_format"), ["html", "deck", "markdown", "print"])
        self.assertTrue(tpl.get("stakeholder_notes"))

    def test_suggest_report_executive_briefing(self):
        payload = {
            "stakeholder_ids": ["exec-sponsor"],
            "user_prompt": "Create an executive sponsor 1-pager for VP Product focusing on milestone release confidence",
            "chat_history": []
        }
        res = self.client.post("/reports/suggest", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        tpl = data.get("proposed_template", {})
        self.assertTrue(tpl.get("name"))
        self.assertTrue(len(tpl.get("blocks", [])) >= 2)
        self.assertIn(tpl.get("export_format"), ["deck", "markdown", "html", "print"])

    def test_suggest_report_engineering_blockers(self):
        payload = {
            "stakeholder_ids": ["eng-lead-core"],
            "user_prompt": "Engineering lead report focusing on sprint velocity, cross-team blockers, and carryover drag",
            "chat_history": []
        }
        res = self.client.post("/reports/suggest", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        tpl = data.get("proposed_template", {})
        self.assertTrue(tpl.get("name"))
        self.assertTrue(len(tpl.get("blocks", [])) >= 2)
        self.assertIn(tpl.get("export_format"), ["deck", "markdown", "html", "print"])


if __name__ == "__main__":
    unittest.main()


