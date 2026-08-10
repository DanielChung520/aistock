"""Shape-similarity engine — find stocks whose close series resembles a
user-selected chart pattern.

Approach:
- Take the pattern's close series (the bars selected on a chart).
- Optionally anchor each stock's data window to `end_date` so the
  comparison is time-aligned with the pattern (default behaviour when
  `end_date` is None is to use each stock's most recent bars).
- Normalise both to a comparable form (z-score or %-change), then
  measure distance with the configured metric (Euclidean now, DTW later).
- Rank by similarity score 1/(1+d).
"""
from __future__ import annotations

import logging

import numpy as np

from src.db import get_db

logger = logging.getLogger(__name__)

_LOAD_DAYS = 320  # cap: window is bounded by params (<=200) but keep headroom


def _normalise(series: np.ndarray, mode: str) -> np.ndarray:
    arr = np.asarray(series, dtype=float)
    if mode == "pct":
        base = arr[0]
        if base == 0 or not np.isfinite(base):
            return np.zeros_like(arr)
        return arr / base - 1.0
    # zscore
    mean = arr.mean()
    std = arr.std()
    if std == 0 or not np.isfinite(std):
        return np.zeros_like(arr)
    return (arr - mean) / std


def _euclidean(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.sqrt(np.sum((a - b) ** 2)))


def _trend(series: np.ndarray) -> str:
    """Classify a series direction: up/down/range by first-to-last change."""
    if len(series) < 2:
        return "range"
    chg = series[-1] - series[0]
    span = float(np.max(np.abs(series))) + 1e-9
    rel = abs(chg) / span
    if rel < 0.05:
        return "range"
    return "up" if chg > 0 else "down"


def search_universe(pattern: dict, params: dict | None = None) -> list[dict]:
    """Scan all stocks with enough daily bars and rank by similarity.

    Score = 1 / (1 + RMSE) where RMSE = euclidean / sqrt(window). Normalising
    by sqrt(window) keeps the score comparable across different window sizes
    (raw euclidean distance grows with the series length, which would make a
    fixed threshold unreachable for long windows).

    `params` overrides the pattern's stored params when given (used by the
    search endpoint to thread the per-request end_date override).
    """
    bars: list[float] = pattern.get("bars") or []
    base_params: dict = pattern.get("params") or {}
    effective_params: dict = dict(base_params)
    if params:
        for k, v in params.items():
            if v is not None:
                effective_params[k] = v
    params = effective_params

    window = int(params.get("window") or len(bars))
    if window < 5:
        window = len(bars)
    window = min(window, 200)

    mode = params.get("normalize", "zscore")
    trend_filter = params.get("trend_filter", "none")
    threshold = float(params.get("threshold", 0.7))
    limit = int(params.get("limit", 30))

    end_date: str | None = (
        params.get("end_date")
        if params.get("end_date") is not None
        else pattern.get("end_date")
    )

    target = _normalise(np.asarray(bars[-window:], dtype=float), mode)
    target_trend = _trend(target)

    db = get_db()
    codes = db.aql.execute("FOR s IN stock_codes RETURN { stock_id: s.stock_id, name: s.name }")
    stock_rows = list(codes)
    stock_ids = [str(r["stock_id"]) for r in stock_rows]
    name_map = {str(r["stock_id"]): r.get("name") for r in stock_rows}

    # Per-stock subquery uses the (stock_id, date) index: seek each stock's
    # bucket, sort desc, LIMIT window. When end_date is set, anchor the
    # window to end at that date (time-aligned with the pattern).
    aql = """
    FOR s IN stock_codes
      FILTER s.stock_id IN @ids
      LET closes = (
        FOR d IN stock_daily
          FILTER d.stock_id == s.stock_id
          FILTER d.date <= @end_date
          SORT d.date DESC
          LIMIT @window
          RETURN d.close
      )
      FILTER LENGTH(closes) >= @window
      RETURN { stock_id: s.stock_id, closes }
    """
    rows: dict[str, np.ndarray] = {}
    effective_end_date = end_date or "9999-12-31"
    for start in range(0, len(stock_ids), 500):
        chunk = stock_ids[start : start + 500]
        cursor = db.aql.execute(
            aql,
            bind_vars={"ids": chunk, "window": window, "end_date": effective_end_date},
            batch_size=500,
        )
        for item in cursor:
            closes = [float(c) for c in item["closes"] if c is not None]
            if len(closes) >= window:
                rows[str(item["stock_id"])] = np.asarray(closes[:window], dtype=float)

    results: list[dict] = []
    for sid, series in rows.items():
        norm = _normalise(series, mode)
        if trend_filter != "none" and _trend(norm) != target_trend:
            continue
        dist = _euclidean(norm, target) / np.sqrt(window)
        score = 1.0 / (1.0 + dist)
        if score >= threshold:
            results.append(
                {
                    "stock_id": sid,
                    "name": name_map.get(sid),
                    "similarity": round(score, 4),
                    "distance": round(dist, 4),
                }
            )

    results.sort(key=lambda x: x["similarity"], reverse=True)
    return results[:limit]
