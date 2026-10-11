"""Unit tests for src.features — pure feature computation, no I/O.

Covers spec `.docs/charact.md` output rules (verified against the current
implementation before writing):
- index alignment: output length == input rows length
- missing/warmup values are None, never 0
- disabled group → every key None for every row
- unparseable OHLCV rows keep raw fields + all feature keys None
- specific feature semantics: pct_change, 三盤突破, 酒田 doji, MA alignment
  state (perfect 多頭 = 7), Bollinger ordering
"""
from __future__ import annotations

from src.features import compute_features

_ALL_GROUPS = ("pct", "slope", "rsi", "kdj", "macd", "divergence", "three", "candle", "master", "bollinger")


# ── Helpers ──────────────────────────────────────────────────────────────────


def _bar(i: int, close: float, *, open_: float | None = None, high: float | None = None,
         low: float | None = None, volume: float = 1000.0) -> dict:
    """One OHLCV row; open/high/low default around the close."""
    open_ = close - 0.5 if open_ is None else open_
    high = close + 1.0 if high is None else high
    low = close - 1.0 if low is None else low
    return {
        "date": f"2024-01-{i + 1:02d}",
        "open": open_, "high": high, "low": low, "close": close, "volume": volume,
    }


def _rising_rows(n: int = 30, start: float = 100.0, step: float = 1.0) -> list[dict]:
    """Strictly increasing closes — MAs stack short>mid>long after warmup."""
    return [_bar(i, start + i * step) for i in range(n)]


def _all_feature_keys(output_row: dict) -> list[str]:
    """Every output key minus the raw OHLCV/date fields."""
    raw = {"date", "open", "high", "low", "close", "volume", "o1", "c1"}
    return [k for k in output_row if k not in raw]


# ── compute_features ─────────────────────────────────────────────────────────


class TestComputeFeatures:
    def test_empty_rows(self):
        assert compute_features([], {}) == []

    def test_output_length_equals_input(self):
        rows = _rising_rows(10)
        out = compute_features(rows, {})
        assert len(out) == len(rows)
        assert all(r["date"] == rows[i]["date"] for i, r in enumerate(out))

    def test_all_groups_disabled_yields_none_features(self):
        rows = _rising_rows(10)
        out = compute_features(rows, {})  # empty config → nothing enabled
        last = out[-1]
        # raw fields preserved
        assert last["close"] == rows[-1]["close"]
        assert last["volume"] == rows[-1]["volume"]
        # every feature key present and None
        keys = _all_feature_keys(last)
        assert len(keys) > 50  # the ~60-column feature vector
        assert all(last[k] is None for k in keys)

    def test_partial_config_disabled_groups_are_none(self):
        rows = _rising_rows(10)
        out = compute_features(rows, {"pct": {"enabled": True}})
        last = out[-1]
        assert last["pct_change"] is not None  # pct enabled
        assert last["rsi"] is None  # rsi disabled
        assert last["kdj_k"] is None
        assert last["macd_dif"] is None
        assert last["bollinger_upper"] is None

    def test_pct_change_values(self):
        rows = [_bar(0, 10.0), _bar(1, 11.0), _bar(2, 12.0)]
        out = compute_features(rows, {"pct": {"enabled": True}})
        # row 0: no previous bar → None
        assert out[0]["pct_change"] is None
        assert out[0]["pct_change_2d"] is None
        assert out[0]["up_2d"] is None
        # row 1: 1-day change only
        assert out[1]["pct_change"] == 10.0
        assert out[1]["pct_change_2d"] is None
        # row 2: 1-day + 2-day + consecutive-up flag
        assert out[2]["pct_change"] == 9.0909  # (12−11)/11×100, round 4
        assert out[2]["pct_change_2d"] == 20.0  # (12−10)/10×100
        assert out[2]["up_2d"] == 1

    def test_three_up_breakout(self):
        rows = [
            _bar(0, 9.0, open_=9.0, high=10.0, low=8.0),
            _bar(1, 9.0, open_=9.0, high=10.0, low=8.0),
            _bar(2, 9.0, open_=9.0, high=10.0, low=8.0),
            _bar(3, 10.5, open_=10.0, high=11.0, low=9.0, volume=1500.0),
        ]
        out = compute_features(rows, {"three": {"enabled": True}})
        # first two rows: warmup → all None
        assert out[0]["three_up"] is None
        assert out[1]["three_up"] is None
        # row 2: 9.0 ≤ max(high1, high0)=10 → no breakout
        assert out[2]["three_up"] == 0
        assert out[2]["three_state"] == 0
        # row 3: 10.5 > max(high2, high1)=10 → breakout with volume confirmation
        assert out[3]["three_up"] == 1
        assert out[3]["three_up_str"] == 5.0  # (10.5/10−1)×100
        assert out[3]["three_up_vol"] == 1  # volume 1500 > both previous
        assert out[3]["three_state"] == 1

    def test_doji_candle(self):
        rows = [_bar(0, 10.0, open_=10.0, high=10.1, low=9.9)]
        out = compute_features(rows, {"candle": {"enabled": True}})
        # body=0 ≤ range 0.2 × 0.1 → doji
        assert out[0]["candle_doji"] == 1
        # long bodies / multi-bar patterns unavailable on row 0
        assert out[0]["candle_long_body_up"] is None
        assert out[0]["candle_morning_star"] is None

    def test_warmup_values_are_none_not_zero(self):
        rows = _rising_rows(30)
        out = compute_features(rows, {"rsi": {"enabled": True, "params": {"週期": "14"}}})
        # RSI warmup: first rows None
        assert out[0]["rsi"] is None
        assert out[5]["rsi"] is None
        # after warmup: numeric
        assert out[-1]["rsi"] is not None

    def test_unparseable_row_keeps_alignment(self):
        rows = _rising_rows(5)
        rows[2] = {"date": "2024-01-03", "open": "bad", "high": "bad",
                   "low": "bad", "close": "bad", "volume": "bad"}
        out = compute_features(rows, {"pct": {"enabled": True}})
        assert len(out) == 5
        # invalid row: raw fields coerced to None, all features None
        assert out[2]["close"] is None
        assert all(out[2][k] is None for k in _all_feature_keys(out[2]))
        # other rows still computed correctly (index alignment preserved)
        assert out[3]["pct_change"] is not None
        assert out[4]["pct_change"] is not None

    def test_alignment_state_perfect_bullish_is_7(self):
        rows = _rising_rows(40)  # strictly increasing
        out = compute_features(
            rows, {"divergence": {"enabled": True, "params": {"MA 週期": "8,13,21"}}}
        )
        # after MA21 warmup (i≥20), short>mid>long → 3 pairs all positive → 0b111
        assert out[25]["alignment_state"] == 7
        assert out[25]["alignment_score"] is not None
        assert out[25]["alignment_score"] > 0
        # before warmup the state is unavailable (None), not 0
        assert out[5]["alignment_state"] is None

    def test_bollinger_ordering_after_warmup(self):
        rows = _rising_rows(30)
        out = compute_features(
            rows, {"bollinger": {"enabled": True, "params": {"週期": "20", "標準差": "2"}}}
        )
        assert out[25]["bollinger_upper"] > out[25]["bollinger_middle"] > out[25]["bollinger_lower"]
        assert out[0]["bollinger_upper"] is None  # warmup

    def test_slope_keys_present(self):
        rows = _rising_rows(30)
        out = compute_features(
            rows, {"slope": {"enabled": True, "params": {"MA 週期": "8,13", "MV 週期": "5"}}}
        )
        last = out[-1]
        for key in ("slope_ma8", "slope2_ma8", "slope_ma13", "slope_mv5", "slope2_mv5"):
            assert key in last
        # rising series → positive MA slope after warmup
        assert last["slope_ma8"] > 0