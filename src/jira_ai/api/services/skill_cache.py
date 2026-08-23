"""skill_cache.py — Caching service for AI skill executions.

Provides fast response times (<20ms) and token savings by caching structured
skill outputs for identical project scopes and AI settings profiles until data
changes or a force-refresh is requested.
"""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from src.jira_ai.ingestion.models import SkillCache

logger = logging.getLogger("jira_ai")


def _compute_settings_hash(settings: dict) -> str:
    """Create a deterministic MD5 hash of relevant AI settings and custom instructions."""
    relevant_keys = [
        "profile_id", "profile_name", "stakeholder", "focus_teams",
        "focus_epics", "risk_categories", "min_risk_severity",
        "summary_verbosity", "custom_instructions", "stakeholder_notes", "blocks"
    ]
    extracted = {k: settings.get(k) for k in relevant_keys if k in settings}
    encoded = json.dumps(extracted, sort_keys=True, default=str).encode("utf-8")
    return hashlib.md5(encoded).hexdigest()[:16]


def compute_cache_key(skill_name: str, project_key: Optional[str], settings: dict) -> tuple[str, str]:
    """Return deterministic (cache_key, settings_hash)."""
    norm_project = (project_key or "ALL").upper().strip()
    norm_skill = skill_name.lower().strip()
    s_hash = _compute_settings_hash(settings)
    cache_key = f"{norm_skill}:{norm_project}:{s_hash}"
    return cache_key, s_hash


def get_cached_skill(
    db: Session,
    skill_name: str,
    project_key: Optional[str],
    settings: dict,
    max_age_seconds: int = 3600,
) -> Optional[dict]:
    """Retrieve cached skill execution result if present and not expired."""
    try:
        cache_key, _ = compute_cache_key(skill_name, project_key, settings)
        stmt = select(SkillCache).where(SkillCache.cache_key == cache_key)
        row = db.execute(stmt).scalar_one_or_none()
        if not row:
            return None

        # Check TTL
        if row.generated_at:
            age = (datetime.now(timezone.utc).replace(tzinfo=None) - row.generated_at).total_seconds()
            if age > max_age_seconds:
                return None

        data = json.loads(row.payload)
        if isinstance(data, dict):
            data["cached"] = True
            data["cached_at"] = row.generated_at.isoformat() if row.generated_at else None
            return data
        return None
    except Exception as exc:
        logger.warning("skill_cache: Error retrieving cache for %s: %s", skill_name, exc)
        return None


def save_skill_cache(
    db: Session,
    skill_name: str,
    project_key: Optional[str],
    settings: dict,
    result: dict,
) -> None:
    """Persist skill execution result into the cache table."""
    try:
        cache_key, s_hash = compute_cache_key(skill_name, project_key, settings)
        norm_project = (project_key or "ALL").upper().strip()
        norm_skill = skill_name.lower().strip()

        # Clean cache flags before persisting
        payload_dict = {k: v for k, v in result.items() if k not in ("cached", "cached_at")}
        payload_str = json.dumps(payload_dict, default=str)

        stmt = select(SkillCache).where(SkillCache.cache_key == cache_key)
        existing = db.execute(stmt).scalar_one_or_none()

        now = datetime.now(timezone.utc).replace(tzinfo=None)
        if existing:
            existing.payload = payload_str
            existing.generated_at = now
        else:
            new_row = SkillCache(
                cache_key=cache_key,
                skill_name=norm_skill,
                project_key=norm_project,
                settings_hash=s_hash,
                payload=payload_str,
                generated_at=now,
            )
            db.add(new_row)
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.warning("skill_cache: Error saving cache for %s: %s", skill_name, exc)


def invalidate_skill_cache(
    db: Session,
    project_key: Optional[str] = None,
    skill_name: Optional[str] = None,
) -> int:
    """Clear cached skill executions when new Jira data is ingested or seeded."""
    try:
        stmt = delete(SkillCache)
        if project_key and project_key.upper() != "ALL":
            stmt = stmt.where(SkillCache.project_key == project_key.upper())
        if skill_name:
            stmt = stmt.where(SkillCache.skill_name == skill_name.lower())
        res = db.execute(stmt)
        db.commit()
        return res.rowcount or 0
    except Exception as exc:
        db.rollback()
        logger.warning("skill_cache: Error invalidating cache: %s", exc)
        return 0


def prune_stale_cache(
    db: Session,
    max_age_days: int = 7,
    max_rows: int = 150,
) -> int:
    """Ensure database storage in free-tier environments (e.g. Neon) remains tightly bounded.
    Deletes records older than max_age_days and bounds the table size to max_rows."""
    deleted_count = 0
    try:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        # 1. Delete rows older than max_age_days
        from datetime import timedelta
        cutoff = now - timedelta(days=max_age_days)
        stmt_age = delete(SkillCache).where(SkillCache.generated_at < cutoff)
        res_age = db.execute(stmt_age)
        deleted_count += res_age.rowcount or 0

        # 2. If table exceeds max_rows, prune oldest entries (LRU-style)
        total_rows = db.query(SkillCache).count()
        if total_rows > max_rows:
            excess = total_rows - max_rows
            oldest_ids = [
                r[0] for r in db.query(SkillCache.id).order_by(SkillCache.generated_at.asc()).limit(excess).all()
            ]
            if oldest_ids:
                stmt_excess = delete(SkillCache).where(SkillCache.id.in_(oldest_ids))
                res_excess = db.execute(stmt_excess)
                deleted_count += res_excess.rowcount or 0

        db.commit()
        return deleted_count
    except Exception as exc:
        db.rollback()
        logger.warning("skill_cache: Error pruning stale cache: %s", exc)
        return deleted_count
