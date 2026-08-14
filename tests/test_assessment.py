import sys, os
sys.path.insert(0, os.path.abspath("."))

import unittest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from src.jira_ai.api.services import assessment
from src.jira_ai.api.services.assessment.context import _synthetic_metrics
from src.jira_ai.api.services.assessment.prompts import _build_fallback_assessment
from src.jira_ai.ingestion.models import Base


class TestAssessmentService(unittest.TestCase):

    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        Session = sessionmaker(bind=self.engine)
        self.session = Session()

    def tearDown(self):
        self.session.close()

    def test_compute_synthetic_metrics(self):
        metrics = _synthetic_metrics()
        self.assertIn("sprint_progress", metrics)
        self.assertIn("milestone_completion", metrics)
        self.assertIn("forecast_monte_carlo", metrics)
        self.assertIn("team_predictability", metrics)

    def test_build_fallback_assessment(self):
        metrics = _synthetic_metrics()
        fallback = _build_fallback_assessment(metrics, mode="synthetic")

        self.assertIn("overall_status", fallback)
        self.assertIn(fallback["overall_status"], ["on_track", "at_risk", "delayed"])
        self.assertIn("headline", fallback)
        self.assertIn("ai_summary", fallback)
        self.assertIn("predictability_comment", fallback)
        self.assertIn("predictability_summary", fallback)
        self.assertTrue(len(fallback["predictability_summary"]) > 0)
        self.assertIn("quality_summary", fallback)
        self.assertTrue(len(fallback["quality_summary"]) > 0)
        self.assertIn("quality_actions", fallback)
        self.assertIsInstance(fallback["quality_actions"], list)
        self.assertIn("milestones", fallback)
        self.assertIn("risks", fallback)
        self.assertIn("recommended_actions", fallback)
        self.assertIsInstance(fallback["milestones"], list)
        self.assertIsInstance(fallback["risks"], list)

    def test_assess_synthetic_mode(self):
        res = assessment.assess(self.session, mode="synthetic")
        self.assertIsInstance(res, dict)
        self.assertIn("overall_status", res)
        self.assertIn("metrics", res)
        self.assertIn("generated_at", res)
        self.assertIn("monte_carlo", res)


if __name__ == "__main__":
    unittest.main()
