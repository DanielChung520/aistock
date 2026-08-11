#!/usr/bin/env python3
"""
重算 research universe 的 stock_daily_features（方案A 落地後一次性遞迴）。

背景：遷移後 stock_daily 已是唯一 OHLCV 來源（含 O1/C1）。舊特徵由
stock_daily_o1c1 生成，close 與 stock_daily 不一致（§6.1 違反）。此腳本以
「前端 feature-settings-modal DEFAULT_FEATURES 相同設定」重算所有
universe 股票 [start, end] 窗的特徵並覆寫。

用法（backend root）：
  .venv/bin/python scripts/recompute_research_features.py
"""
import json
import sys
import time
from datetime import date, timedelta
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from src.tasks.feature_generate import generate_features  # noqa: E402

UNIVERSE_PATH = BACKEND_ROOT.parent / "frontend/src/lib/data/research-universe-ai-memory-passive.json"
START_DATE = "2024-08-01"
END_DATE = "2026-08-07"

# === 對齊 frontend/src/components/feature-settings-modal.tsx DEFAULT_FEATURES ===
DEFAULT_FEATURES = [
    {"key": "pct", "enabled": True, "params": {}},
    {"key": "slope", "enabled": True, "params": {"MA 週期": "8,13,21", "MV 週期": "5,10"}},
    {"key": "o1c1", "enabled": True, "params": {}},
    {"key": "rsi", "enabled": True, "params": {"週期": "14", "超買線": "70", "超賣線": "30"}},
    {"key": "kdj", "enabled": True, "params": {"週期": "9", "K 平滑": "3", "D 平滑": "3"}},
    {"key": "macd", "enabled": True, "params": {"快": "12", "慢": "26", "訊號": "9"}},
    {"key": "divergence", "enabled": True, "params": {"MA 週期": "8,13,21"}},
    {"key": "three", "enabled": True, "params": {}},
    {"key": "candle", "enabled": True, "params": {}},
    {"key": "master", "enabled": True, "params": {}},
    {"key": "bollinger", "enabled": False, "params": {"週期": "20", "標準差": "2"}},
]


def main() -> None:
    stocks = json.load(open(UNIVERSE_PATH))["stocks"]
    stock_ids = [s["stock_id"] for s in stocks]
    features_config = {f["key"]: {"enabled": f["enabled"], "params": f["params"]} for f in DEFAULT_FEATURES}
    print(f"universe: {len(stock_ids)} stocks, window {START_DATE}..{END_DATE}")

    total = 0
    t0 = time.time()
    for i, sid in enumerate(stock_ids, 1):
        summary = generate_features(
            stock_id=sid,
            start_date=START_DATE,
            end_date=END_DATE,
            features_config=features_config,
        )
        ok = summary.get("ok")
        written = summary.get("rows_written", 0)
        err = summary.get("error")
        total += written
        status = f"ok={ok} rows={written}" + (f" err={err}" if err else "")
        print(f"[{i}/{len(stock_ids)}] {sid}: {status}")
    print(f"done: {total} rows in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()