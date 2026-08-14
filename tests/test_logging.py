from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, os.path.abspath("."))

import src.jira_ai.logging_config as logging_config
from src.jira_ai.logging_config import setup_logging, APP_LOG_PATH


class TestLoggingConfig(unittest.TestCase):

    def test_app_log_path_exists(self):
        """Verify APP_LOG_PATH points to logs/app.log."""
        self.assertEqual(APP_LOG_PATH.name, "app.log")
        self.assertTrue(logging_config.LOGS_DIR.exists())

    def test_setup_logging_creates_handlers_and_writes_logs(self):
        """Verify setup_logging attaches handlers and records INFO/WARNING/ERROR messages to file."""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".log", delete=False) as tmp:
            tmp_path = Path(tmp.name)

        try:
            with patch.object(logging_config, "APP_LOG_PATH", tmp_path):
                # Reset handlers on logger for test isolation
                logger = logging_config.logging.getLogger("jira_ai")
                logger.handlers.clear()

                setup_logger = setup_logging(log_level="DEBUG")
                setup_logger.info("Test INFO message from Jira AI test")
                setup_logger.warning("Test WARNING message from Jira AI test")
                setup_logger.error("Test ERROR message from Jira AI test")

                # Flush all file handlers
                for h in setup_logger.handlers:
                    h.flush()

                content = tmp_path.read_text(encoding="utf-8")
                self.assertIn("Test INFO message", content)
                self.assertIn("Test WARNING message", content)
                self.assertIn("Test ERROR message", content)
                self.assertIn("[jira_ai]", content)
        finally:
            logger = logging_config.logging.getLogger("jira_ai")
            for h in list(logger.handlers):
                h.close()
                logger.removeHandler(h)
            tmp_path.unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
