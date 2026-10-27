"""Store tests for accounts + ledger against the aistock_test ArangoDB.

Covers `.docs/accounting/REQUIREMENTS.md` §4.1 (account kind/source) and
§4.2/§5 (append-only ledger, per-account `seq`, reversal-as-new-entry).
"""
from __future__ import annotations

import pytest

from src.services import account_store, ledger_store

_COLLECTIONS = ("accounts", "ledger")


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
    _wipe(db)
    yield db
    _wipe(db)


def test_create_and_list_account(clean_accounting):
    acc = account_store.create_account("紙上帳", kind="paper", source="manual")
    assert acc["kind"] == "paper"
    assert acc["status"] == "active"
    assert [a["id"] for a in account_store.list_accounts()] == [acc["id"]]
    assert account_store.get_account(acc["id"])["name"] == "紙上帳"


def test_create_account_rejects_bad_kind_and_source(clean_accounting):
    with pytest.raises(ValueError):
        account_store.create_account("x", kind="nope")
    with pytest.raises(ValueError):
        account_store.create_account("x", source="nope")
    with pytest.raises(ValueError):
        account_store.create_account("   ")


def test_set_status_archives(clean_accounting):
    acc = account_store.create_account("a")
    assert account_store.set_status(acc["id"], "archived")["status"] == "archived"
    with pytest.raises(ValueError):
        account_store.set_status(acc["id"], "bogus")


def test_ledger_seq_is_monotonic_per_account(clean_accounting):
    a = account_store.create_account("A")
    b = account_store.create_account("B")
    e1 = ledger_store.post_entry(a["id"], "buy", symbol="2330", price=100, shares=1000, gross=100000, fee=142.5, net=-100142.5)
    e2 = ledger_store.post_entry(a["id"], "buy", symbol="2317", price=50, shares=1000, gross=50000, fee=71.25, net=-50071.25)
    e3 = ledger_store.post_entry(b["id"], "buy", symbol="2330", price=100, shares=100, gross=10000, fee=20, net=-10020)
    assert (e1["seq"], e2["seq"], e3["seq"]) == (1, 2, 1)
    assert [e["_key"] for e in ledger_store.list_entries(a["id"])] == [e1["_key"], e2["_key"]]


def test_ledger_rejects_bad_action(clean_accounting):
    a = account_store.create_account("A")
    with pytest.raises(ValueError):
        ledger_store.post_entry(a["id"], "teleport")


def test_reverse_entry_is_appended_not_mutated(clean_accounting):
    a = account_store.create_account("A")
    entry = ledger_store.post_entry(a["id"], "buy", symbol="2330", price=100, shares=1000, gross=100000, fee=142.5, net=-100142.5)
    reversal = ledger_store.reverse_entry(entry["_key"], note="keyed wrongly")
    assert reversal["reversal_of"] == entry["_key"]
    assert reversal["gross"] == -100000
    assert reversal["net"] == 100142.5
    assert reversal["seq"] == entry["seq"] + 1
    assert ledger_store.get_entry(entry["_key"])["gross"] == 100000
    assert len(ledger_store.list_entries(a["id"])) == 2
