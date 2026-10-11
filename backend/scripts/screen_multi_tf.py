#!/usr/bin/env python3
"""多時框條件選股查詢 CLI（6 組條件 / 13 條 DSL：日K + 週K + 15分K）。

Usage:
  python scripts/screen_multi_tf.py                    # 掃描全市場，依通過數/評分排序
  python scripts/screen_multi_tf.py --update           # 先更新日K+15m 再查詢
  python scripts/screen_multi_tf.py --update-daily     # 只更新日K
  python scripts/screen_multi_tf.py --update-15m       # 只更新 15m
  python scripts/screen_multi_tf.py --min-pass 13 --limit 0
  python scripts/screen_multi_tf.py --conditions cond.json   # 自訂條件檔 (JSON list)
  python scripts/screen_multi_tf.py --json out.json
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
import unicodedata
from collections import Counter
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import pandas as pd
import twstock
import yfinance as yf

from download_15m import _yf_suffix
from src.data_fetcher import _parse_yfinance_index, _store_daily
from src.db import get_db
from src.strategy import evaluate_stock

ACCEPTANCE_CONDITIONS: list[dict] = [
    {"metric": "ma8", "op": ">", "value": "ma21", "tf": "w"},
    {"metric": "ma21", "op": ">", "value": "ma55", "tf": "w"},
    {"metric": "slope55", "op": ">", "value": 0},
    {"metric": "price", "op": ">", "value": "ma55"},
    {"metric": "ma8", "op": ">", "value": "ma21", "tf": "15m"},
    {"metric": "ma21", "op": ">", "value": "ma55", "tf": "15m"},
    {"metric": "slope8", "op": ">", "value": 0, "tf": "15m"},
    {"metric": "slope21", "op": ">", "value": 0, "tf": "15m"},
    {"metric": "slope55", "op": ">", "value": 0, "tf": "15m"},
    {"metric": "price", "op": ">=", "value": "max_high_2d"},
    {"metric": "slope5", "op": ">", "value": 0},
    {"metric": "price", "op": ">=", "value": "ma8"},
    {"metric": "slope8", "op": ">", "value": 0},
]


def _market_label(stock_id: str) -> str:
    info = twstock.codes.get(stock_id)
    if info is None:
        return "—"
    if info.type == "ETF":
        return f"{info.market}ETF"
    if info.type == "股票":
        return info.market
    if "TDR" in info.type:
        return "上市TDR"
    return info.market


def _update_daily(db, ids: list[str]) -> tuple[int, int]:
    today = date.today()
    rows = db.aql.execute(
        """
        FOR d IN stock_daily
          FILTER d.stock_id IN @ids
          COLLECT stock_id = d.stock_id AGGREGATE last = MAX(d.date)
          RETURN { stock_id, last }
        """,
        bind_vars={"ids": ids},
    )
    latest = {str(r["stock_id"]): str(r["last"] or "") for r in rows}
    today_s = today.isoformat()
    stale = [sid for sid in ids if latest.get(sid, "") < today_s]
    if not stale:
        print("[日K] 全部已是最新")
        return 0, 0

    start = (today - timedelta(days=10)).isoformat()
    end = (today + timedelta(days=1)).isoformat()
    batch_size = 20
    written = 0
    failed: list[str] = []
    n_batches = (len(stale) + batch_size - 1) // batch_size
    for i in range(0, len(stale), batch_size):
        chunk = stale[i : i + batch_size]
        tickers = [f"{sid}{_yf_suffix(sid)}" for sid in chunk]
        batch_no = i // batch_size + 1
        try:
            data = yf.download(
                " ".join(tickers),
                start=start,
                end=end,
                interval="1d",
                auto_adjust=False,
                progress=False,
                threads=True,
            )
        except Exception as exc:
            failed.extend(chunk)
            print(f"[日K] batch {batch_no}/{n_batches} download failed: {exc}", file=sys.stderr)
            continue
        if data is None or data.empty:
            failed.extend(chunk)
            continue
        for sid, ticker in zip(chunk, tickers):
            try:
                frame = (
                    data.xs(ticker, level="Ticker", axis=1)
                    if isinstance(data.columns, pd.MultiIndex)
                    else data
                )
            except KeyError:
                failed.append(sid)
                continue
            records = []
            for dt, row in frame.iterrows():
                close_val = float(row["Close"])
                if close_val != close_val:
                    continue
                dstr = _parse_yfinance_index(dt)
                if dstr <= latest.get(sid, ""):
                    continue
                vol = row["Volume"]
                records.append(
                    {
                        "date": dstr,
                        "open": round(float(row["Open"]), 2),
                        "high": round(float(row["High"]), 2),
                        "low": round(float(row["Low"]), 2),
                        "close": round(close_val, 2),
                        "volume": int(vol) if vol == vol else 0,
                    }
                )
            if records:
                _store_daily(sid, records)
                written += len(records)
        print(f"[日K] batch {batch_no}/{n_batches} ({len(stale)} 檔待更新)")
        time.sleep(0.5)
    print(f"[日K] 完成: stale={len(stale)} new_rows={written} failed={len(failed)}")
    if failed:
        print(f"[日K] failed: {','.join(failed[:20])}", file=sys.stderr)
    return len(stale), written


def _update_15m() -> None:
    script = Path(__file__).resolve().parent / "download_15m.py"
    proc = subprocess.run([sys.executable, str(script)], check=False)
    if proc.returncode != 0:
        print(f"[15m] download_15m.py exited {proc.returncode}", file=sys.stderr)


def _disp_width(s: str) -> int:
    return sum(2 if unicodedata.east_asian_width(ch) in "WF" else 1 for ch in s)


def _pad(s: str, width: int) -> str:
    return s + " " * max(0, width - _disp_width(s))


def _screen(conds: list[dict], ids: list[str], names: dict[str, str]) -> tuple[list[dict], int]:
    rows: list[dict] = []
    skipped = 0
    errors: list[str] = []
    for sid in ids:
        try:
            result = evaluate_stock(sid, conds)
        except Exception as exc:
            skipped += 1
            errors.append(f"{sid}: {exc}")
            continue
        if result is None:
            skipped += 1
            continue
        rows.append(
            {
                "market": _market_label(sid),
                "stock_id": sid,
                "name": names.get(sid, ""),
                "price": result["price"],
                "date": result["date"],
                "passed": result["passed_count"],
                "total": result["total_conditions"],
                "score": result["score"],
            }
        )
    rows.sort(key=lambda r: (-r["passed"], -r["score"]))
    for err in errors[:5]:
        print(f"evaluate error: {err}", file=sys.stderr)
    return rows, skipped


def _print_table(rows: list[dict], limit: int) -> None:
    shown = rows if limit <= 0 else rows[:limit]
    headers = ["市場別", "股票代號", "名稱", "最新價格", "通過評分"]
    table: list[list[str]] = []
    for r in shown:
        price = f"{r['price']:,.2f}" if isinstance(r["price"], (int, float)) else "-"
        table.append(
            [
                r["market"],
                r["stock_id"],
                r["name"],
                price,
                f"{r['passed']}/{r['total']} · {r['score']:,.1f}",
            ]
        )
    widths = [
        max(_disp_width(headers[i]), *(_disp_width(row[i]) for row in table)) if table else _disp_width(headers[i])
        for i in range(len(headers))
    ]
    line = "  ".join(_pad(h, widths[i]) for i, h in enumerate(headers))
    print(line)
    print("-" * _disp_width(line))
    for row in table:
        print("  ".join(_pad(cell, widths[i]) for i, cell in enumerate(row)))


def main() -> None:
    parser = argparse.ArgumentParser(description="多時框條件選股查詢（日K+週K+15分K）")
    parser.add_argument("--update", action="store_true", help="先更新日K 與 15m 資料再查詢")
    parser.add_argument("--update-daily", action="store_true", help="只更新日K")
    parser.add_argument("--update-15m", action="store_true", help="只更新 15m")
    parser.add_argument("--min-pass", type=int, default=0, help="只顯示通過數 >= N 的股票")
    parser.add_argument("--limit", type=int, default=50, help="顯示前 N 檔（0 = 不限）")
    parser.add_argument("--scope", type=str, default="all", help="all / watchlist（預設 all）")
    parser.add_argument("--conditions", type=str, default=None, help="自訂條件 JSON 檔")
    parser.add_argument("--json", dest="json_out", type=str, default=None, help="結果輸出 JSON 檔")
    args = parser.parse_args()

    if args.conditions:
        conds = json.loads(Path(args.conditions).read_text(encoding="utf-8"))
    else:
        conds = [dict(c) for c in ACCEPTANCE_CONDITIONS]

    db = get_db()
    if args.scope == "watchlist":
        ids = [str(x) for x in db.aql.execute("FOR w IN watchlist RETURN w.stock_id")]
    else:
        ids = [str(x) for x in db.aql.execute("FOR s IN stock_codes SORT s.stock_id ASC RETURN s.stock_id")]
    names = {
        str(r["stock_id"]): str(r.get("name") or "")
        for r in db.aql.execute("FOR s IN stock_codes RETURN { stock_id: s.stock_id, name: s.name }")
    }
    print(f"條件 {len(conds)} 條 | 股票 {len(ids)} 檔 | scope={args.scope}")

    if args.update or args.update_daily:
        _update_daily(db, ids)
    if args.update or args.update_15m:
        _update_15m()

    t0 = time.time()
    rows, skipped = _screen(conds, ids, names)
    elapsed = time.time() - t0

    if args.min_pass > 0:
        rows = [r for r in rows if r["passed"] >= args.min_pass]

    full = sum(1 for r in rows if r["passed"] == r["total"] and r["total"] > 0)
    _print_table(rows, args.limit)
    date_dist = Counter(r["date"] for r in rows)
    top_dates = ", ".join(f"{d}: {n} 檔" for d, n in date_dist.most_common(3))
    print(
        f"\n掃描 {len(rows) + skipped} 檔 (跳過 {skipped}) | 全通過 {full} 檔 | "
        f"耗時 {elapsed:.1f}s | 資料日: {top_dates}"
    )

    if args.json_out:
        Path(args.json_out).write_text(
            json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"已輸出 {args.json_out}")


if __name__ == "__main__":
    main()
