"""Celery task: generate stock_daily_features for a research-universe stock.

Given a stock + date range + feature config (from the 特徵值設置 modal), reads
daily OHLCV + O1/C1 from ``stock_daily`` (single yfinance source, 方案A),
computes the ~60-column feature vector per spec ``.docs/charact.md`` via
``src.features.compute_features`` (no fetching — pure read/compute/write),
and upserts one doc per date into ``stock_daily_features`` keyed
``{stock_id}_{date}`` (overwrite=True).

The compute window is widened by 400 days before the requested start date so
long-warmup indicators (MA200 / 52-week highs / 250-day percentiles) are
meaningful, but only dates within [start_date, end_date] are written.
"""
from __future__ import annotations

import functools
import hashlib
import json
import logging
import time
import traceback
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any

from src.celery_app import celery_app
from src.db import ensure_collection, get_db

logger = logging.getLogger(__name__)

FEATURES_COLLECTION = "stock_daily_features"
JOBS_COLLECTION = "feature_jobs"
WARMUP_DAYS = 400  # extra read window for MA200 / 52w / 250d percentile


def _now_ts() -> int:
    return int(datetime.now(timezone.utc).timestamp())


def _features_config_hash(config: dict, indices: list[str] | None = None) -> str:
    """Canonical hash of the feature config + enabled indices — ties each row
    to its producer (spec: 重訓可重現). Changing either yields a new hash.
    """
    payload = json.dumps(
        {"features": config or {}, "indices": sorted(indices or [])},
        sort_keys=True,
        ensure_ascii=False,
    )
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


def _load_index_rows(indices: list[str], start: str, end: str) -> list[dict]:
    """Load index daily closes for the enabled symbols in [start, end]."""
    if not indices:
        return []
    db = get_db()
    cursor = db.aql.execute(
        """
        FOR d IN market_index_daily
        FILTER d.symbol IN @syms AND d.date >= @start AND d.date <= @end
        SORT d.symbol, d.date ASC
        RETURN {symbol: d.symbol, date: d.date, close: d.close}
        """,
        bind_vars={"syms": indices, "start": start, "end": end},
    )
    return [dict(r) for r in cursor]


def _sma_series(values: list[float], period: int) -> list[float | None]:
    out: list[float | None] = [None] * len(values)
    for i in range(len(values)):
        if i + 1 >= period:
            out[i] = sum(values[i + 1 - period : i + 1]) / period
    return out


def _compute_index_features(index_rows: list[dict]) -> dict[str, dict[str, dict]]:
    """Compute per-symbol per-date index features.

    Returns {symbol: {date: {idx_{symbol}_pct, idx_{symbol}_ma5,
    idx_{symbol}_ma20, idx_{symbol}_slope20}}. Computed on each index's OWN
    trading calendar; merging into stock rows uses ffill (last known ≤ date),
    which for cross-market indices naturally picks the previous session —
    no lookahead.
    """
    from src.indicators import _slope_series

    per_symbol: dict[str, dict[str, list]] = {}
    for row in index_rows:
        per_symbol.setdefault(row["symbol"], {"dates": [], "closes": []})
        per_symbol[row["symbol"]]["dates"].append(str(row["date"]))
        per_symbol[row["symbol"]]["closes"].append(float(row["close"]))

    out: dict[str, dict[str, dict]] = {}
    for symbol, series in per_symbol.items():
        dates, closes = series["dates"], series["closes"]
        ma5 = _sma_series(closes, 5)
        ma20 = _sma_series(closes, 20)
        slope20 = _slope_series(ma20)
        prev = None
        by_date: dict[str, dict] = {}
        for i, d in enumerate(dates):
            c = closes[i]
            pct = (c / prev - 1) * 100 if prev else None
            prev = c
            by_date[d] = {
                f"idx_{symbol}_pct": round(pct, 4) if pct is not None else None,
                f"idx_{symbol}_ma5": round(c / ma5[i] - 1, 4) if ma5[i] else None,
                f"idx_{symbol}_ma20": round(c / ma20[i] - 1, 4) if ma20[i] else None,
                f"idx_{symbol}_slope20": round(slope20[i], 4) if slope20[i] is not None else None,
            }
        out[symbol] = by_date
    return out


def _merge_index_into_rows(rows: list[dict], per_symbol: dict[str, dict[str, dict]]) -> None:
    """In-place merge of index features into stock rows (ffill by date ≤ row date)."""
    if not per_symbol:
        return
    import bisect

    lookups: dict[str, tuple[list, list]] = {}
    for symbol, by_date in per_symbol.items():
        items = sorted((d, v) for d, v in by_date.items() if v is not None)
        if items:
            lookups[symbol] = ([d for d, _ in items], [v for _, v in items])
    for row in rows:
        d = str(row.get("date", ""))
        for symbol, (dates, vals) in lookups.items():
            idx = bisect.bisect_right(dates, d) - 1
            if idx >= 0:
                row.update(vals[idx])


def _load_daily_rows(stock_id: str, start: str, end: str) -> list[dict]:
    """Read OHLCV + O1/C1 from stock_daily in [start, end], date ASC."""
    db = get_db()
    cursor = db.aql.execute(
        """
        FOR d IN stock_daily
        FILTER d.stock_id == @sid AND d.date >= @start AND d.date <= @end
        SORT d.date ASC
        RETURN {
            date: d.date, open: d.open, high: d.high, low: d.low,
            close: d.close, volume: d.volume, o1: d.o1, c1: d.c1
        }
        """,
        bind_vars={"sid": stock_id, "start": start, "end": end},
    )
    return [dict(r) for r in cursor]


def _write_features(
    stock_id: str, feature_rows: list[dict], start: str, end: str, config_hash: str
) -> int:
    """Upsert one doc per date within [start, end]; returns rows written.

    Each doc carries the generating config's hash for training-time
    provenance checks.
    """
    from arango.exceptions import ArangoError

    col = get_db().collection(FEATURES_COLLECTION)
    written = 0
    for row in feature_rows:
        dstr = str(row.get("date", ""))
        if not (start <= dstr <= end):
            continue
        doc = {
            "_key": f"{stock_id}_{dstr}",
            "stock_id": stock_id,
            "feature_config_hash": config_hash,
            **row,
        }
        try:
            col.insert(doc, overwrite=True)
            written += 1
        except ArangoError as exc:
            logger.error("upsert %s_%s failed: %s", stock_id, dstr, exc)
    return written


def _update_job(job_id: str, summary: dict, total: int) -> None:
    """Atomically fold one stock's result into the shared feature_jobs doc.

    Increments rows_written / stocks_done; when stocks_done == total the job
    is marked completed (or failed if any stock errored) with finished_at.

    Retries on write conflicts: many workers UPSERT the same job doc
    concurrently, and ArangoDB raises write-write conflict / lock timeout
    under contention. A brief retry loop makes the increment eventually
    consistent.
    """
    from arango.exceptions import ArangoError

    db = get_db()
    ok = bool(summary.get("ok"))
    for attempt in range(8):
        try:
            db.aql.execute(
                """
                UPSERT { _key: @job_id }
                INSERT {
                    _key: @job_id, job_id: @job_id, status: "running", rows_written: 0,
                    stocks_done: 0, stocks_total: @total, created_at: @now,
                    finished_at: null, error: null, feature_config_hash: @config_hash
                }
                UPDATE {
                    rows_written: OLD.rows_written + @written,
                    stocks_done: OLD.stocks_done + 1,
                    error: @has_error ? (OLD.error != null ? OLD.error : @err) : OLD.error,
                    feature_config_hash: @config_hash,
                    status:
                        OLD.stocks_done + 1 >= @total
                            ? (@has_error ? "failed" : "completed")
                            : OLD.status,
                    finished_at:
                        OLD.stocks_done + 1 >= @total ? @now : OLD.finished_at
                }
                IN feature_jobs
                """,
                bind_vars={
                    "job_id": job_id,
                    "total": total,
                    "written": int(summary.get("rows_written", 0)),
                    "has_error": not ok,
                    "err": str(summary.get("error", "生成失敗")),
                    "now": _now_ts(),
                    "config_hash": str(summary.get("feature_config_hash") or ""),
                },
            )
            return
        except ArangoError:
            if attempt == 4:
                raise
            time.sleep(0.2 * (attempt + 1))


@functools.lru_cache(maxsize=8)
def _cached_index_features(tuple_indices: tuple[str, ...], start: str, end: str) -> dict:
    """Index features cached per (indices, window) so N tasks share one compute."""
    return _compute_index_features(_load_index_rows(list(tuple_indices), start, end))


@celery_app.task
def generate_features(
    stock_id: str,
    start_date: str,
    end_date: str,
    features_config: dict,
    job_id: str | None = None,
    stocks_total: int = 1,
    indices: list[str] | None = None,
) -> dict:
    """Celery task: compute + store one stock's feature vectors for [start, end]."""
    ensure_collection(FEATURES_COLLECTION)
    summary: dict[str, Any] = {
        "job_id": job_id,
        "stock_id": stock_id,
        "range": {"start": start_date, "end": end_date},
        "ok": False,
        "rows_written": 0,
    }
    try:
        window_start = (date.fromisoformat(start_date) - timedelta(days=WARMUP_DAYS)).isoformat()
        rows = _load_daily_rows(stock_id, window_start, end_date)
        if not rows:
            logger.warning(
                "generate_features %s: no data in window %s..%s", stock_id, window_start, end_date
            )
            summary["error"] = f"無 {window_start}..{end_date} 的日線資料"
            return summary

        from src.features import compute_features
        from src.features_ext import compute_features_ext
        from src.ml_training import compute_target_columns

        import pandas as pd

        config_hash = _features_config_hash(features_config or {}, indices)
        base_rows = compute_features(rows, features_config or {})
        ext_rows = compute_features_ext(rows, features_config or {})
        feature_rows = [
            {**base, **ext}
            for base, ext in zip(base_rows, ext_rows)
        ]
        # 目標值隨特徵一併生成（per-stock shift，最後 1~5 天為 null）
        target_df = pd.DataFrame(rows)
        target_df["stock_id"] = stock_id
        targets = compute_target_columns(target_df)
        target_cols = targets[["next_return", "next_5d_return", "next_direction", "next_5d_direction"]]
        feature_rows = [
            {**fr, "next_return": tc[0], "next_5d_return": tc[1],
             "next_direction": tc[2], "next_5d_direction": tc[3]}
            for fr, tc in zip(feature_rows, target_cols.itertuples(index=False, name=None))
        ]
        idx_features = _cached_index_features(tuple(sorted(indices or [])), window_start, end_date)
        _merge_index_into_rows(feature_rows, idx_features)
        written = _write_features(stock_id, feature_rows, start_date, end_date, config_hash)
        summary["rows_written"] = written
        summary["feature_config_hash"] = config_hash
        summary["ok"] = True
        logger.info(
            "generate_features %s: computed %d rows (%d cols), wrote %d",
            stock_id, len(feature_rows), len(feature_rows[0]) if feature_rows else 0, written,
        )
    except Exception as exc:
        logger.error("generate_features %s failed: %s\n%s", stock_id, exc, traceback.format_exc())
        summary["error"] = str(exc)
    finally:
        if job_id:
            try:
                _update_job(job_id, summary, max(stocks_total, 1))
            except Exception as exc:
                logger.error("generate_features %s: job update failed: %s", stock_id, exc)
    return summary


@celery_app.task
def generate_features_batch(
    stock_ids: list[str],
    start_date: str,
    end_date: str,
    features_config: dict,
    indices: list[str] | None = None,
) -> dict:
    """Batch entry: create a job doc, fan out one generate_features per stock."""
    ensure_collection(JOBS_COLLECTION)
    job_id = uuid.uuid4().hex
    total = len(stock_ids)
    job_doc = {
        "_key": job_id,
        "job_id": job_id,
        "status": "running",
        "stocks_total": total,
        "stocks_done": 0,
        "rows_written": 0,
        "created_at": _now_ts(),
        "finished_at": None,
        "error": None,
    }
    get_db().collection(JOBS_COLLECTION).insert(job_doc, overwrite=True)

    for sid in stock_ids:
        generate_features.delay(
            stock_id=sid,
            start_date=start_date,
            end_date=end_date,
            features_config=features_config,
            job_id=job_id,
            stocks_total=total,
            indices=indices,
        )
    logger.info("generate_features_batch %s: enqueued %d stock(s)", job_id, len(stock_ids))
    return {"status": "triggered", "job_id": job_id, "enqueued": len(stock_ids)}
