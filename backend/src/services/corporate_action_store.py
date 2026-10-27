"""除權息事件（`corporate_actions` collection）。規格 `.docs/accounting/REQUIREMENTS.md` §4.4、§8.1。

除權息事件為**資料**（由外部來源匯入，來源可插拔）；對持倉的效果由
:func:`entries_for` 產生對應的 ledger 分錄（dividend / corporate_action）。
"""
from __future__ import annotations

from src.db import ensure_collection, get_db

COLLECTION = "corporate_actions"
TYPES = ("dividend", "right", "both")


def ensure_corporate_actions() -> None:
    ensure_collection(COLLECTION)


def _key(symbol: str, ex_date: str) -> str:
    return f"{symbol}_{ex_date}"


def upsert_action(
    symbol: str,
    ex_date: str,
    type_: str,
    *,
    cash_dividend: float = 0.0,
    stock_ratio: float = 0.0,
    source_ref: str | None = None,
) -> dict:
    if type_ not in TYPES:
        raise ValueError(f"invalid type: {type_!r} (expected one of {TYPES})")
    ensure_corporate_actions()
    doc = {
        "_key": _key(symbol, ex_date),
        "symbol": symbol,
        "ex_date": ex_date,
        "type": type_,
        "cash_dividend": cash_dividend,
        "stock_ratio": stock_ratio,
        "source_ref": source_ref,
    }
    get_db().collection(COLLECTION).insert(doc, overwrite=True)
    return doc


def get_action(key: str) -> dict | None:
    col = get_db().collection(COLLECTION)
    if not col.has(key):
        return None
    return col.get(key)


def list_actions(symbol: str | None = None) -> list[dict]:
    ensure_corporate_actions()
    if symbol is None:
        cursor = get_db().aql.execute("FOR c IN corporate_actions SORT c.ex_date ASC RETURN c")
    else:
        cursor = get_db().aql.execute(
            "FOR c IN corporate_actions FILTER c.symbol == @s SORT c.ex_date ASC RETURN c",
            bind_vars={"s": symbol},
        )
    return list(cursor)


def entries_for(position_shares: int, action: dict) -> list[dict]:
    """Ledger entries (without account_id) that apply `action` to `position_shares` held."""
    symbol = action["symbol"]
    ex_date = action["ex_date"]
    entries: list[dict] = []

    if action["type"] in ("dividend", "both") and action.get("cash_dividend"):
        entries.append(
            {
                "action": "dividend",
                "symbol": symbol,
                "shares": position_shares,
                "net": round(position_shares * action["cash_dividend"], 2),
                "note": f"{symbol} 除息 {ex_date}",
            }
        )

    if action["type"] in ("right", "both") and action.get("stock_ratio"):
        delta = round(position_shares * action["stock_ratio"])
        if delta:
            entries.append(
                {
                    "action": "corporate_action",
                    "symbol": symbol,
                    "shares": delta,
                    "note": f"{symbol} 除權 {ex_date}",
                }
            )

    return entries
