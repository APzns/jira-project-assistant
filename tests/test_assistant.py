"""test_assistant.py — Unit tests for conversational AI Assistant endpoints."""

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
from src.jira_ai.api.services.llm import is_explicit_report_request


class TestAssistantConversational(unittest.TestCase):

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

    def test_report_intent_detection(self):
        # Explicit report prompts
        self.assertTrue(is_explicit_report_request("I want to create a report for project Checkout"))
        self.assertTrue(is_explicit_report_request("generate a report for SteerCo"))
        self.assertTrue(is_explicit_report_request("design a report template"))
        self.assertTrue(is_explicit_report_request("draft an executive 1-pager"))

        # Natural Q&A, advice, next steps, blockers prompts (MUST NOT be report requests)
        self.assertFalse(is_explicit_report_request("what blockers exist in MOB project"))
        self.assertFalse(is_explicit_report_request("what advice do you have for mitigating delay on M2?"))
        self.assertFalse(is_explicit_report_request("propose next steps for sprint 4"))
        self.assertFalse(is_explicit_report_request("what is the defect ratio for Checkout Squad?"))
        self.assertFalse(is_explicit_report_request("who is the lead of project CORE?"))
        self.assertFalse(is_explicit_report_request("analyze trade-offs between scope cut on APS-1 vs delay on M3"))

    def test_assistant_chat_qa_response_format(self):
        with patch("src.jira_ai.api.services.llm.answer_question") as mock_answer:
            mock_answer.return_value = {
                "question": "what blockers exist in MOB project",
                "answer": "Project MOB currently has 0 dependency blockers and 9 high priority issues.",
                "rows": [],
                "skill_used": "analyze-status",
                "error": None
            }

            res = self.client.post("/assistant/chat", json={
                "message": "what blockers exist in MOB project",
                "context": "assistant"
            })

            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertIn("reply", data)
            self.assertIn("0 dependency blockers", data["reply"])
            # Must NOT propose a template for standard questions
            self.assertIsNone(data.get("proposed_template"))
            self.assertEqual(data.get("skill_used"), "analyze-status")

    def test_assistant_chat_report_response_format(self):
        with patch("src.jira_ai.api.services.llm.suggest_report_template") as mock_suggest:
            mock_suggest.return_value = {
                "reply": "### Proposed Universal Report Template",
                "proposed_template": {
                    "name": "Universal SteerCo Digest",
                    "project_scope": "HRZ",
                    "blocks": [{"block_type": "exec_summary", "title": "Summary", "enabled": True}]
                }
            }

            res = self.client.post("/assistant/chat", json={
                "message": "I want to create a report for project Checkout Flow",
                "context": "assistant"
            })

            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertIn("reply", data)
            self.assertIsNotNone(data.get("proposed_template"))
            self.assertEqual(data["proposed_template"]["name"], "Universal SteerCo Digest")


if __name__ == "__main__":
    unittest.main()
