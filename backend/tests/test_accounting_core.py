"""Unit tests for src.accounting.core — pure money math, no I/O.

Covers spec `.docs/accounting/REQUIREMENTS.md`:
- §7 fee schedule: discount, minimum fee, per-tax-variant rates (stock/ETF/day-trade)
- §8 moving-average cost basis: buy incl. fee, weighted average on add, partial
  sell keeps avg cost, full sell empties the position
- realized / unrealized pnl and validation errors
"""
from __future__ import annotations

import pytest

from src.accounting.core import (
    DAY_TRADE,
    ETF,
    STOCK,
    FeeSchedule,
    Position,
    buy,
    market_value,
    sell,
    unrealized_pnl,
)


def test_buy_first_position_includes_fee_in_cost():
    result = buy(Position(), 100.0, 1000)
    assert result.position.shares == 1000
    assert result.fee == 142.5
    assert result.cash_delta == -100142.5
    assert result.position.avg_cost == pytest.approx(100142.5 / 1000)


def test_buy_add_is_weighted_average():
    first = buy(Position(), 100.0, 1000).position
    second = buy(first, 110.0, 1000)
    assert second.position.shares == 2000
    assert second.position.avg_cost == pytest.approx((100142.5 + 110156.75) / 2000)


def test_sell_realizes_pnl_and_empties_position():
    held = buy(Position(), 100.0, 1000).position
    result = sell(held, 120.0, 1000)
    assert result.position.is_empty
    assert result.gross == 120000.0
    assert result.fee == 171.0
    assert result.tax == 360.0
    assert result.net == 119469.0
    assert result.realized_pnl == pytest.approx(119469.0 - 1000 * held.avg_cost)


def test_partial_sell_keeps_avg_cost():
    held = buy(Position(), 100.0, 1000).position
    result = sell(held, 120.0, 400)
    assert result.position.shares == 600
    assert result.position.avg_cost == pytest.approx(held.avg_cost)


def test_sell_tax_variants():
    held = Position(shares=1000, avg_cost=100.0)
    assert sell(held, 100.0, 1000, STOCK).tax == 300.0
    assert sell(held, 100.0, 1000, ETF).tax == 100.0
    assert sell(held, 100.0, 1000, DAY_TRADE).tax == 150.0


def test_min_fee_applies_on_small_order():
    result = buy(Position(), 10.0, 100)
    assert result.fee == 20.0


def test_fee_discount_applied_when_above_min():
    discounted = FeeSchedule(fee_discount=0.6)
    result = buy(Position(), 100.0, 1000, discounted)
    assert result.fee == pytest.approx(85.5)


def test_pnl_pct_is_net_of_costs():
    held = buy(Position(), 100.0, 1000).position
    result = sell(held, 110.0, 1000)
    assert result.pnl_pct == pytest.approx((result.net / 1000 / held.avg_cost - 1) * 100)


def test_unrealized_pnl_and_market_value():
    held = buy(Position(), 100.0, 1000).position
    assert market_value(held, 120.0) == 120000.0
    amount, pct = unrealized_pnl(held, 120.0)
    assert amount == pytest.approx(120000.0 - 1000 * held.avg_cost)
    assert pct == pytest.approx((120.0 / held.avg_cost - 1) * 100)


def test_unrealized_pnl_empty_is_zero():
    assert unrealized_pnl(Position(), 120.0) == (0.0, 0.0)


@pytest.mark.parametrize(("price", "shares"), [(0, 100), (-1, 100), (100, 0), (100, -5)])
def test_buy_rejects_invalid_input(price, shares):
    with pytest.raises(ValueError):
        buy(Position(), price, shares)


@pytest.mark.parametrize(("price", "shares"), [(0, 100), (-1, 100), (100, 0), (100, -5)])
def test_sell_rejects_invalid_input(price, shares):
    with pytest.raises(ValueError):
        sell(Position(shares=100, avg_cost=10.0), price, shares)


def test_sell_rejects_oversell():
    with pytest.raises(ValueError):
        sell(Position(shares=100, avg_cost=10.0), 10.0, 101)
