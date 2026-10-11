"""Celery task: scheduled incremental download of research-universe data.

Four staged jobs (see scheduler.py PREDEFINED_JOBS):
  1. research_ohlcv   — daily OHLCV + O1/C1 for the 59-stock universe
                        (2y window maintained; 10y base already backfilled)
  2. research_flows   — institutional investor buy/sell (FinMind)
  3. research_margin  — margin purchase / short sale (FinMind)
  4. research_revenue — monthly revenue (FinMind)

Each task is idempotent/resumable: it only fetches what is missing for the
current window and upserts with overwrite=True. The DNS workaround (_dns_fix)
is applied because the host resolver intermittently fails; the fetch helpers
live in scripts/ so the scripts and the scheduler share one implementation.

Storage (方案A): daily OHLCV + O1/C1 are written into `stock_daily` (the
single yfinance OHLCV source shared with the K-line charts). O1 = Close of
the 09:00 60m bar (= 10:00 price), C1 = Close of the 12:00 60m bar
(= 13:00 price).
"""
from __future__ import annotations

import logging
import sys
import traceback
from datetime import date, timedelta
from pathlib import Path

from src.celery_app import celery_app

logger = logging.getLogger(__name__)

BACKEND_ROOT = Path(__file__).resolve().parent.parent.parent
SCRIPTS_DIR = BACKEND_ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

O1C1_WINDOW_DAYS = 730  # keep O1/C1 for the model-training window (2y)
OHLCV_INCREMENT_DAYS = 5  # refetch last few days (covers today + holidays)

UNIVERSE_PATH = BACKEND_ROOT.parent / "frontend/src/lib/data/research-universe-ai-memory-passive.json"


def _universe_stocks() -> list[dict]:
    import json

    data = json.load(open(UNIVERSE_PATH))
    return data["stocks"]


def _universe_stock_ids() -> list[str]:
    return [s["stock_id"] for s in _universe_stocks()]


def _suffix(stock_id: str) -> str:
    # Market comes from the universe JSON (no twstock import — its CLI module
    # breaks inside Celery workers, see LoggingProxy issue).
    for s in _universe_stocks():
        if s["stock_id"] == stock_id:
            return ".TWO" if s.get("market") == "上櫃" else ".TW"
    return ".TW"


# ── OHLCV + O1/C1 ─────────────────────────────────────────────

def _fetch_ohlcv_incremental(stock_id: str) -> tuple[list[dict], dict[str, dict]]:
    """Fetch recent daily OHLCV (last 5d) and O1/C1 (last 2y window)."""
    import yfinance as yf

    ticker = f"{stock_id}{_suffix(stock_id)}"

    # Daily OHLCV — last 10 days (dedupes; only missing dates are written)
    daily_df = yf.Ticker(ticker).history(period="10d", auto_adjust=False)
    daily_rows: list[dict] = []
    if not daily_df.empty:
        for dt, r in daily_df.iterrows():
            try:
                c = float(r["Close"])
                if c != c:
                    continue
                daily_rows.append({
                    "date": dt.strftime("%Y-%m-%d"),
                    "open": round(float(r["Open"]), 2),
                    "high": round(float(r["High"]), 2),
                    "low": round(float(r["Low"]), 2),
                    "close": round(c, 2),
                    "volume": int(r["Volume"]),
                })
            except Exception:
                continue

    # O1/C1 — 2y window via 60m (O1=10:00 price, C1=13:00 price)
    o1c1: dict[str, dict] = {}
    minute_df = yf.Ticker(ticker).history(period="2y", interval="60m", auto_adjust=False)
    if not minute_df.empty:
        for dt, r in minute_df.iterrows():
            try:
                h, m = dt.hour, dt.minute
                c = float(r["Close"])
                if c != c:
                    continue
                dstr = dt.strftime("%Y-%m-%d")
                if h == 9 and m == 0:
                    o1c1.setdefault(dstr, {})["o1"] = round(c, 2)
                elif h == 12 and m == 0:
                    o1c1.setdefault(dstr, {})["c1"] = round(c, 2)
            except Exception:
                continue
    return daily_rows, o1c1


def _upsert_daily(stock_id: str, daily_rows: list[dict], o1c1: dict[str, dict]) -> dict:
    """Upsert daily OHLCV (+ O1/C1) into stock_daily.

    Existing rows keep their stored o1/c1 unless the new fetch supplies them
    (o1/c1 may be missing on some days, e.g. no 60m data for delisted days).
    """
    from arango.exceptions import ArangoError

    from src.db import get_db

    db = get_db()
    col = db.collection("stock_daily")
    existing = {
        str(r)
        for r in db.aql.execute(
            "FOR d IN stock_daily FILTER d.stock_id == @s RETURN d.date",
            bind_vars={"s": stock_id},
        )
    }
    written = 0
    o1_written = 0
    c1_written = 0
    for r in daily_rows:
        key = f"{stock_id}_{r['date']}"
        doc = {"_key": key, "stock_id": stock_id, **r}
        oc = o1c1.get(r["date"], {})
        if "o1" in oc:
            doc["o1"] = oc["o1"]
            o1_written += 1
        if "c1" in oc:
            doc["c1"] = oc["c1"]
            c1_written += 1
        try:
            if r["date"] in existing:
                col.update(doc, merge=True)
            else:
                col.insert(doc, overwrite=True)
            written += 1
        except ArangoError:
            pass
    return {"stock_id": stock_id, "written": written, "o1": o1_written, "c1": c1_written}


@celery_app.task
def research_ohlcv() -> dict:
    """Incremental daily OHLCV + O1/C1 for the whole universe."""
    results = []
    for stock_id in _universe_stock_ids():
        try:
            daily, o1c1 = _fetch_ohlcv_incremental(stock_id)
            stat = _upsert_daily(stock_id, daily, o1c1)
            results.append(stat)
            logger.info("research_ohlcv %s: %s", stock_id, stat)
        except Exception as exc:
            logger.error("research_ohlcv %s failed: %s\n%s", stock_id, exc, traceback.format_exc())
            results.append({"stock_id": stock_id, "error": str(exc)})
    total_written = sum(r.get("written", 0) for r in results)
    total_o1 = sum(r.get("o1", 0) for r in results)
    return {"stocks": len(results), "written": total_written, "o1": total_o1, "ok": sum(1 for r in results if "error" not in r)}


# ── FinMind features (flows / margin / revenue) ─────────────────

def _fetch_finmind(dataset: str, stock_id: str, start: str, end: str, token: str) -> list[dict]:
    import httpx

    r = httpx.get(
        "https://api.finmindtrade.com/api/v4/data",
        params={
            "dataset": dataset,
            "data_id": stock_id,
            "start_date": start,
            "end_date": end,
            "token": token,
        },
        timeout=30,
    )
    j = r.json()
    if j.get("msg") != "success":
        raise RuntimeError(f"{dataset} {stock_id}: {j.get('msg', r.status_code)}")
    rows = j.get("data") or []
    for row in rows:
        row["stock_id"] = stock_id
        row["date"] = str(row.get("date", ""))[:10]
    return rows


def _load_token() -> str:
    import re

    env = (BACKEND_ROOT / ".env").read_text()
    m = re.search(r"FINMIND_TOKEN=(\S+)", env)
    if not m:
        raise RuntimeError("FINMIND_TOKEN not found in backend/.env")
    return m.group(1)


def _upsert_finmind(coll_name: str, stock_id: str, rows: list[dict]) -> int:
    from arango.exceptions import ArangoError

    from src.db import get_db

    if not rows:
        return 0
    col = get_db().collection(coll_name)
    written = 0
    for r in rows:
        key = f"{stock_id}_{r['date']}"
        try:
            col.insert({"_key": key, **r}, overwrite=True)
            written += 1
        except ArangoError:
            pass
    return written


def _run_finmind_dataset(dataset: str, coll_name: str, days: int) -> dict:
    token = _load_token()
    end = date.today()
    start = end - timedelta(days=days)
    results = []
    for stock_id in _universe_stock_ids():
        try:
            rows = _fetch_finmind(dataset, stock_id, start.isoformat(), end.isoformat(), token)
            written = _upsert_finmind(coll_name, stock_id, rows)
            results.append({"stock_id": stock_id, "written": written})
        except Exception as exc:
            logger.error("%s %s failed: %s\n%s", dataset, stock_id, exc, traceback.format_exc())
            results.append({"stock_id": stock_id, "error": str(exc)})
    return {
        "dataset": dataset,
        "stocks": len(results),
        "written": sum(r.get("written", 0) for r in results),
        "ok": sum(1 for r in results if "error" not in r),
    }


@celery_app.task
def research_flows() -> dict:
    """Institutional buy/sell — refetch last 10 days (incremental upsert)."""
    return _run_finmind_dataset(
        "TaiwanStockInstitutionalInvestorsBuySell", "stock_institutional_flows", days=10
    )


@celery_app.task
def research_margin() -> dict:
    """Margin purchase / short sale — refetch last 10 days."""
    return _run_finmind_dataset(
        "TaiwanStockMarginPurchaseShortSale", "stock_margin", days=10
    )


@celery_app.task
def research_revenue() -> dict:
    """Monthly revenue — refetch last 60 days (covers current + previous month)."""
    return _run_finmind_dataset("TaiwanStockMonthRevenue", "stock_monthly_revenue", days=60)
