"""Test fixtures using the aistock_test ArangoDB database.

ARANGO_DB is set to aistock_test BEFORE any src.* import so the cached
pydantic settings resolve to the test database. Run twice in a row — the
fixtures are idempotent (overwrite seeds + truncate strategy_hits).
"""
from __future__ import annotations

import os

os.environ["ARANGO_DB"] = "aistock_test"

import pytest  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402

from src.db import ensure_collection, ensure_database, get_db  # noqa: E402
from src.main import app  # noqa: E402

TEST_STOCK_CODES = [
    {"_key": "2330", "stock_id": "2330", "name": "台積電", "industry": "半導體"},
    {"_key": "2317", "stock_id": "2317", "name": "鴻海", "industry": "其他電子"},
    {"_key": "0050", "stock_id": "0050", "name": "元大台灣50", "industry": "ETF"},
]

TEST_WATCHLIST = [
    {"_key": "2330", "stock_id": "2330"},
    {"_key": "0050", "stock_id": "0050"},
]


@pytest.fixture(scope="session")
def db():
    ensure_database()
    db = get_db()
    for name in ("stock_codes", "watchlist", "strategy_hits"):
        ensure_collection(name)
    col = db.collection("stock_codes")
    for doc in TEST_STOCK_CODES:
        col.insert(doc, overwrite=True)
    wcol = db.collection("watchlist")
    for doc in TEST_WATCHLIST:
        wcol.insert(doc, overwrite=True)
    sh = db.collection("strategy_hits")
    existing = {tuple(i.get("fields", [])) for i in sh.indexes()}
    for fields in (["read"], ["scan_at"]):
        if tuple(fields) not in existing:
            sh.add_index({"type": "persistent", "fields": fields})
    return db


@pytest.fixture()
def clean_hits(db):
    db.aql.execute(
        "FOR h IN strategy_hits REMOVE h IN strategy_hits OPTIONS { ignoreErrors: true }"
    )
    yield
    db.aql.execute(
        "FOR h IN strategy_hits REMOVE h IN strategy_hits OPTIONS { ignoreErrors: true }"
    )


@pytest.fixture(scope="session")
def client(db):
    return TestClient(app)
