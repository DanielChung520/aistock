"""持倉（`positions` collection）— 由 `ledger` **投影**（可完整重建）。規格 §4.3。

`positions` 只是 ledger 的投影；**ledger 才是真相來源**，物化僅為讀取效能。
工作站2 只讀此集合的 `avg_cost` / `shares`（唯讀）。
"""
from __future__ import annotations

from datetime import UTC, datetime

from src.accounting.core import EMPTY, Position, apply_buy, apply_sell
from src.db import ensure_collection, get_db
from src.services import ledger_store

COLLECTION = "positions"

_HOLDING_ACTIONS = ("buy", "opening", "sell")


def ensure_positions() -> None:
    ensure_collection(COLLECTION)


def _key(account_id: str, symbol: str) -> str:
    return f"{account_id}_{symbol}"


def _aggregate(entries: list[dict]) -> dict[str, dict]:
    positions: dict[str, Position] = {}
    realized: dict[str, float] = {}
    last_at: dict[str, float] = {}

    for entry in entries:
        symbol = entry.get("symbol")
        action = entry.get("action")
        if not symbol or action not in _HOLDING_ACTIONS:
            continue

        position = positions.get(symbol, EMPTY)
        if action == "sell":
            position, pnl = apply_sell(
                position,
                shares=int(entry.get("shares") or 0),
                net=float(entry.get("net") or 0.0),
            )
            realized[symbol] = realized.get(symbol, 0.0) + pnl
        else:
            position = apply_buy(
                position,
                shares=int(entry.get("shares") or 0),
                gross=float(entry.get("gross") or 0.0),
                fee=float(entry.get("fee") or 0.0),
            )

        positions[symbol] = position
        last_at[symbol] = float(entry.get("posted_at") or 0.0)

    return {
        symbol: {
            "symbol": symbol,
            "shares": position.shares,
            "avg_cost": position.avg_cost,
            "realized_pnl": round(realized.get(symbol, 0.0), 2),
            "last_trade_at": last_at.get(symbol, 0.0),
        }
        for symbol, position in positions.items()
    }


def rebuild(account_id: str) -> list[dict]:
    """Recompute positions from the ledger and materialize them."""
    ensure_positions()
    aggregated = _aggregate(ledger_store.list_entries(account_id, limit=1_000_000))
    col = get_db().collection(COLLECTION)
    now = datetime.now(UTC).timestamp()

    rows = []
    for symbol, data in sorted(aggregated.items()):
        doc = {
            "_key": _key(account_id, symbol),
            "account_id": account_id,
            **data,
            "updated_at": now,
        }
        col.insert(doc, overwrite=True)
        rows.append(doc)
    return rows


def list_positions(account_id: str, *, holdings_only: bool = False) -> list[dict]:
    ensure_positions()
    cursor = get_db().aql.execute(
        """
        FOR p IN positions
          FILTER p.account_id == @a
          SORT p.symbol ASC
          RETURN p
        """,
        bind_vars={"a": account_id},
    )
    rows = list(cursor)
    if holdings_only:
        rows = [row for row in rows if int(row.get("shares", 0) or 0) > 0]
    return rows


def get_position(account_id: str, symbol: str) -> dict | None:
    col = get_db().collection(COLLECTION)
    key = _key(account_id, symbol)
    if not col.has(key):
        return None
    return col.get(key)
