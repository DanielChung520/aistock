"""帳務 API — 帳戶 / 流水 / 持倉。規格 `.docs/accounting/REQUIREMENTS.md`。

帳務的唯一寫入口（手動分錄）；工作站2 對帳務唯讀。買/賣金額由 `accounting.core`
的費用規則計算，不在此硬編碼常數。
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from src.accounting.core import DAY_TRADE, ETF, STOCK, FeeSchedule
from src.services import (
    account_store,
    corporate_action_store,
    ledger_store,
    position_store,
)

router = APIRouter(prefix="/accounting", tags=["accounting"])

_SCHEDULES: dict[str, FeeSchedule] = {"stock": STOCK, "etf": ETF, "day_trade": DAY_TRADE}
_POSITION_AFFECTING = ("buy", "sell", "opening")


class AccountIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    kind: str = "paper"
    source: str = "manual"
    broker: str | None = None
    currency: str = "TWD"


class StatusIn(BaseModel):
    status: str


class LedgerIn(BaseModel):
    action: str
    symbol: str | None = None
    price: float | None = None
    shares: int | None = None
    gross: float | None = None
    fee: float | None = None
    tax: float | None = None
    net: float | None = None
    trade_date: str | None = None
    note: str = ""
    fee_schedule: str = "stock"


def _require_account(key: str) -> dict:
    account = account_store.get_account(key)
    if account is None:
        raise HTTPException(status_code=404, detail=f"account not found: {key}")
    return account


def _money_fields(req: LedgerIn) -> dict:
    if req.action not in ("buy", "sell"):
        return {
            "gross": req.gross or 0.0,
            "fee": req.fee or 0.0,
            "tax": req.tax or 0.0,
            "net": req.net or 0.0,
        }
    if req.price is None or req.shares is None:
        raise HTTPException(status_code=422, detail="buy/sell 需要 price 與 shares")
    schedule = _SCHEDULES.get(req.fee_schedule)
    if schedule is None:
        raise HTTPException(status_code=422, detail=f"unknown fee_schedule: {req.fee_schedule}")

    gross = round(req.price * req.shares, 2)
    if req.action == "buy":
        fee = schedule.buy_fee(gross)
        return {"gross": gross, "fee": fee, "tax": 0.0, "net": -round(gross + fee, 2)}
    fee = schedule.sell_fee(gross)
    tax = schedule.sell_tax(gross)
    return {"gross": gross, "fee": fee, "tax": tax, "net": round(gross - fee - tax, 2)}


@router.get("/accounts")
def list_accounts() -> dict:
    items = account_store.list_accounts()
    return {"total": len(items), "accounts": items}


@router.post("/accounts")
def create_account(req: AccountIn) -> dict:
    try:
        return account_store.create_account(
            req.name, req.kind, req.source, broker=req.broker, currency=req.currency
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/accounts/{key}")
def get_account(key: str) -> dict:
    return _require_account(key)


@router.put("/accounts/{key}/status")
def set_status(key: str, req: StatusIn) -> dict:
    _require_account(key)
    try:
        return account_store.set_status(key, req.status)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/accounts/{key}/ledger")
def list_ledger(key: str, limit: int = Query(default=200, ge=1, le=5000)) -> dict:
    _require_account(key)
    entries = ledger_store.list_entries(key, limit=limit)
    return {"total": len(entries), "entries": entries}


@router.post("/accounts/{key}/ledger")
def post_ledger(key: str, req: LedgerIn) -> dict:
    _require_account(key)
    money = _money_fields(req)
    try:
        entry = ledger_store.post_entry(
            key,
            req.action,
            symbol=req.symbol,
            price=req.price,
            shares=req.shares,
            trade_date=req.trade_date,
            note=req.note,
            **money,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    if req.action in _POSITION_AFFECTING:
        position_store.rebuild(key)
    return entry


@router.get("/accounts/{key}/positions")
def list_positions(key: str, holdings_only: bool = Query(default=False)) -> dict:
    _require_account(key)
    rows = position_store.list_positions(key, holdings_only=holdings_only)
    return {"total": len(rows), "positions": rows}


@router.post("/accounts/{key}/positions/rebuild")
def rebuild_positions(key: str) -> dict:
    _require_account(key)
    rows = position_store.rebuild(key)
    return {"total": len(rows), "positions": rows}


@router.post("/ledger/{entry_key}/reverse")
def reverse_ledger(entry_key: str) -> dict:
    original = ledger_store.get_entry(entry_key)
    if original is None:
        raise HTTPException(status_code=404, detail=f"entry not found: {entry_key}")
    reversal = ledger_store.reverse_entry(entry_key)
    position_store.rebuild(original["account_id"])
    return reversal


class CorporateActionIn(BaseModel):
    symbol: str
    ex_date: str
    type: str
    cash_dividend: float = 0.0
    stock_ratio: float = 0.0
    source_ref: str | None = None


@router.get("/corporate-actions")
def list_corporate_actions(symbol: str | None = Query(default=None)) -> dict:
    rows = corporate_action_store.list_actions(symbol)
    return {"total": len(rows), "actions": rows}


@router.post("/corporate-actions")
def upsert_corporate_action(req: CorporateActionIn) -> dict:
    try:
        return corporate_action_store.upsert_action(
            req.symbol,
            req.ex_date,
            req.type,
            cash_dividend=req.cash_dividend,
            stock_ratio=req.stock_ratio,
            source_ref=req.source_ref,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/accounts/{key}/corporate-actions/{action_key}/apply")
def apply_corporate_action(key: str, action_key: str) -> dict:
    _require_account(key)
    action = corporate_action_store.get_action(action_key)
    if action is None:
        raise HTTPException(status_code=404, detail=f"corporate action not found: {action_key}")

    position_store.rebuild(key)
    position = position_store.get_position(key, action["symbol"])
    shares = int((position or {}).get("shares", 0) or 0)
    if shares <= 0:
        raise HTTPException(status_code=422, detail=f"no holding for {action['symbol']}")

    posted = [
        ledger_store.post_entry(
            key,
            entry["action"],
            symbol=entry["symbol"],
            shares=entry["shares"],
            net=entry.get("net", 0.0),
            note=entry.get("note", ""),
        )
        for entry in corporate_action_store.entries_for(shares, action)
    ]
    position_store.rebuild(key)
    return {"posted": posted, "position": position_store.get_position(key, action["symbol"])}
