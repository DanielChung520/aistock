"""Celery task: TX 每日盤後增量更新。

流程：
1. 用 Shioaji 抓最近 7 個交易日的 1 分 K（涵蓋週末 / 假日）
2. 聚合成 15 分 K
3. 寫入 `tx_futures_bars` collection（冪等 upsert）

設計考量：
- 只在**盤後**執行（cron 14:30 Asia/Taipei，避開 Shioaji 流量限制）
- 不抓即時資料（G3 守則：避免 polling）
- 即時資料未來用 SSE push（見 `tx_data_stream.py`，尚未實作）

合約覆蓋：
- TXFR1（近月連續月）— 主要寫入
- TXFR2（次月連續月）— 備援寫入
- 原始合約（TXF202509 等）— 透過 Shioaji 的 `Contracts.Futures.TXF` 動態取得
"""
from __future__ import annotations

import logging
import time
from datetime import UTC, date, datetime, timedelta
from typing import Any

from src.celery_app import celery_app
from src.data.tx_aggregator import aggregate, expand_to_continuous
from src.data.tx_fetcher import FetchError, ShioajiFetcher, get_fetcher
from src.db import get_db
from src.tasks.tx_data_backfill import (
    DEFAULT_CONTRACT_MAP,
    TX_BARS_COLLECTION,
    _ensure_collection_with_indexes,
    _upsert_bars,
)

logger = logging.getLogger(__name__)

# 預設抓取近 7 天（含週末，確保覆蓋跨日）
DAILY_LOOKBACK_DAYS = 7

# 主要關注的連續月合約
PRIMARY_CONTINUOUS = ["TXFR1", "TXFR2"]


def _date_range(start: date, end: date) -> list[str]:
    """產生 [start, end] 區間的所有日期字串（含週末與假日，由 Shioaji 過濾）。"""
    days = []
    cur = start
    while cur <= end:
        days.append(cur.isoformat())
        cur += timedelta(days=1)
    return days


def _build_continuous_map(fetcher: ShioajiFetcher) -> dict[str, str]:
    """從 Shioaji 動態建立 contract → continuous 對照表。

    R1 = 當下近月合約
    R2 = 當下次月合約
    """
    try:
        contracts = list(fetcher._api.Contracts.Futures.TXF)  # type: ignore[attr-defined]
    except Exception as exc:
        logger.warning("無法讀取 TXF 合約清單: %s", exc)
        return DEFAULT_CONTRACT_MAP.copy()

    # 按 delivery_month 排序
    sorted_contracts = sorted(contracts, key=lambda c: c.delivery_month)
    continuous_map: dict[str, str] = {}
    if len(sorted_contracts) >= 1:
        continuous_map[sorted_contracts[0].code] = "R1"
    if len(sorted_contracts) >= 2:
        continuous_map[sorted_contracts[1].code] = "R2"
    logger.info("建立 continuous map: %s", continuous_map)
    return continuous_map


def _fetch_one_contract(
    fetcher: ShioajiFetcher,
    contract: str,
    start: str,
    end: str,
) -> list[dict]:
    """抓單一合約的 1 分 K，失敗時回傳空清單（不中斷整體）。"""
    try:
        return fetcher.fetch_kbars(contract=contract, start=start, end=end)
    except FetchError as exc:
        logger.warning("跳過 %s: %s", contract, exc)
        return []


@celery_app.task(bind=True, name="src.tasks.tx_data_daily.tx_data_daily_task")
def tx_data_daily_task(
    self,
    config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """每日盤後增量更新。

    config schema:
      {
        "lookback_days": 7,             # 抓近幾天
        "contracts": ["TXFR1", "TXFR2"],  # 要抓的合約
        "bar_minutes": [1, 15],         # 寫入的粒度
      }
    """
    config = config or {}
    lookback_days = int(config.get("lookback_days", DAILY_LOOKBACK_DAYS))
    contracts = config.get("contracts", PRIMARY_CONTINUOUS)
    bar_minutes_list = config.get("bar_minutes", [1, 15])

    end_d = datetime.now(tz=UTC).date()
    start_d = end_d - timedelta(days=lookback_days)
    start_str = start_d.isoformat()
    end_str = end_d.isoformat()

    _ensure_collection_with_indexes()
    fetcher = get_fetcher("shioaji")
    if not isinstance(fetcher, ShioajiFetcher):
        return {
            "ok": False,
            "error": "ShioajiFetcher 不可用（請確認 SHIOAJI_API_KEY/SECRET_KEY 已設定，且 shioaji 套件已安裝）",
        }

    # 動態建立 continuous map
    continuous_map = _build_continuous_map(fetcher)

    # 對每個合約抓資料
    all_written: dict[str, int] = {}
    for contract in contracts:
        logger.info("抓取 %s %s ~ %s", contract, start_str, end_str)
        raw = _fetch_one_contract(fetcher, contract, start_str, end_str)
        if not raw:
            all_written[contract] = 0
            continue

        # 標記 continuous
        raw = expand_to_continuous(raw, {contract: continuous_map.get(contract, "R1")})

        for bar_minutes in bar_minutes_list:
            if bar_minutes == 1:
                to_write = raw
            else:
                to_write = aggregate(raw, minutes=bar_minutes, contract=contract)
                # aggregate 不會自動帶 continuous，需補上
                for r in to_write:
                    r["continuous"] = continuous_map.get(contract)

            written = _upsert_bars(to_write, bar_minutes=bar_minutes)
            all_written[f"{contract}_{bar_minutes}m"] = written
            logger.info("%s %dm: %d 筆", contract, bar_minutes, written)

    return {
        "ok": True,
        "started_at": int(time.time()),
        "finished_at": int(time.time()),
        "range": {"start": start_str, "end": end_str},
        "continuous_map": continuous_map,
        "written": all_written,
    }


@celery_app.task(bind=True, name="src.tasks.tx_data_daily.tx_data_status_task")
def tx_data_status_task(self) -> dict[str, Any]:
    """回報目前 tx_futures_bars collection 狀態。

    給 API endpoint 與排程監控用。
    """
    db = get_db()
    if not db.has_collection(TX_BARS_COLLECTION):
        return {"exists": False}

    col = db.collection(TX_BARS_COLLECTION)
    total = col.count()

    # 依 bar_minutes 分組統計
    cursor = db.aql.execute(
        f"""
        FOR d IN {TX_BARS_COLLECTION}
          COLLECT bm = d.bar_minutes, cont = d.continuous
          AGGREGATE cnt = COUNT(d), first_date = MIN(d.date), last_date = MAX(d.date)
          RETURN {{ bar_minutes: bm, continuous: cont, count: cnt, first_date: first_date, last_date: last_date }}
        """
    )
    breakdown = list(cursor)

    return {
        "exists": True,
        "total": total,
        "breakdown": breakdown,
        "as_of": int(time.time()),
    }
