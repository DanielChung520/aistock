"""Institutional investor (三大法人) daily data — TWSE + TPEx official sources.

Whole-market 三大法人 buy/sell by stock, one document per stock per trading day.
Sources (both free, ~2 requests per trading day for the whole market):
  - TWSE T86  (上市) https://www.twse.com.tw/rwd/zh/fund/T86?selectType=ALL
  - TPEx 三大法人日報 (上櫃) https://www.tpex.org.tw/www/zh-tw/insti/dailyTrade

Stored in ArangoDB `institutional_daily`, key `{stock_id}_{date}` (permanent —
never expired). Only stocks present in `stock_codes` are persisted (the T86/TPEx
responses also contain 權證/ETF codes we do not track, dropping volume ~10x).

Units: shares (股). Values are normalized to int; comma strings parsed, '-'/''→0.

The two sources use different column layouts — see _parse_twse_row / _parse_tpex_row
for the exact index maps (verified against live responses).
"""
from __future__ import annotations

import logging
from datetime import date

import httpx

from src.rate_limiter import twse_rate_limiter

logger = logging.getLogger(__name__)

INSTITUTIONAL_COLLECTION = "institutional_daily"
TWSE_T86_URL = "https://www.twse.com.tw/rwd/zh/fund/T86"
TPEX_INSTI_URL = "https://www.tpex.org.tw/www/zh-tw/insti/dailyTrade"
REQUEST_TIMEOUT = 30.0
_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; aistock/1.0)"}

# Buy/sell fields summed to decide whether a stock was traded by 三大法人 on a day.
_GROSS_FIELDS = (
    "foreign_buy",
    "foreign_sell",
    "foreign_dealer_buy",
    "foreign_dealer_sell",
    "trust_buy",
    "trust_sell",
    "dealer_self_buy",
    "dealer_self_sell",
    "dealer_hedge_buy",
    "dealer_hedge_sell",
)


def _to_int(value: object) -> int:
    """Parse a TWSE/TPEx numeric cell ('1,234', '-', '', ...) to int."""
    if value is None:
        return 0
    text = str(value).replace(",", "").replace(" ", "").strip()
    if text in ("", "-", "--", "nan", "None"):
        return 0
    try:
        return int(text)
    except ValueError:
        try:
            return int(float(text))
        except ValueError:
            return 0


def known_stock_ids() -> set[str]:
    """The stock_id whitelist (from stock_codes) — we only persist these."""
    from src.db import get_db

    cursor = get_db().aql.execute("FOR s IN stock_codes RETURN s.stock_id")
    return {str(row) for row in cursor}


def _base_row(stock_id: str, iso_date: str, market: str, source: str, cells: dict) -> dict:
    return {"stock_id": stock_id, "date": iso_date, "market": market, "source": source, **cells}


def fetch_twse_institutional(day: date, known: set[str]) -> list[dict]:
    """TWSE T86 — 上市 三大法人 per stock for one day (normalized rows)."""
    twse_rate_limiter.wait()
    params = {"date": day.strftime("%Y%m%d"), "selectType": "ALL", "response": "json"}
    with httpx.Client(timeout=REQUEST_TIMEOUT, headers=_HEADERS) as client:
        resp = client.get(TWSE_T86_URL, params=params)
        resp.raise_for_status()
        payload = resp.json()
    if payload.get("stat") != "OK":
        return []
    iso = day.isoformat()
    rows: list[dict] = []
    for r in payload.get("data") or []:
        if len(r) < 19:
            continue
        sid = str(r[0]).strip()
        if sid not in known:
            continue
        # Column map (verified live 2026-10):
        # 2/3/4 外陸資(不含外資自營) 買進/賣出/買賣超；5/6/7 外資自營商；
        # 8/9/10 投信；11 自營商合計買賣超；12/13/14 自營商(自行)；15/16/17 自營商(避險)；18 三大法人合計
        rows.append(
            _base_row(
                sid,
                iso,
                "上市",
                "twse",
                {
                    "foreign_buy": _to_int(r[2]),
                    "foreign_sell": _to_int(r[3]),
                    "foreign_net": _to_int(r[4]),
                    "foreign_dealer_buy": _to_int(r[5]),
                    "foreign_dealer_sell": _to_int(r[6]),
                    "foreign_dealer_net": _to_int(r[7]),
                    "trust_buy": _to_int(r[8]),
                    "trust_sell": _to_int(r[9]),
                    "trust_net": _to_int(r[10]),
                    "dealer_self_buy": _to_int(r[12]),
                    "dealer_self_sell": _to_int(r[13]),
                    "dealer_self_net": _to_int(r[14]),
                    "dealer_hedge_buy": _to_int(r[15]),
                    "dealer_hedge_sell": _to_int(r[16]),
                    "dealer_hedge_net": _to_int(r[17]),
                    "total_net": _to_int(r[18]),
                },
            )
        )
    return rows


def fetch_tpex_institutional(day: date, known: set[str]) -> list[dict]:
    """TPEx 三大法人日報 — 上櫃 三大法人 per stock for one day (normalized rows)."""
    twse_rate_limiter.wait()
    params = {"date": day.strftime("%Y/%m/%d"), "type": "Daily", "response": "json"}
    with httpx.Client(timeout=REQUEST_TIMEOUT, headers=_HEADERS) as client:
        resp = client.get(TPEX_INSTI_URL, params=params)
        resp.raise_for_status()
        payload = resp.json()
    if str(payload.get("stat", "")).lower() != "ok":
        return []
    tables = payload.get("tables") or []
    if not tables:
        return []
    iso = day.isoformat()
    rows: list[dict] = []
    for r in tables[0].get("data") or []:
        if len(r) < 24:
            continue
        sid = str(r[0]).strip()
        if sid not in known:
            continue
        # Column map (verified live 2026-10): 2/3/4 外資及陸資(不含外資自營)；
        # 5/6/7 外資自營商；8/9/10 外資及陸資合計；11/12/13 投信；
        # 14/15/16 自營商(自行)；17/18/19 自營商(避險)；20/21/22 自營商合計；23 三大法人合計
        rows.append(
            _base_row(
                sid,
                iso,
                "上櫃",
                "tpex",
                {
                    "foreign_buy": _to_int(r[2]),
                    "foreign_sell": _to_int(r[3]),
                    "foreign_net": _to_int(r[4]),
                    "foreign_dealer_buy": _to_int(r[5]),
                    "foreign_dealer_sell": _to_int(r[6]),
                    "foreign_dealer_net": _to_int(r[7]),
                    "trust_buy": _to_int(r[11]),
                    "trust_sell": _to_int(r[12]),
                    "trust_net": _to_int(r[13]),
                    "dealer_self_buy": _to_int(r[14]),
                    "dealer_self_sell": _to_int(r[15]),
                    "dealer_self_net": _to_int(r[16]),
                    "dealer_hedge_buy": _to_int(r[17]),
                    "dealer_hedge_sell": _to_int(r[18]),
                    "dealer_hedge_net": _to_int(r[19]),
                    "total_net": _to_int(r[23]),
                },
            )
        )
    return rows


def fetch_institutional(day: date, known: set[str] | None = None) -> list[dict]:
    """Fetch one day's whole-market 三大法人 (上市 + 上櫃). Each source fails soft."""
    if known is None:
        known = known_stock_ids()
    rows: list[dict] = []
    try:
        rows += fetch_twse_institutional(day, known)
    except Exception:  # noqa: BLE001 — one source failing must not kill the other
        logger.exception("TWSE T86 fetch failed for %s", day)
    try:
        rows += fetch_tpex_institutional(day, known)
    except Exception:  # noqa: BLE001
        logger.exception("TPEx insti fetch failed for %s", day)
    return rows


def is_traded(row: dict) -> bool:
    """True when 三大法人 had any buy or sell activity that day (net may be 0)."""
    return sum(_to_int(row.get(k)) for k in _GROSS_FIELDS) > 0


def upsert_institutional(rows: list[dict]) -> int:
    """Idempotent upsert into institutional_daily (key {stock_id}_{date})."""
    from arango.exceptions import ArangoError

    from src.db import ensure_collection, get_db

    if not rows:
        return 0
    ensure_collection(INSTITUTIONAL_COLLECTION)
    col = get_db().collection(INSTITUTIONAL_COLLECTION)
    written = 0
    for r in rows:
        doc = {"_key": f"{r['stock_id']}_{r['date']}", **r}
        try:
            col.insert(doc, overwrite=True)
            written += 1
        except ArangoError:
            pass
    return written


def ensure_index() -> None:
    """Persistent index on (stock_id, date) so per-stock window queries stay fast."""
    from src.db import ensure_collection, get_db

    ensure_collection(INSTITUTIONAL_COLLECTION)
    col = get_db().collection(INSTITUTIONAL_COLLECTION)
    if not col.indexes():
        return
    existing = {tuple(idx.get("fields", [])) for idx in col.indexes()}
    if ("stock_id", "date") not in existing:
        col.add_persistent_index(fields=["stock_id", "date"])
