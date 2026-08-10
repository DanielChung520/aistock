"""Scheduled cleanup for expired (read) strategy_hits documents."""
from __future__ import annotations

from src.celery_app import celery_app
from src.services import hit_persistence

TASK_NAME = "src.tasks.strategy_hit_cleanup"


@celery_app.task(name=TASK_NAME)
def cleanup_expired_hits(*, retain_seconds: int = 30 * 86400) -> int:
    """Delete read==true hits older than retain_seconds. Returns deleted count."""
    deleted = hit_persistence.purge_expired(retain_seconds=retain_seconds)
    return deleted
