"""API tests for /api/accounting (aistock_test DB, FastAPI TestClient)."""
from __future__ import annotations

import pytest

_COLLECTIONS = ("accounts", "ledger", "positions")


def _wipe(db) -> None:
    for col in _COLLECTIONS:
        db.aql.execute(
            "FOR d IN @@c REMOVE d IN @@c OPTIONS { ignoreErrors: true }",
            bind_vars={"@c": col},
        )


@pytest.fixture()
def clean(client, db):
    _wipe(db)
    yield client
    _wipe(db)


def test_create_account_and_post_buy_entry(clean):
    acc = clean.post("/api/accounting/accounts", json={"name": "P", "kind": "paper"}).json()
    assert acc["kind"] == "paper" and acc["source"] == "manual"

    r = clean.post(
        f"/api/accounting/accounts/{acc['id']}/ledger",
        json={"action": "buy", "symbol": "2330", "price": 100.0, "shares": 1000},
    )
    assert r.status_code == 200
    entry = r.json()
    assert entry["fee"] == 142.5
    assert entry["net"] == -100142.5


def test_positions_materialized_after_buy_and_reversed(clean):
    acc = clean.post("/api/accounting/accounts", json={"name": "P"}).json()
    entry = clean.post(
        f"/api/accounting/accounts/{acc['id']}/ledger",
        json={"action": "buy", "symbol": "2330", "price": 100.0, "shares": 1000},
    ).json()

    positions = clean.get(f"/api/accounting/accounts/{acc['id']}/positions?holdings_only=true").json()
    assert positions["total"] == 1
    assert positions["positions"][0]["shares"] == 1000

    assert clean.post(f"/api/accounting/ledger/{entry['_key']}/reverse").status_code == 200
    after = clean.get(f"/api/accounting/accounts/{acc['id']}/positions?holdings_only=true").json()
    assert after["total"] == 0


def test_sell_uses_tax_and_fee(clean):
    acc = clean.post("/api/accounting/accounts", json={"name": "P"}).json()
    clean.post(f"/api/accounting/accounts/{acc['id']}/ledger", json={"action": "buy", "symbol": "2330", "price": 100.0, "shares": 1000})
    entry = clean.post(
        f"/api/accounting/accounts/{acc['id']}/ledger",
        json={"action": "sell", "symbol": "2330", "price": 120.0, "shares": 1000, "fee_schedule": "etf"},
    ).json()
    assert entry["tax"] == 120.0
    assert entry["net"] == 120000.0 - entry["fee"] - 120.0


def test_validation_and_not_found(clean):
    assert clean.get("/api/accounting/accounts/nope").status_code == 404
    assert clean.post("/api/accounting/accounts", json={"name": "x", "kind": "weird"}).status_code == 422

    acc = clean.post("/api/accounting/accounts", json={"name": "P"}).json()
    missing = clean.post(f"/api/accounting/accounts/{acc['id']}/ledger", json={"action": "buy", "symbol": "2330"})
    assert missing.status_code == 422
    bad_schedule = clean.post(
        f"/api/accounting/accounts/{acc['id']}/ledger",
        json={"action": "buy", "symbol": "2330", "price": 10.0, "shares": 1, "fee_schedule": "nope"},
    )
    assert bad_schedule.status_code == 422
