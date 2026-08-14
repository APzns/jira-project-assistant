"""security.py — Prompt injection detection, input/output sanitization, and security audit logging."""

from __future__ import annotations

import html
import logging
import os
import re
import socket
import unicodedata
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Optional, Union, List, Dict


logger = logging.getLogger("jira_ai.security")

# Ensure logs directory exists
LOGS_DIR = Path(__file__).resolve().parents[4] / "logs"
LOGS_DIR.mkdir(parents=True, exist_ok=True)
AUDIT_LOG_PATH = LOGS_DIR / "security_audit.log"

MAX_QUESTION_LENGTH = 500

# Patterns indicative of direct prompt injections, persona hijacking, instruction leaks, or delimiter breakouts
INJECTION_PATTERNS = [
    # Instruction override / ignore previous
    re.compile(r"ignore\s*(all)?\s*(previous|above|prior)\s*(instructions|prompts|rules|guidelines)?", re.IGNORECASE),
    re.compile(r"forget\s*(your|all)?\s*(previous|prior)?\s*(instructions|prompts|rules)", re.IGNORECASE),
    re.compile(r"disregard\s*(all)?\s*(previous|above|prior)", re.IGNORECASE),
    re.compile(r"bypass\s*(your|the)?\s*(safety|security|rules|filters)", re.IGNORECASE),

    # Persona override / jailbreaks
    re.compile(r"you\s*are\s*now\s*(a|an|in)?", re.IGNORECASE),
    re.compile(r"act\s*as\s*(a|an|if)?", re.IGNORECASE),
    re.compile(r"pretend\s*(to\s*be|you\s*are)", re.IGNORECASE),
    re.compile(r"do\s*anything\s*now", re.IGNORECASE),
    re.compile(r"\bdan\b\s*mode", re.IGNORECASE),
    re.compile(r"developer\s*mode", re.IGNORECASE),
    re.compile(r"jailbreak", re.IGNORECASE),

    # System prompt extraction
    re.compile(r"system\s*prompt", re.IGNORECASE),
    re.compile(r"system\s*instruction", re.IGNORECASE),
    re.compile(r"repeat\s*(all|everything|the)\s*(above|previous|prompt|instructions)", re.IGNORECASE),
    re.compile(r"print\s*(your|the)\s*(initial|system|full)\s*(prompt|instructions)", re.IGNORECASE),
    re.compile(r"show\s*(me)?\s*(your|the)\s*(system|initial)\s*(prompt|instructions)", re.IGNORECASE),
    re.compile(r"what\s*are\s*your\s*(initial|system)\s*instructions", re.IGNORECASE),

    # Delimiter breakout attempts
    re.compile(r"===\s*USER\s*QUERY\s*(START|END)\s*===", re.IGNORECASE),
    re.compile(r"</?user_query>", re.IGNORECASE),
    re.compile(r"</?untrusted_data>", re.IGNORECASE),
    re.compile(r"system:", re.IGNORECASE),
    re.compile(r"assistant:", re.IGNORECASE),
]


def normalize_input(text: str) -> str:
    """Normalize unicode (NFKC) and strip zero-width / invisible control characters."""
    if not text:
        return ""
    # Normalize unicode to standard compatibility form (defeats homoglyph/unicode obfuscation)
    normalized = unicodedata.normalize("NFKC", text)
    # Strip non-printable control characters except standard whitespace (\n, \r, \t)
    cleaned = "".join(
        ch for ch in normalized
        if unicodedata.category(ch)[0] != "C" or ch in ("\n", "\r", "\t")
    )
    return cleaned.strip()


def sanitize_user_query(text: str) -> str:
    """Escape XML tags in user input to prevent structural delimiter breakout."""
    # Replace XML opening/closing angle brackets for tags that could mimic delimiters
    sanitized = text.replace("<user_query>", "&lt;user_query&gt;")
    sanitized = sanitized.replace("</user_query>", "&lt;/user_query&gt;")
    sanitized = sanitized.replace("<untrusted_data>", "&lt;untrusted_data&gt;")
    sanitized = sanitized.replace("</untrusted_data>", "&lt;/untrusted_data&gt;")
    return sanitized


def check_input_injection(text: str) -> str | None:
    """Validate user input against prompt injection signatures and length bounds.
    
    Returns an error message if blocked, or None if valid.
    """
    if not text or not text.strip():
        return "Error: Question cannot be empty."

    norm_text = normalize_input(text)

    if len(norm_text) > MAX_QUESTION_LENGTH:
        return f"Error: Input exceeds maximum length of {MAX_QUESTION_LENGTH} characters."

    for pattern in INJECTION_PATTERNS:
        if pattern.search(norm_text):
            return "Error: Your message contains blocked keywords or instruction override attempts and cannot be processed."

    return None


def sanitize_output(answer_text: str) -> str:
    """Sanitize output markdown to prevent data exfiltration and prompt leakage."""
    if not answer_text:
        return ""

    # 1. Strip Markdown image syntax `![alt](url)` to prevent data exfiltration via image requests
    sanitized = re.sub(r"!\[([^\]]*)\]\([^)]+\)", r"[Image removed: \1]", answer_text)

    # 2. Strip unsafe HTML tags (<script>, <iframe>, <img>, <svg>, etc.)
    sanitized = re.sub(r"<\s*(script|iframe|img|svg|object|embed|link|meta|style)[^>]*>.*?</\s*\1\s*>", "", sanitized, flags=re.IGNORECASE | re.DOTALL)
    sanitized = re.sub(r"<\s*(script|iframe|img|svg|object|embed|link|meta|style)[^>]*/?>", "", sanitized, flags=re.IGNORECASE)

    # 3. Check for potential system prompt reflection / leak
    leak_indicators = [
        "IMPORTANT SECURITY DIRECTIVE",
        "You are a senior Technical Program Manager for Project Horizon",
        "query_database(sql_query)",
        "get_program_metrics",
    ]
    if "IMPORTANT SECURITY DIRECTIVE: Under no circumstances" in sanitized:
        return "I am unable to display raw system instructions. How else can I help with Project Horizon Jira data?"

    return sanitized


def log_security_event(event_type: str, details: str, client_ip: str | None = None):
    """Log structured security audit events to logs/security_audit.log."""
    timestamp = datetime.now(timezone.utc).isoformat()
    ip_str = client_ip or "unknown"
    log_entry = f"[{timestamp}] [SECURITY_EVENT] type={event_type} client_ip={ip_str} details={details}\n"
    _safe_write_log(AUDIT_LOG_PATH, log_entry)
    logger.warning("Security Audit Event [%s] IP=%s: %s", event_type, ip_str, details)


# In-memory rate limiting store: client_ip -> list of request timestamps
_rate_limit_store: dict[str, list[float]] = {}
RATE_LIMIT_WINDOW = 60  # seconds
RATE_LIMIT_MAX = 20     # max requests per window per IP


def check_rate_limit(client_ip: str) -> bool:
    """Enforce rate limit of max 20 requests per minute per IP address.
    
    Returns True if allowed, False if limit exceeded.
    """
    import time
    now = time.time()
    timestamps = _rate_limit_store.get(client_ip, [])
    # Keep timestamps within the window
    valid_timestamps = [ts for ts in timestamps if now - ts < RATE_LIMIT_WINDOW]

    if len(valid_timestamps) >= RATE_LIMIT_MAX:
        log_security_event("RATE_LIMIT_EXCEEDED", f"Exceeded {RATE_LIMIT_MAX} requests per {RATE_LIMIT_WINDOW}s window", client_ip)
        _rate_limit_store[client_ip] = valid_timestamps
        return False

    valid_timestamps.append(now)
    _rate_limit_store[client_ip] = valid_timestamps
    return True


VISIT_LOG_PATH = LOGS_DIR / "page_visits.log"
AI_QUESTIONS_LOG_PATH = LOGS_DIR / "ai_questions.log"

# Session store to log only 1 record per user entry to the page
_visit_session_store: dict[str, float] = {}
VISIT_SESSION_COOLDOWN = 15.0  # seconds between distinct page entry log records per IP


@lru_cache(maxsize=256)
def resolve_hostname(ip: str) -> str:
    """Resolve IP address to user domain or computer FQDN, cached for performance."""
    if not ip or ip == "unknown":
        return "unknown"

    # For local loopback requests, return the computer's actual network domain / FQDN
    if ip in ("127.0.0.1", "::1", "localhost"):
        try:
            fqdn = socket.getfqdn()
            if fqdn and fqdn not in ("localhost", "127.0.0.1"):
                return fqdn
        except Exception:
            pass
        return socket.gethostname() or "localhost"

    try:
        # 0.5s socket timeout so DNS never blocks request logging
        old_timeout = socket.getdefaulttimeout()
        socket.setdefaulttimeout(0.5)
        hostname, _, _ = socket.gethostbyaddr(ip)
        socket.setdefaulttimeout(old_timeout)
        if hostname.endswith(".docker.internal"):
            try:
                fqdn = socket.getfqdn()
                if fqdn and fqdn not in ("localhost", "127.0.0.1"):
                    return fqdn
            except Exception:
                pass
        return hostname
    except Exception:
        return ip


def _safe_write_log(log_path: Path, entry: str, max_bytes: int = 5 * 1024 * 1024, max_backups: int = 1):
    """Write log entry with size capping. Strictly keeps max 2 files (1 active + 1 backup)."""
    try:
        if log_path.exists() and log_path.stat().st_size >= max_bytes:
            backup_file = log_path.parent / f"{log_path.name}.1"
            if backup_file.exists():
                backup_file.unlink()  # Delete oldest backup when 3rd segment arrives
            log_path.rename(backup_file)
    except Exception as exc:
        logger.warning("Log rotation warning for %s: %s", log_path, exc)

    try:
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(entry)
            f.flush()
    except Exception as exc:
        logger.error("Failed to write to log file %s: %s", log_path, exc)


def log_visit_event(
    client_ip: str | None,
    method: str,
    path: str,
    status_code: int = 200,
    duration_ms: float | None = None,
    error: str | None = None,
    report_status: str | None = None,
    force: bool = False,
):
    """Log 1 record per first entry of a user to the main page with resolved reverse DNS hostname."""
    import time
    ip_str = client_ip or "unknown"

    # Only log for main page entry ("/" or "/index.html") unless explicitly forced
    if not force and path not in ("/", "/index.html"):
        return

    # Check session cooldown to ensure only 1 record is created per user entry session
    now = time.time()
    last_visit = _visit_session_store.get(ip_str, 0.0)
    if not force and (now - last_visit < VISIT_SESSION_COOLDOWN):
        return

    _visit_session_store[ip_str] = now

    hostname = resolve_hostname(ip_str)
    host_str = f" hostname={hostname}" if hostname and hostname != ip_str else ""

    timestamp = datetime.now(timezone.utc).isoformat()
    duration_str = f" duration_ms={duration_ms:.1f}ms" if duration_ms is not None else ""
    clean_err = str(error).replace("\n", " ").strip() if error else ""
    error_str = f' error="{clean_err}"' if clean_err else ""
    report_str = f" report_status=\"{report_status}\"" if report_status else ""

    log_entry = f"[{timestamp}] [PAGE_ENTRY] client_ip={ip_str}{host_str} method={method} path={path} status={status_code}{duration_str}{error_str}{report_str}\n"
    _safe_write_log(VISIT_LOG_PATH, log_entry)


def log_ai_question(client_ip: str | None, question: str, context: str | None = None):
    """Log AI chat questions with client IP address and active UI context."""
    timestamp = datetime.now(timezone.utc).isoformat()
    ip_str = client_ip or "unknown"
    ctx_str = context or "general"
    clean_q = question.replace("\n", " ").strip()
    log_entry = f"[{timestamp}] [AI_QUESTION] client_ip={ip_str} context={ctx_str} question=\"{clean_q}\"\n"
    _safe_write_log(AI_QUESTIONS_LOG_PATH, log_entry)
    logger.info(log_entry.strip())


def log_ai_answer(client_ip: str | None, answer: str | None, error: str | None = None):
    """Log AI chat answers or errors with client IP address."""
    timestamp = datetime.now(timezone.utc).isoformat()
    ip_str = client_ip or "unknown"
    if error:
        clean_err = str(error).replace("\n", " ").strip()
        log_entry = f"[{timestamp}] [AI_ANSWER_ERROR] client_ip={ip_str} error=\"{clean_err}\"\n"
    else:
        clean_a = (answer or "").replace("\n", " ").strip()
        log_entry = f"[{timestamp}] [AI_ANSWER] client_ip={ip_str} answer=\"{clean_a}\"\n"
    _safe_write_log(AI_QUESTIONS_LOG_PATH, log_entry)
    logger.info(log_entry.strip())



