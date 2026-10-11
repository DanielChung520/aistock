"""Celery task: TX (台指期) 歷史 K 線回填。

策略（依 TX-0011 §1.2）：
1. **歷史回填** (2006 ~ 2024-05)：從 QuantPass 整理包 ZIP 匯入（免費）
2. **備援回填** (2011 ~ now)：從 FinMind sponsor 會員（付費，需啟用 FINMIND_API_TOKEN）
3. **每日增量**：走 `tx_data_daily.py`（Shioaji）

本 task 是冪等的：執行多次結果一致（用 `_key` upsert）。
"""
from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Any

from src.celery_app import celery_app
from src.data.tx_aggregator import aggregate
from src.data.tx_fetcher import FetchError, QuantPassFetcher, get_fetcher
from src.db import ensure_collection, get_db

logger = logging.getLogger(__name__)

TX_BARS_COLLECTION = "tx_futures_bars"

# 連續月合約歸屬規則（簡化版，會在 daily 任務中動態更新）
# 真正的合約 → continuous 對照應該從 TAIFEX 月份資料計算
# 這裡先用硬編碼的常見映射，未來由排程自動更新
DEFAULT_CONTRACT_MAP: dict[str, str] = {
    # 近月 / 次月 會隨時間變動，這裡只放示意
    # 實際使用時 daily task 會從 Shioaji contracts 動態建立
}


def _ensure_collection_with_indexes() -> None:
    """建立 tx_futures_bars collection + 必要 indexes。"""
    ensure_collection(TX_BARS_COLLECTION)
    db = get_db()
    col = db.collection(TX_BARS_COLLECTION)
    existing = {tuple(idx.get("fields", [])) for idx in col.indexes()}
    for fields in (
        ("continuous", "date"),
        ("contract", "date"),
        ("date",),
        ("bar_minutes", "continuous", "date"),
    ):
        if fields not in existing:
            try:
                col.add_index({"type": "hash", "fields": list(fields)})
            except Exception as exc:
                logger.warning("建立 index %s 失敗: %s", fields, exc)


def _upsert_bars(records: list[dict], bar_minutes: int) -> int:
    """把聚合後的 K 線寫入 ArangoDB（冪等：_key 唯一）。

    _key 格式：{continuous_or_contract}_{YYYYMMDD}_{HHMM}
    """
    if not records:
        return 0
    db = get_db()
    col = db.collection(TX_BARS_COLLECTION)

    written = 0
    for r in records:
        # 決定 _key：用 continuous（如果有）優先
        primary = r.get("continuous") or r.get("contract") or "TX"
        # 移除合約代號中的非法字元（_ 在 ArangoDB key 是合法的）
        key_id = f"{primary}_{r['date'].replace('-', '')}_{r['time'].replace(':', '')}"
        doc = {
            "_key": key_id,
            "contract": r.get("contract", ""),
            "continuous": r.get("continuous"),
            "futures_id": "TX",
            "date": r["date"],
            "time": r["time"],
            "session": r.get("session", "day"),
            "bar_minutes": bar_minutes,
            "open": float(r["open"]),
            "high": float(r["high"]),
            "low": float(r["low"]),
            "close": float(r["close"]),
            "volume": int(r.get("volume", 0)),
            "open_interest": int(r.get("open_interest", 0)) if r.get("open_interest") else None,
            "source": r.get("source", "unknown"),
            "created_at": int(time.time()),
            "updated_at": int(time.time()),
        }
        try:
            col.insert(doc, overwrite=True)
            written += 1
        except Exception as exc:
            # 單筆失敗不影響整體（記 warning）
            logger.warning("寫入 %s 失敗: %s", key_id, exc)
    return written


# ── Backfill sub-tasks ───────────────────────────────────────────────────

def backfill_quantpass(years: list[int]) -> dict[str, Any]:
    """從 QuantPass ZIP 匯入指定年度的 TX 1 分 K → 聚合為 15 分 K。

    Parameters
    ----------
    years : list of int
        要匯入的年度清單（例如 [2020, 2021, 2022, 2023, 2024]）

    Returns
    -------
    dict with keys: ok, source, years, written_1m, written_15m, error
    """
    try:
        fetcher = QuantPassFetcher()
    except Exception as exc:
        return {"ok": False, "error": f"QuantPassFetcher init 失敗: {exc}"}

    if not fetcher.is_available():
        return {
            "ok": False,
            "error": (
                f"QuantPass 整理包不可用：{Path(fetcher._zip_dir)}\n"
                "請至 https://quantpass.org/txf/ 下載 1 分 K 整理包並解壓至此目錄"
            ),
        }

    written_1m = 0
    written_15m = 0
    for year in years:
        start = f"{year}-01-01"
        end = f"{year}-12-31"
        try:
            raw = fetcher.fetch_kbars(contract="TXFR1", start=start, end=end)
        except FetchError as exc:
            logger.warning("QuantPass %d 跳過: %s", year, exc)
            continue

        if not raw:
            logger.info("QuantPass %d 無資料", year)
            continue

        # 寫入 1 分 K
        written_1m += _upsert_bars(raw, bar_minutes=1)

        # 聚合為 15 分 K
        agg_15m = aggregate(raw, minutes=15)
        written_15m += _upsert_bars(agg_15m, bar_minutes=15)

        logger.info("QuantPass %d: 1m=%d, 15m=%d", year, len(raw), len(agg_15m))

    return {
        "ok": True,
        "source": "quantpass",
        "years": years,
        "written_1m": written_1m,
        "written_15m": written_15m,
    }


def backfill_finmind(start: str, end: str) -> dict[str, Any]:
    """從 FinMind 拉 TX 日線（免費）→ 寫入 collection（不聚合，分 K 走 Shioaji）。

    主要用途：補齊 QuantPass 與 Shioaji 之間的空窗 / 交叉驗證。
    """
    fetcher = get_fetcher("finmind")
    if fetcher is None:
        return {"ok": False, "error": "FinMindFetcher 不可用"}

    try:
        records = fetcher.fetch_kbars(contract="TXFR1", start=start, end=end)
    except FetchError as exc:
        return {"ok": False, "error": f"FinMind fetch_kbars 失敗: {exc}"}

    if not records:
        return {"ok": True, "source": "finmind", "written": 0, "note": "no data"}

    # 日線只寫一份（bar_minutes=1440 代表日線）
    for r in records:
        r["bar_minutes"] = 1440  # 標記為日線
    written = _upsert_bars(records, bar_minutes=1440)
    return {"ok": True, "source": "finmind", "written": written}


# ── Main Celery entry ────────────────────────────────────────────────────

@celery_app.task(bind=True, name="src.tasks.tx_data_backfill.tx_data_backfill_task")
def tx_data_backfill_task(self, config: dict[str, Any] | None = None) -> dict[str, Any]:
    """歷史回填主入口。

    config schema:
      {
        "source": "quantpass" | "finmind" | "all",
        "years": [2020, 2021, 2022, 2023],  # quantpass 用
        "start": "2024-01-01",              # finmind 用
        "end": "2024-12-31",                # finmind 用
      }
    """
    config = config or {}
    source = config.get("source", "quantpass")
    _ensure_collection_with_indexes()

    results: dict[str, Any] = {"started_at": int(time.time()), "source": source}

    if source in ("quantpass", "all"):
        years = config.get("years", list(range(2006, 2025)))  # 預設 2006~2024
        results["quantpass"] = backfill_quantpass(years)

    if source in ("finmind", "all"):
        start = config.get("start", "2024-01-01")
        end = config.get("end", "2024-12-31")
        results["finmind"] = backfill_finmind(start, end)

    results["finished_at"] = int(time.time())
    logger.info("tx_data_backfill_task 完成: %s", results)
    return results
