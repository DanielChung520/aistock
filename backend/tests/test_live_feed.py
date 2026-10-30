from __future__ import annotations

from datetime import datetime

from src.realtime.live_feed import TW_TZ, aggregate_bars, is_tw_market_open


def _bar(date: str, o: float, h: float, low: float, c: float, v: int = 0) -> dict:
    return {"date": date, "open": o, "high": h, "low": low, "close": c, "volume": v}


def test_aggregate_1m_to_10m_buckets_aligned_to_open() -> None:
    bars = {
        "2026-10-28 09:00:00": _bar("2026-10-28 09:00:00", 100, 105, 99, 104, 10),
        "2026-10-28 09:01:00": _bar("2026-10-28 09:01:00", 104, 108, 103, 107, 20),
        "2026-10-28 09:09:00": _bar("2026-10-28 09:09:00", 107, 110, 106, 109, 5),
        "2026-10-28 09:10:00": _bar("2026-10-28 09:10:00", 109, 112, 108, 111, 7),
    }

    result = aggregate_bars(bars, 10)

    assert [bar["date"] for bar in result] == [
        "2026-10-28 09:00:00",
        "2026-10-28 09:10:00",
    ]
    first = result[0]
    assert first["open"] == 100
    assert first["high"] == 110
    assert first["low"] == 99
    assert first["close"] == 109
    assert first["volume"] == 35


def test_aggregate_floors_to_session_aligned_bucket_across_hours() -> None:
    bars = {
        "2026-10-28 10:07:00": _bar("2026-10-28 10:07:00", 1, 2, 1, 2, 1),
        "2026-10-28 10:00:00": _bar("2026-10-28 10:00:00", 1, 3, 1, 3, 1),
    }

    result = aggregate_bars(bars, 10)

    assert len(result) == 1
    assert result[0]["date"] == "2026-10-28 10:00:00"
    assert result[0]["high"] == 3


def test_aggregate_minutes_le_one_passes_through_sorted() -> None:
    bars = {
        "2026-10-28 09:01:00": _bar("2026-10-28 09:01:00", 1, 1, 1, 1),
        "2026-10-28 09:00:00": _bar("2026-10-28 09:00:00", 1, 1, 1, 1),
    }

    result = aggregate_bars(bars, 1)

    assert [bar["date"] for bar in result] == [
        "2026-10-28 09:00:00",
        "2026-10-28 09:01:00",
    ]


def test_is_tw_market_open_weekday_session_bounds() -> None:
    assert is_tw_market_open(datetime(2026, 10, 28, 9, 0, tzinfo=TW_TZ)) is True
    assert is_tw_market_open(datetime(2026, 10, 28, 13, 30, tzinfo=TW_TZ)) is True
    assert is_tw_market_open(datetime(2026, 10, 28, 8, 59, tzinfo=TW_TZ)) is False
    assert is_tw_market_open(datetime(2026, 10, 28, 13, 40, tzinfo=TW_TZ)) is False


def test_is_tw_market_open_weekend_closed() -> None:
    assert is_tw_market_open(datetime(2026, 10, 31, 10, 0, tzinfo=TW_TZ)) is False
    assert is_tw_market_open(datetime(2026, 11, 1, 10, 0, tzinfo=TW_TZ)) is False
