"""Unit tests for src.features_ext — the extended indicator feature groups.

Covers the v2 全指標引擎 wiring: trend family (4-period + slope/slope2 +
spreads + alignment), oscillator family (pos/slope/cross), volatility family
(ratio/slope/pos), event family (cnt10), bollinger squeeze, and the
index-feature merge helpers in src.tasks.feature_generate.

All expectations verified against the current implementations before writing.
"""
from __future__ import annotations

import numpy as np
import pytest

from src.features_ext import (
    ALL_EXT_GROUPS,
    compute_features_ext,
)
from src.tasks.feature_generate import (
    _compute_index_features,
    _merge_index_into_rows,
)


def _rising_rows(n: int = 120, start: float = 100.0, step: float = 1.0) -> list[dict]:
    """Strictly increasing OHLCV — all trend MAs stack short>long."""
    rows = []
    for i in range(n):
        close = start + i * step
        rows.append({
            "date": f"2024-{(i // 28) + 1:02d}-{(i % 28) + 1:02d}",
            "open": close - 0.5, "high": close + 1.0, "low": close - 1.0,
            "close": close, "volume": 1000.0,
        })
    return rows


def _all_enabled() -> dict:
    return {g: {"enabled": True} for g in ALL_EXT_GROUPS}


class TestComputeFeaturesExt:
    def test_output_length_equals_input(self):
        rows = _rising_rows(50)
        out = compute_features_ext(rows, {})
        assert len(out) == len(rows)

    def test_all_groups_disabled_yields_none(self):
        rows = _rising_rows(50)
        out = compute_features_ext(rows, {})
        assert all(v is None for v in out[-1].values())
        assert len(out[-1]) > 300  # disabled groups still declare their keys

    def test_trend_group_values_and_alignment(self):
        rows = _rising_rows(120)
        cfg = {"ema": {"enabled": True}}
        out = compute_features_ext(rows, cfg)
        last = out[-1]
        # rising series → all 4 EMA periods positive, short above long
        assert last["ema8"] > last["ema13"] > last["ema21"] > last["ema34"]
        assert last["ema_slope_8"] > 0
        assert last["ema_slope2_8"] is not None  # 二次斜率存在（線性序列收斂→可負）
        # 6 pairwise spreads all positive → 0b111111 = 63
        assert last["ema_alignment_state"] == 63
        # warmup: early rows None, not 0
        assert out[5]["ema34"] is None

    def test_oscillator_cross_signal(self):
        rows = _rising_rows(120)
        cfg = {"roc": {"enabled": True}}
        out = compute_features_ext(rows, cfg)
        # strictly rising → roc > 0 after warmup
        assert out[-1]["roc"] > 0
        assert out[-1]["roc_cross_up"] in (0, 1)
        assert out[-1]["roc_slope"] is not None

    def test_stochrsi_columns(self):
        rows = _rising_rows(120)
        cfg = {"stochrsi": {"enabled": True}}
        out = compute_features_ext(rows, cfg)
        last = out[-1]
        for key in ("stochrsi_k", "stochrsi_d", "stochrsi_pos", "stochrsi_golden", "stochrsi_dead"):
            assert key in last
        assert 0 <= last["stochrsi_k"] <= 100

    def test_volatility_ratio(self):
        rows = _rising_rows(120)
        cfg = {"atr": {"enabled": True}}
        out = compute_features_ext(rows, cfg)
        # ATR / close should be a small positive fraction
        assert out[-1]["atr"] > 0
        assert 0 < out[-1]["atr_ratio"] < 1

    def test_event_group_flags(self):
        rows = _rising_rows(120)
        cfg = {"new_high_n": {"enabled": True}}
        out = compute_features_ext(rows, cfg)
        # strictly rising → most recent closes are new 20-day highs
        assert out[-1]["new_high_n"] == 1
        assert out[-1]["new_high_n_cnt10"] >= 1

    def test_bollinger_squeeze_columns(self):
        rows = _rising_rows(120)
        cfg = {"bollinger_squeeze": {"enabled": True}}
        out = compute_features_ext(rows, cfg)
        last = out[-1]
        assert last["bb_width"] > 0  # band width positive after warmup
        assert last["bb_squeeze"] in (0, 1, None)
        assert "bb_squeeze_break_up" in last

    def test_partial_config_disabled_groups_none(self):
        rows = _rising_rows(50)
        cfg = {"ema": {"enabled": True}}
        out = compute_features_ext(rows, cfg)
        last = out[-1]
        assert last["ema8"] is not None
        assert last["wma8"] is None  # wma disabled
        assert last["cci"] is None
        assert last["bb_width"] is None

    def test_unparseable_rows_kept_aligned(self):
        rows = _rising_rows(40)
        rows[20] = {"date": "x", "open": "bad", "high": "bad", "low": "bad", "close": "bad", "volume": "bad"}
        out = compute_features_ext(rows, _all_enabled())
        assert len(out) == 40
        assert all(v is None for v in out[20].values())
        assert out[39]["ema8"] is not None  # later valid rows still computed
        assert out[19]["ema8"] is not None  # earlier valid rows too


class TestIndexFeatureMerge:
    def _idx(self) -> dict:
        return _compute_index_features([
            {"symbol": "TWII", "date": "2024-01-02", "close": 100.0},
            {"symbol": "TWII", "date": "2024-01-03", "close": 102.0},
            {"symbol": "TWII", "date": "2024-01-05", "close": 103.0},
        ])

    def test_compute_index_features_shapes(self):
        per = self._idx()
        assert set(per) == {"TWII"}
        d = per["TWII"]["2024-01-03"]
        assert d["idx_TWII_pct"] == 2.0  # 102/100-1 ×100
        assert d["idx_TWII_ma5"] is None  # warmup
        assert d["idx_TWII_ma20"] is None

    def test_merge_ffills_last_known_value(self):
        per = self._idx()
        rows = [{"date": "2024-01-04", "close": 50.0}, {"date": "2024-01-06", "close": 51.0}]
        _merge_index_into_rows(rows, per)
        # 01-04: TWII last known ≤ 01-04 is 01-03 → pct 2.0
        assert rows[0]["idx_TWII_pct"] == 2.0
        # 01-06: last known ≤ 01-06 is 01-05 → pct (103/102-1)×100
        assert rows[1]["idx_TWII_pct"] == pytest.approx(0.9804, rel=1e-3)

    def test_merge_no_lookahead_before_first_index_date(self):
        per = self._idx()
        rows = [{"date": "2024-01-01", "close": 50.0}]
        _merge_index_into_rows(rows, per)
        assert "idx_TWII_pct" not in rows[0]  # no index value on or before this date

    def test_merge_empty_indices_noop(self):
        rows = [{"date": "2024-01-04", "close": 50.0}]
        _merge_index_into_rows(rows, {})
        assert "idx_TWII_pct" not in rows[0]