"""logging_config.py — Centralized logging setup for Jira AI application logs."""

from __future__ import annotations

import logging
import os
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

# Base logs directory
LOGS_DIR = Path(__file__).resolve().parents[2] / "logs"
LOGS_DIR.mkdir(parents=True, exist_ok=True)
APP_LOG_PATH = LOGS_DIR / "app.log"

DEFAULT_LOG_FORMAT = "[%(asctime)s] [%(levelname)s] [%(name)s]: %(message)s"


class QuietEndpointFilter(logging.Filter):
    """Filter out noisy log lines like /health probes and static CSS/JS asset requests."""
    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        if any(path in msg for path in ("/health", "/styles.css", "/js/", "/favicon.ico")):
            return False
        return True


def setup_logging(log_level: str | int | None = None) -> logging.Logger:
    """Configure application logging for 'jira_ai', 'uvicorn', and 'fastapi' loggers.
    
    Logs INFO, WARNING, and ERROR messages to both logs/app.log and console.
    """
    if log_level is None:
        log_level = os.environ.get("LOG_LEVEL", "INFO").upper()

    if isinstance(log_level, str):
        level = getattr(logging, log_level.upper(), logging.INFO)
    else:
        level = log_level

    logger = logging.getLogger("jira_ai")
    logger.setLevel(level)

    # Avoid adding duplicate handlers if setup_logging is called multiple times
    if not logger.handlers:
        formatter = logging.Formatter(DEFAULT_LOG_FORMAT)
        quiet_filter = QuietEndpointFilter()

        # Rotating file handler (5 MB max per log file, strictly 1 backup file = 2 files max)
        file_handler = RotatingFileHandler(
            APP_LOG_PATH,
            maxBytes=5 * 1024 * 1024,
            backupCount=1,
            encoding="utf-8",
        )
        file_handler.setLevel(level)
        file_handler.setFormatter(formatter)
        file_handler.addFilter(quiet_filter)

        # Console output stream handler
        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setLevel(level)
        console_handler.setFormatter(formatter)
        console_handler.addFilter(quiet_filter)

        # Attach handlers to jira_ai, uvicorn, uvicorn.access, uvicorn.error loggers
        for logger_name in ("jira_ai", "uvicorn", "uvicorn.access", "uvicorn.error", "fastapi"):
            l = logging.getLogger(logger_name)
            l.setLevel(level)
            if not l.handlers:
                l.addHandler(file_handler)
                l.addHandler(console_handler)

    return logger
