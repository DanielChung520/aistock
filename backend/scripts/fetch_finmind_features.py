#!/usr/bin/env python3
"""
Pull FinMind feature data for the research universe (64 stocks, 2y window):
  - Institutional investor buy/sell  -> `stock_institutional_flows`
  - Margin purchase / short sale     -> `stock_margin`
  - Monthly revenue                  -> `stock_monthly_revenue`

Source: FinMind v4 API (register level: 600 req/hr).
Uses FINMIND_TOKEN from backend/.env. Rate-limited with a polite delay.

Storage: three ArangoDB collections, each keyed {_key, stock_id, date, ...raw fields}.
Resumable: skips (stock_id, dataset) pairs already fetched for the date range.
"""
import json
import os
import sys
import time
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, "/home/daniel/github/aistock/backend/scripts")
import _dns_fix  # noqa: E402
_dns_fix.patch()

import httpx
from arango.exceptions import ArangoError

sys.path.insert(0, "/home/daniel/github/aistock/backend")
from src.db import get_db

UNIVERSE_PATH = "/home/daniel/github/aistock/frontend/src/lib/data/research-universe-ai-memory-passive.json"
ENV_PATH = Path("/home/daniel/github/aistock/backend/.env")
API = "https://api.finmindtrade.com/api/v4/data"

# dataset -> collection name
DATASETS = {
    "TaiwanStockInstitutionalInvestorsBuySell": "stock_institutional_flows",
    "TaiwanStockMarginPurchaseShortSale": "stock_margin",
    "TaiwanStockMonthRevenue": "stock_monthly_revenue",
}

DAYS = 730  # 2-year window, matching stock_daily O1/C1 window


def load_token() -> str:
    for line in ENV_PATH.read_text().splitlines():
        if line.startswith("FINMIND_TOKEN="):
            return line.split("=", 1)[1].strip()
    raise RuntimeError("FINMIND_TOKEN not found in backend/.env")


def ensure_collections() -> None:
    db = get_db()
    for _, coll in DATASETS.items():
        if not db.has_collection(coll):
            db.create_collection(coll)
        col = db.collection(coll)
        existing = [idx["fields"] for idx in col.indexes() if idx["fields"] != ["_key"]]
        if ["stock_id", "date"] not in existing:
            try:
                col.add_index({"type": "hash", "fields": ["stock_id", "date"], "unique": True})
            except Exception:
                pass


def get_existing_dates(coll_name: str, stock_id: str) -> set[str]:
    db = get_db()
    aql = f"""
    FOR d IN {coll_name}
      FILTER d.stock_id == @sid
      RETURN d.date
    """
    return {row for row in db.aql.execute(aql, bind_vars={"sid": stock_id})}


def fetch_dataset(token: str, dataset: str, stock_id: str, start: str, end: str) -> list[dict]:
    r = httpx.get(
        API,
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


def upsert(coll_name: str, stock_id: str, records: list[dict]) -> int:
    if not records:
        return 0
    col = get_db().collection(coll_name)
    written = 0
    for r in records:
        key = f"{stock_id}_{r['date']}"
        try:
            col.insert({"_key": key, **r}, overwrite=True)
            written += 1
        except ArangoError:
            pass
    return written


def main() -> None:
    ensure_collections()
    token = load_token()
    universe = json.load(open(UNIVERSE_PATH))["stocks"]
    print(f"universe size: {len(universe)} stocks; datasets: {list(DATASETS)}\n")

    end = date.today()
    start = end - timedelta(days=DAYS)

    summary = []
    for i, s in enumerate(universe):
        sid, name = s["stock_id"], s["name"]
        per_stock = {}
        err = None
        for dataset, coll in DATASETS.items():
            existing = get_existing_dates(coll, sid)
            if existing:
                per_stock[dataset] = {"new": 0, "total": len(existing)}
                continue
            try:
                rows = fetch_dataset(token, dataset, sid, start.isoformat(), end.isoformat())
                written = upsert(coll, sid, rows)
                per_stock[dataset] = {"new": written, "total": len(rows)}
                print(f"  {sid} {name:<8} {dataset:<45} new={written:>5}")
            except Exception as e:
                err = f"{dataset}: {e}"
                per_stock[dataset] = {"error": str(e)}
            time.sleep(0.7)  # polite: ~85 req/min, far below 600/hr
        status = "✗ " + err if err else "ok"
        summary.append({"sid": sid, "name": name, "status": status, "data": per_stock})
        print(f"[{i+1:2d}/{len(universe)}] {sid} {name:<8} {status}")

    ok = [s for s in summary if "✗" not in s["status"]]
    print(f"\n=== Summary ===")
    print(f"OK: {len(ok)} / {len(summary)}")
    for dataset, coll in DATASETS.items():
        total = sum(s["data"][dataset].get("total", 0) for s in ok if dataset in s["data"])
        print(f"  {dataset}: {total} rows in {coll}")
    if len(ok) < len(summary):
        print("Failed:")
        for s in summary:
            if "✗" in s["status"]:
                print(f"  {s['sid']} {s['name']}: {s['status']}")


if __name__ == "__main__":
    main()
