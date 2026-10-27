"""Projection tests: positions derived from the ledger (aistock_test DB).

Covers `.docs/accounting/REQUIREMENTS.md` §4.3 (positions are a ledger projection,
rebuildable) and §5 (reversal restores state) — buy / partial sell / full sell /
reversal / holdings-only filter.
"""
from __future__ import annotations

import pytest

from src.services import account_store, ledger_store, position_store

_COLLECTIONS = ("accounts", "ledger", "positions")


def _wipe(db) -> None:
    for col in _COLLECTIONS:
        db.aql.execute(
            "FOR d IN @@c REMOVE d IN @@c OPTIONS { ignoreErrors: true }",
            bind_vars={"@c": col},
        )


@pytest.fixture()
def clean_accounting(db):
    account_store.ensure_accounts()
    ledger_store.ensure_ledger()
    position_store.ensure_positions()
    _wipe(db)
    yield db
    _wipe(db)


def _buy_entry(account_id, symbol, price, shares):
    gross = price * shares
    fee = round(gross * 0.001425, 2)
    return ledger_store.post_entry(
        account_id, "buy", symbol=symbol, price=price, shares=shares,
        gross=gross, fee=fee, net=-(gross + fee),
    )


def _sell_entry(account_id, symbol, price, shares):
    gross = price * shares
    fee = round(gross * 0.001425, 2)
    tax = round(gross * 0.003, 2)
    return ledger_store.post_entry(
        account_id, "sell", symbol=symbol, price=price, shares=shares,
        gross=gross, fee=fee, tax=tax, net=gross - fee - tax,
    )


def test_rebuild_from_single_buy(clean_accounting):
    acc = account_store.create_account("A")
    _buy_entry(acc["id"], "2330", 100.0, 1000)
    rows = position_store.rebuild(acc["id"])
    assert len(rows) == 1
    assert rows[0]["symbol"] == "2330"
    assert rows[0]["shares"] == 1000
    assert rows[0]["avg_cost"] == pytest.approx(100142.5 / 1000)


def test_partial_then_full_sell(clean_accounting):
    acc = account_store.create_account("A")
    _buy_entry(acc["id"], "2330", 100.0, 1000)
    _sell_entry(acc["id"], "2330", 120.0, 400)

    row = position_store.rebuild(acc["id"])[0]
    assert row["shares"] == 600
    assert row["avg_cost"] == pytest.approx(100142.5 / 1000)
    assert row["realized_pnl"] > 0

    _sell_entry(acc["id"], "2330", 120.0, 600)
    row = position_store.rebuild(acc["id"])[0]
    assert row["shares"] == 0
    assert row["avg_cost"] == 0.0


def test_reversal_restores_flat_position(clean_accounting):
    acc = account_store.create_account("A")
    entry = _buy_entry(acc["id"], "2330", 100.0, 1000)
    ledger_store.reverse_entry(entry["_key"])
    assert position_store.rebuild(acc["id"])[0]["shares"] == 0


def test_holdings_only_filters_closed_positions(clean_accounting):
    acc = account_store.create_account("A")
    _buy_entry(acc["id"], "2330", 100.0, 1000)
    _buy_entry(acc["id"], "2317", 50.0, 1000)
    _sell_entry(acc["id"], "2317", 50.0, 1000)
    position_store.rebuild(acc["id"])

    assert {r["symbol"] for r in position_store.list_positions(acc["id"])} == {"2330", "2317"}
    assert [r["symbol"] for r in position_store.list_positions(acc["id"], holdings_only=True)] == ["2330"]


def test_get_position_by_key(clean_accounting):
    acc = account_store.create_account("A")
    _buy_entry(acc["id"], "2330", 100.0, 1000)
    position_store.rebuild(acc["id"])
    assert position_store.get_position(acc["id"], "2330")["shares"] == 1000
    assert position_store.get_position(acc["id"], "9999") is None
