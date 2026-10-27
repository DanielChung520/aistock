"""除權息（corporate actions）測試 — core appliers / store / 投影 / API。規格 §4.4、§8.1。"""
from __future__ import annotations

import pytest

from src.accounting.core import (
    Position,
    apply_dividend,
    apply_rights,
    apply_shares_delta,
)
from src.services import (
    account_store,
    corporate_action_store,
    ledger_store,
    position_store,
)

_COLLECTIONS = ("accounts", "ledger", "positions", "corporate_actions")


def _wipe(db) -> None:
    for col in _COLLECTIONS:
        db.aql.execute(
            "FOR d IN @@c REMOVE d IN @@c OPTIONS { ignoreErrors: true }",
            bind_vars={"@c": col},
        )


@pytest.fixture()
def clean(client, db):
    for ensure in (
        account_store.ensure_accounts,
        ledger_store.ensure_ledger,
        position_store.ensure_positions,
        corporate_action_store.ensure_corporate_actions,
    ):
        ensure()
    _wipe(db)
    yield client
    _wipe(db)


def test_apply_dividend_keeps_shares_returns_cash():
    position, cash = apply_dividend(Position(shares=1000, avg_cost=100.0), cash_per_share=2.5)
    assert position.shares == 1000
    assert position.avg_cost == 100.0
    assert cash == 2500.0


def test_apply_rights_increases_shares_lowers_cost():
    result = apply_rights(Position(shares=1000, avg_cost=120.0), stock_ratio=0.1)
    assert result.shares == 1100
    assert result.avg_cost == pytest.approx(120.0 * 1000 / 1100)


def test_apply_shares_delta_to_empty_is_empty():
    assert apply_shares_delta(Position(), delta=-100).is_empty


def test_entries_for_both_dividend_and_right():
    action = {"symbol": "2330", "ex_date": "2024-07-01", "type": "both", "cash_dividend": 3.0, "stock_ratio": 0.1}
    by_kind = {e["action"]: e for e in corporate_action_store.entries_for(1000, action)}
    assert by_kind["dividend"]["net"] == 3000.0
    assert by_kind["corporate_action"]["shares"] == 100


def test_projection_applies_dividend_and_rights(clean):
    acc = account_store.create_account("A")
    gross = 100000.0
    fee = round(gross * 0.001425, 2)
    ledger_store.post_entry(acc["id"], "buy", symbol="2330", price=100.0, shares=1000, gross=gross, fee=fee, net=-(gross + fee))
    ledger_store.post_entry(acc["id"], "dividend", symbol="2330", shares=1000, net=3000.0)
    ledger_store.post_entry(acc["id"], "corporate_action", symbol="2330", shares=100)

    row = position_store.rebuild(acc["id"])[0]
    assert row["shares"] == 1100
    assert row["realized_pnl"] == 3000.0
    assert row["avg_cost"] == pytest.approx((gross + fee) / 1100)


def test_upsert_rejects_bad_type():
    with pytest.raises(ValueError):
        corporate_action_store.upsert_action("2330", "2024-07-01", "nope")


def test_apply_corporate_action_endpoint(clean):
    acc = clean.post("/api/accounting/accounts", json={"name": "P"}).json()
    clean.post(
        f"/api/accounting/accounts/{acc['id']}/ledger",
        json={"action": "buy", "symbol": "2330", "price": 100.0, "shares": 1000},
    )
    action = clean.post(
        "/api/accounting/corporate-actions",
        json={"symbol": "2330", "ex_date": "2024-07-01", "type": "dividend", "cash_dividend": 3.0},
    ).json()

    response = clean.post(f"/api/accounting/accounts/{acc['id']}/corporate-actions/{action['_key']}/apply")
    assert response.status_code == 200
    body = response.json()
    assert body["posted"][0]["action"] == "dividend"
    assert body["position"]["realized_pnl"] == 3000.0


def test_apply_corporate_action_without_holding_422(clean):
    acc = clean.post("/api/accounting/accounts", json={"name": "P"}).json()
    action = clean.post(
        "/api/accounting/corporate-actions",
        json={"symbol": "2317", "ex_date": "2024-07-01", "type": "dividend", "cash_dividend": 1.0},
    ).json()
    response = clean.post(f"/api/accounting/accounts/{acc['id']}/corporate-actions/{action['_key']}/apply")
    assert response.status_code == 422
