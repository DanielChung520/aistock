"""Unit tests for bar-list merge ordering (pure, no I/O).

Regression: `fetch_daily_history` / `fetch_minute_history` appended freshly
fetched yfinance rows onto the cached (already-sorted) rows without re-sorting.
A real early bar (e.g. 2007-12-31) landing after recent rows produced an
out-of-order payload, and lightweight-charts' `setData` — which asserts strictly
ascending time — threw and blanked the chart. `_merge_sorted` must guarantee an
ascending, de-duplicated result.
"""
from __future__ import annotations

from src.data_fetcher import _merge_sorted


def _times(rows: list[dict], key: str) -> list[str]:
    return [r[key] for r in rows]


def test_appended_older_row_is_reordered_to_front() -> None:
    cached = [
        {"date": "2026-10-06", "close": 1.0},
        {"date": "2026-10-07", "close": 2.0},
    ]
    incoming = [
        {"date": "2007-12-31", "close": 3.0},
        {"date": "2026-10-08", "close": 4.0},
    ]

    out = _merge_sorted(cached, incoming, "date")
    times = _times(out, "date")

    assert times == sorted(times)
    assert times[0] == "2007-12-31"
    assert times[-1] == "2026-10-08"
    assert len(out) == 4


def test_duplicate_keys_are_dropped() -> None:
    cached = [{"date": "2026-10-07", "close": 1.0}]
    incoming = [
        {"date": "2026-10-07", "close": 9.0},
        {"date": "2026-10-08", "close": 2.0},
        {"date": "2026-10-08", "close": 3.0},
    ]

    out = _merge_sorted(cached, incoming, "date")

    assert _times(out, "date") == ["2026-10-07", "2026-10-08"]
    assert out[0]["close"] == 1.0


def test_empty_inputs() -> None:
    assert _merge_sorted([], [], "date") == []
    out = _merge_sorted([], [{"date": "2026-01-02"}, {"date": "2026-01-01"}], "date")
    assert _times(out, "date") == ["2026-01-01", "2026-01-02"]


def test_minute_datetime_keys_sort_ascending() -> None:
    cached = [{"datetime": "2026-10-07 09:00:00", "close": 1.0}]
    incoming = [
        {"datetime": "2026-10-07 09:05:00", "close": 2.0},
        {"datetime": "2026-10-07 08:55:00", "close": 3.0},
    ]

    out = _merge_sorted(cached, incoming, "datetime")
    times = _times(out, "datetime")

    assert times == sorted(times)
    assert times == [
        "2026-10-07 08:55:00",
        "2026-10-07 09:00:00",
        "2026-10-07 09:05:00",
    ]
