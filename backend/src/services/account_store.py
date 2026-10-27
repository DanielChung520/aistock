"""帳戶（`accounts` collection）存取 — 帳務統一帳本的帳戶主體。

`kind` = 帳的性質（paper|real|backtest）；`source` = 資料來源（manual|statement|
broker_api），兩者**正交**。規格：`.docs/accounting/REQUIREMENTS.md` §4.1。
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime

from src.db import ensure_collection, get_db

COLLECTION = "accounts"
KINDS = ("paper", "real", "backtest")
SOURCES = ("manual", "statement", "broker_api")
STATUSES = ("active", "archived")


def _now() -> float:
    return datetime.now(UTC).timestamp()


def ensure_accounts() -> None:
    ensure_collection(COLLECTION)


def _doc(row: dict) -> dict:
    return {
        "id": row["_key"],
        "name": row.get("name", ""),
        "kind": row.get("kind", "paper"),
        "source": row.get("source", "manual"),
        "broker": row.get("broker"),
        "currency": row.get("currency", "TWD"),
        "status": row.get("status", "active"),
        "promoted_from": row.get("promoted_from"),
        "promoted_at": row.get("promoted_at"),
        "opened_at": row.get("opened_at"),
    }


def create_account(
    name: str,
    kind: str = "paper",
    source: str = "manual",
    *,
    broker: str | None = None,
    currency: str = "TWD",
    promoted_from: str | None = None,
) -> dict:
    if kind not in KINDS:
        raise ValueError(f"invalid kind: {kind!r} (expected one of {KINDS})")
    if source not in SOURCES:
        raise ValueError(f"invalid source: {source!r} (expected one of {SOURCES})")
    if not name.strip():
        raise ValueError("name must not be empty")

    ensure_accounts()
    col = get_db().collection(COLLECTION)
    now = _now()
    doc = {
        "_key": f"acc_{uuid.uuid4().hex[:12]}",
        "name": name,
        "kind": kind,
        "source": source,
        "broker": broker,
        "currency": currency,
        "status": "active",
        "promoted_from": promoted_from,
        "promoted_at": now if promoted_from else None,
        "opened_at": now,
        "created_at": now,
        "updated_at": now,
    }
    col.insert(doc)
    return _doc(doc)


def list_accounts() -> list[dict]:
    ensure_accounts()
    cursor = get_db().aql.execute("FOR a IN accounts SORT a.opened_at ASC RETURN a")
    return [_doc(row) for row in cursor]


def get_account(key: str) -> dict | None:
    col = get_db().collection(COLLECTION)
    if not col.has(key):
        return None
    return _doc(col.get(key))


def set_status(key: str, status: str) -> dict | None:
    if status not in STATUSES:
        raise ValueError(f"invalid status: {status!r} (expected one of {STATUSES})")
    col = get_db().collection(COLLECTION)
    if not col.has(key):
        return None
    col.update({"_key": key, "status": status, "updated_at": _now()})
    return _doc(col.get(key))
