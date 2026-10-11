"""Persistence for screening strategies (ArangoDB `strategies` collection).

A strategy document: {_key, name, description, conditions, source, created_at,
updated_at}. `source` is "builtin" (seeded from PRESET_STRATEGIES) or "custom".
`conditions` is the same DSL the scan engine evaluates (see src.strategy).
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from src.db import ensure_collection, get_db

logger = logging.getLogger(__name__)

COLLECTION = "strategies"


def _now() -> float:
    return datetime.now(timezone.utc).timestamp()


def ensure_strategies() -> None:
    ensure_collection(COLLECTION)


def _doc(row: dict) -> dict:
    return {
        "id": row["_key"],
        "name": row.get("name", ""),
        "description": row.get("description", ""),
        "conditions": row.get("conditions", []),
        "source": row.get("source", "custom"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def list_strategies() -> list[dict]:
    db = get_db()
    cursor = db.aql.execute(
        "FOR s IN strategies SORT s.source ASC, s.created_at ASC RETURN s"
    )
    return [_doc(row) for row in cursor]


def get_strategy(key: str) -> dict | None:
    col = get_db().collection(COLLECTION)
    if not col.has(key):
        return None
    return _doc(col.get(key))


def create_strategy(
    name: str, description: str, conditions: list[dict], source: str = "custom"
) -> dict:
    ensure_strategies()
    col = get_db().collection(COLLECTION)
    now = _now()
    key = f"stg_{uuid.uuid4().hex[:12]}"
    doc = {
        "_key": key,
        "name": name,
        "description": description,
        "conditions": conditions,
        "source": source,
        "created_at": now,
        "updated_at": now,
    }
    col.insert(doc)
    return _doc(doc)


def update_strategy(
    key: str,
    *,
    name: str | None = None,
    description: str | None = None,
    conditions: list[dict] | None = None,
) -> dict | None:
    col = get_db().collection(COLLECTION)
    if not col.has(key):
        return None
    patch: dict = {"_key": key, "updated_at": _now()}
    if name is not None:
        patch["name"] = name
    if description is not None:
        patch["description"] = description
    if conditions is not None:
        patch["conditions"] = conditions
    col.update(patch)
    return _doc(col.get(key))


def delete_strategy(key: str) -> bool:
    col = get_db().collection(COLLECTION)
    if not col.has(key):
        return False
    col.delete(key)
    return True


def ensure_seeded(presets: list[dict]) -> None:
    ensure_strategies()
    col = get_db().collection(COLLECTION)
    if col.count() > 0:
        return
    now = _now()
    for preset in presets:
        col.insert(
            {
                "_key": preset["id"],
                "name": preset.get("name", preset["id"]),
                "description": preset.get("description", ""),
                "conditions": preset.get("conditions", []),
                "source": "builtin",
                "created_at": now,
                "updated_at": now,
            },
            overwrite=True,
        )
    logger.info("Seeded %d builtin strategies", len(presets))
