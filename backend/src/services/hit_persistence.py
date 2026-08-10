"""Persistence layer for strategy_hits (screener result history / notifications).

All AQL is parameterized — no f-string injection (G2). Timestamps are epoch
seconds (UTC). Read (已讀) semantics follow Q2: unread docs are preserved
indefinitely, expired read docs are filtered at read time and purged by the
scheduled cleanup task.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from src.db import get_db

logger = logging.getLogger(__name__)

COLLECTION = "strategy_hits"
DEFAULT_TTL_SECONDS = 30 * 86400  # 30 days


def _now_ts() -> float:
    return datetime.now(timezone.utc).timestamp()


def _cutoff_ts(retain_seconds: int) -> float:
    return _now_ts() - retain_seconds


def write_hits(
    *,
    scan_id: str,
    scope: str,
    source: str,
    conditions: list[dict],
    hits: list[dict],
) -> int:
    """Upsert hits into strategy_hits. Returns count written. Skips empty hits.

    `_key = f"{scan_id}_{stock_id}"` — re-posting the same scan is idempotent.
    """
    if not hits:
        return 0
    db = get_db()
    col = db.collection(COLLECTION)
    now = _now_ts()
    written = 0
    for hit in hits:
        stock_id = str(hit.get("stock_id", "")).strip()
        if not stock_id:
            continue
        key = f"{scan_id}_{stock_id}"
        doc = {
            "_key": key,
            "scan_id": scan_id,
            "stock_id": stock_id,
            "name": hit.get("name", "") or "",
            "scope": scope,
            "conditions": conditions,
            "passed_count": int(hit.get("passed_count", 0) or 0),
            "total_conditions": int(hit.get("total_conditions", 0) or 0),
            "score": float(hit.get("score", 0) or 0),
            "price": float(hit.get("price", 0) or 0) if hit.get("price") is not None else 0.0,
            "source": source,
            "scan_at": now,
            "read": False,
            "created_at": now,
        }
        col.insert(doc, overwrite=True)
        written += 1
    return written


def list_hits(
    *,
    limit: int = 50,
    unread_first: bool = True,
    before: float | None = None,
    retain_seconds: int = DEFAULT_TTL_SECONDS,
) -> list[dict]:
    """List hits, newest first, filtered by the expiry rule:
    `created_at >= cutoff OR read == false` (read hits older than the TTL are
    excluded; unread hits are kept forever per Q2)."""
    db = get_db()
    cutoff = _cutoff_ts(retain_seconds)
    if unread_first:
        aql = """
            FOR h IN @@col
                FILTER (h.created_at >= @cutoff) OR (h.read == false)
                FILTER @before == null OR h.created_at < @before
                SORT h.read ASC, h.created_at DESC
                LIMIT @limit
                RETURN h
        """
    else:
        aql = """
            FOR h IN @@col
                FILTER (h.created_at >= @cutoff) OR (h.read == false)
                FILTER @before == null OR h.created_at < @before
                SORT h.created_at DESC
                LIMIT @limit
                RETURN h
        """
    cursor = db.aql.execute(
        aql,
        bind_vars={
            "@col": COLLECTION,
            "cutoff": cutoff,
            "before": before,
            "limit": limit,
        },
    )
    return list(cursor)


def unread_count(*, retain_seconds: int = DEFAULT_TTL_SECONDS) -> int:
    """Count unread hits. Unread docs are never expired (Q2), so only the
    `read == false` flag is needed — the cutoff guard keeps this consistent
    with list_hits expiry semantics for defensive future changes."""
    db = get_db()
    cutoff = _cutoff_ts(retain_seconds)
    aql = """
        FOR h IN @@col
            FILTER h.read == false AND h.created_at >= @cutoff
            COLLECT WITH COUNT INTO c
            RETURN c
    """
    cursor = db.aql.execute(aql, bind_vars={"@col": COLLECTION, "cutoff": cutoff})
    result = list(cursor)
    return int(result[0]) if result else 0


def mark_read(key: str) -> bool:
    """Mark a single hit as read. Returns False when the key does not exist."""
    db = get_db()
    col = db.collection(COLLECTION)
    if not col.has(key):
        return False
    col.update({"_key": key, "read": True})
    return True


def read_all() -> int:
    """Mark every unread hit as read. Returns the number of marked docs."""
    db = get_db()
    cursor = db.aql.execute(
        """
        FOR h IN @@col
            FILTER h.read == false
            UPDATE h WITH { read: true } IN @@col
            RETURN NEW
        """,
        bind_vars={"@col": COLLECTION},
    )
    return len(list(cursor))


def purge_expired(*, retain_seconds: int = DEFAULT_TTL_SECONDS) -> int:
    """Delete read==true hits older than the TTL. Returns the deleted count.

    Runs on empty collections without error (returns 0).
    """
    db = get_db()
    cutoff = _cutoff_ts(retain_seconds)
    cursor = db.aql.execute(
        """
        FOR h IN @@col
            FILTER h.read == true AND h.created_at < @cutoff
            REMOVE h IN @@col
            RETURN OLD
        """,
        bind_vars={"@col": COLLECTION, "cutoff": cutoff},
    )
    return len(list(cursor))
