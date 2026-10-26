"""Persistence for strategy execution records (ArangoDB `strategy_runs`).

A run document: {_key, strategy_id, strategy_name, conditions, scope, source,
executed_at, count, hits}. `hits` holds the matched stocks inline (compact:
stock_id/name/price/score/passed_count/total_conditions) so a run can be
re-displayed without re-scanning. The list endpoint projects hits away.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from src.db import ensure_collection, get_db

logger = logging.getLogger(__name__)

COLLECTION = "strategy_runs"
_META_FIELDS = (
    "_key",
    "strategy_id",
    "strategy_name",
    "conditions",
    "scope",
    "source",
    "executed_at",
    "count",
    "action",
)


def ensure_runs() -> None:
    ensure_collection(COLLECTION)


def _meta(row: dict) -> dict:
    return {
        "id": row["_key"],
        "strategy_id": row.get("strategy_id"),
        "strategy_name": row.get("strategy_name", ""),
        "conditions": row.get("conditions", []),
        "scope": row.get("scope", "all"),
        "source": row.get("source", "manual"),
        "executed_at": row.get("executed_at"),
        "count": int(row.get("count", 0) or 0),
        "action": row.get("action", "") or "",
    }


def create_run(
    *,
    strategy_id: str | None,
    strategy_name: str,
    conditions: list[dict],
    scope: str,
    source: str,
    hits: list[dict],
    action: str = "",
) -> dict:
    ensure_runs()
    col = get_db().collection(COLLECTION)
    compact = [
        {
            "stock_id": str(h.get("stock_id", "")),
            "name": h.get("name", "") or "",
            "price": h.get("price"),
            "score": float(h.get("score", 0) or 0),
            "passed_count": int(h.get("passed_count", 0) or 0),
            "total_conditions": int(h.get("total_conditions", 0) or 0),
        }
        for h in hits
        if str(h.get("stock_id", "")).strip()
    ]
    doc = {
        "_key": f"run_{uuid.uuid4().hex[:12]}",
        "strategy_id": strategy_id,
        "strategy_name": strategy_name,
        "conditions": conditions,
        "scope": scope,
        "source": source,
        "executed_at": datetime.now(timezone.utc).timestamp(),
        "count": len(compact),
        "action": action,
        "hits": compact,
    }
    col.insert(doc)
    return _meta(doc)


def list_runs(limit: int = 50) -> list[dict]:
    ensure_runs()
    db = get_db()
    cursor = db.aql.execute(
        """
        FOR r IN strategy_runs
          SORT r.executed_at DESC
          LIMIT @limit
          RETURN KEEP(r, @fields)
        """,
        bind_vars={"limit": limit, "fields": list(_META_FIELDS)},
    )
    return [_meta(row) for row in cursor]


def get_run(key: str) -> dict | None:
    col = get_db().collection(COLLECTION)
    if not col.has(key):
        return None
    row = col.get(key)
    return {**_meta(row), "hits": row.get("hits", [])}


def update_run_action(key: str, action: str) -> dict | None:
    """Set the round-2 follow-up `action` on a run. Returns the run, or None if absent."""
    col = get_db().collection(COLLECTION)
    if not col.has(key):
        return None
    col.update({"_key": key, "action": action})
    return get_run(key)


def delete_run(key: str) -> bool:
    """Delete one run. Returns False when the key does not exist."""
    col = get_db().collection(COLLECTION)
    if not col.has(key):
        return False
    col.delete(key)
    return True


def delete_all_runs() -> int:
    """Delete every run. Returns the deleted count (0 on an empty collection)."""
    ensure_runs()
    cursor = get_db().aql.execute(
        "FOR r IN strategy_runs REMOVE r IN strategy_runs RETURN OLD",
    )
    return len(list(cursor))
