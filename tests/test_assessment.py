import os
import sys

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

    def test_cache_ttl_and_date_expiration(self):
        import json
        from datetime import UTC, datetime, timedelta
        from src.jira_ai.ingestion.models import AssessmentCache

        from src.jira_ai.api.services.assessment.engine import _get_cache_id
        # Seed an old cache row from yesterday
        yesterday = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=1)
        row = AssessmentCache(
            id=_get_cache_id("real", "CHK"),
            payload=json.dumps({"overall_status": "delayed", "milestones": []}),
            generated_at=yesterday,
        )
        self.session.add(row)
        self.session.commit()

        # Should be expired because it is from yesterday
        cached = assessment.get_cached_assessment(self.session, mode="real", project_key="CHK")
        self.assertIsNone(cached)

        # Fresh cache row generated just now
        row.generated_at = datetime.now(UTC).replace(tzinfo=None)
        self.session.commit()
        cached_fresh = assessment.get_cached_assessment(self.session, mode="real", project_key="CHK")
        self.assertIsNotNone(cached_fresh)

    def test_fallback_milestone_date_formatting(self):
        metrics = {
            "milestone_completion": {
                "v1.0.0-alpha": {
                    "release_date": "2026-08-06",
                    "days_to_release": -96,
                    "percent_done": 85,
                    "done": 17,
                    "total": 20,
                },
                "v2.0.0-future": {
                    "release_date": "2026-12-31",
                    "days_to_release": 51,
                    "percent_done": 10,
                    "done": 1,
                    "total": 10,
                },
            }
        }
        res = _build_fallback_assessment(metrics, mode="real")
        alpha = next(m for m in res["milestones"] if m["name"] == "v1.0.0-alpha")
        self.assertEqual(alpha["status"], "delayed")
        self.assertIn("Missed release date of 2026-08-06 by 96 days", alpha["assessment"])

        future = next(m for m in res["milestones"] if m["name"] == "v2.0.0-future")
        self.assertIn("51 days remaining until release (2026-12-31)", future["assessment"])


if __name__ == "__main__":
    unittest.main()

