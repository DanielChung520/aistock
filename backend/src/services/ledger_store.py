"""流水（`ledger` collection）— **append-only**。規格 `.docs/accounting/REQUIREMENTS.md` §4.2、§5。

只增不改不刪：更正以「反向分錄」為之（`reversal_of` 指向原分錄，金額取負）。
`seq` 為帳內單調遞增序號；`net` 為現金淨流量（買為負、賣/股利為正）。
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime

from src.db import ensure_collection, get_db

COLLECTION = "ledger"
ACTIONS = (
    "buy",
    "sell",
    "dividend",
    "corporate_action",
    "fee",
    "deposit",
    "withdraw",
    "opening",
)


def _now() -> float:
    return datetime.now(UTC).timestamp()


def _today() -> str:
    return datetime.now(UTC).date().isoformat()


def ensure_ledger() -> None:
    ensure_collection(COLLECTION)


def _next_seq(account_id: str) -> int:
    cursor = get_db().aql.execute(
        "FOR l IN ledger FILTER l.account_id == @a COLLECT AGGREGATE m = MAX(l.seq) RETURN m",
        bind_vars={"a": account_id},
    )
    rows = list(cursor)
    return int(rows[0] or 0) + 1 if rows and rows[0] is not None else 1


def post_entry(
    account_id: str,
    action: str,
    *,
    symbol: str | None = None,
    price: float | None = None,
    shares: int | None = None,
    gross: float = 0.0,
    fee: float = 0.0,
    tax: float = 0.0,
    net: float = 0.0,
    trade_date: str | None = None,
    settle_date: str | None = None,
    source: str = "manual",
    external_ref: str | None = None,
    note: str = "",
    reversal_of: str | None = None,
) -> dict:
    if action not in ACTIONS:
        raise ValueError(f"invalid action: {action!r} (expected one of {ACTIONS})")

    ensure_ledger()
    col = get_db().collection(COLLECTION)
    doc = {
        "_key": f"led_{uuid.uuid4().hex[:12]}",
        "account_id": account_id,
        "seq": _next_seq(account_id),
        "posted_at": _now(),
        "trade_date": trade_date or _today(),
        "settle_date": settle_date,
        "action": action,
        "symbol": symbol,
        "price": price,
        "shares": shares,
        "gross": gross,
        "fee": fee,
        "tax": tax,
        "net": net,
        "source": source,
        "external_ref": external_ref,
        "reversal_of": reversal_of,
        "note": note,
    }
    col.insert(doc)
    return doc


def list_entries(account_id: str, limit: int = 200) -> list[dict]:
    ensure_ledger()
    cursor = get_db().aql.execute(
        """
        FOR l IN ledger
          FILTER l.account_id == @a
          SORT l.seq ASC
          LIMIT @n
          RETURN l
        """,
        bind_vars={"a": account_id, "n": limit},
    )
    return list(cursor)


def get_entry(key: str) -> dict | None:
    col = get_db().collection(COLLECTION)
    if not col.has(key):
        return None
    return col.get(key)


def reverse_entry(key: str, *, note: str = "") -> dict | None:
    """Append a negated mirror of an existing entry (append-only correction)."""
    original = get_entry(key)
    if original is None:
        return None
    return post_entry(
        original["account_id"],
        original["action"],
        symbol=original.get("symbol"),
        price=original.get("price"),
        shares=original.get("shares"),
        gross=-float(original.get("gross") or 0.0),
        fee=-float(original.get("fee") or 0.0),
        tax=-float(original.get("tax") or 0.0),
        net=-float(original.get("net") or 0.0),
        trade_date=original.get("trade_date"),
        source=original.get("source", "manual"),
        reversal_of=key,
        note=note or f"reverse of {key}",
    )
