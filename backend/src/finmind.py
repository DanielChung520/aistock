"""FinMind API client for institutional and market position data."""

import os
from datetime import date, timedelta
from typing import Literal

import httpx
from pydantic import BaseModel

BASE_URL = "https://api.finmindtrade.com/api/v4/data"


def _finmind_headers() -> dict[str, str]:
    token = os.getenv("FINMIND_TOKEN", "")
    return {"Authorization": f"Bearer {token}"} if token else {}


def _fetch_finmind(
    dataset: str,
    stock_id: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    params: dict | None = None,
) -> list[dict]:
    query_params = {"dataset": dataset}
    if stock_id:
        query_params["data_id"] = stock_id
    if start_date:
        query_params["start_date"] = start_date
    if end_date:
        query_params["end_date"] = end_date
    if params:
        query_params.update(params)

    headers = _finmind_headers()
    with httpx.Client(timeout=30.0) as client:
        resp = client.get(BASE_URL, params=query_params, headers=headers)
        resp.raise_for_status()
        data = resp.json()
        if data.get("status") != 200:
            return []
        return data.get("data", [])


# name field values: Foreign_Investor, Investment_Trust, Dealer_self, Dealer_Hedging, Foreign_Dealer_Self
class InstitutionalItem(BaseModel):
    date: str
    stock_id: str
    name: str
    buy: int
    sell: int


class MarginShortSale(BaseModel):
    date: str
    stock_id: str
    MarginPurchaseBuy: int
    MarginPurchaseSell: int
    MarginPurchaseTodayBalance: int
    MarginPurchaseYesterdayBalance: int
    MarginPurchaseLimit: int
    ShortSaleBuy: int
    ShortSaleSell: int
    ShortSaleTodayBalance: int
    ShortSaleYesterdayBalance: int
    ShortSaleLimit: int


class Shareholding(BaseModel):
    date: str
    stock_id: str
    stock_name: str
    ForeignInvestmentShares: int
    ForeignInvestmentSharesRatio: float
    ForeignInvestmentUpperLimitRatio: float
    NumberOfSharesIssued: int


class DayTrading(BaseModel):
    date: str
    stock_id: str
    Volume: int
    BuyAmount: int
    SellAmount: int


class ShortSaleBalance(BaseModel):
    date: str
    stock_id: str
    MarginShortSalesCurrentDayBalance: int
    SBLShortSalesCurrentDayBalance: int


def fetch_institutional_buy_sell(
    stock_id: str,
    days: int = 20,
) -> list[InstitutionalItem]:
    end = date.today()
    start = end - timedelta(days=days * 3)
    rows = _fetch_finmind(
        dataset="TaiwanStockInstitutionalInvestorsBuySell",
        stock_id=stock_id,
        start_date=start.isoformat(),
        end_date=end.isoformat(),
    )
    return [InstitutionalItem(**r) for r in rows]


def fetch_margin_short_sale(
    stock_id: str,
    days: int = 20,
) -> list[MarginShortSale]:
    end = date.today()
    start = end - timedelta(days=days * 3)
    rows = _fetch_finmind(
        dataset="TaiwanStockMarginPurchaseShortSale",
        stock_id=stock_id,
        start_date=start.isoformat(),
        end_date=end.isoformat(),
    )
    return [MarginShortSale(**r) for r in rows]


def fetch_shareholding(stock_id: str) -> Shareholding | None:
    end = date.today()
    start = end - timedelta(days=90)
    rows = _fetch_finmind(
        dataset="TaiwanStockShareholding",
        stock_id=stock_id,
        start_date=start.isoformat(),
        end_date=end.isoformat(),
    )
    if not rows:
        return None
    return Shareholding(**rows[0])


def fetch_day_trading(stock_id: str, days: int = 20) -> list[DayTrading]:
    end = date.today()
    start = end - timedelta(days=days * 3)
    rows = _fetch_finmind(
        dataset="TaiwanStockDayTrading",
        stock_id=stock_id,
        start_date=start.isoformat(),
        end_date=end.isoformat(),
    )
    return [DayTrading(**r) for r in rows]


def fetch_short_sale_balances(
    stock_id: str,
    days: int = 20,
) -> list[ShortSaleBalance]:
    end = date.today()
    start = end - timedelta(days=days * 3)
    rows = _fetch_finmind(
        dataset="TaiwanDailyShortSaleBalances",
        stock_id=stock_id,
        start_date=start.isoformat(),
        end_date=end.isoformat(),
    )
    return [ShortSaleBalance(**r) for r in rows]
