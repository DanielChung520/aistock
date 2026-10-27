"""台股帳務核心：成本、稅費、損益（純函式，無 I/O）。

費用規則由 :class:`FeeSchedule` 表達（券商折扣、最低手續費、稅別），不硬編碼常數；
成本法採移動平均（含買進費用）＝台股券商慣例。金額單位為新台幣、四捨五入至 2 位。
規格：`.docs/accounting/REQUIREMENTS.md` §7（費用）／§8（成本與調整）。
"""
from __future__ import annotations

from dataclasses import dataclass

BUY_FEE_RATE = 0.001425
SELL_FEE_RATE = 0.001425
SELL_TAX_RATE = 0.003
ETF_SELL_TAX_RATE = 0.001
DAY_TRADE_SELL_TAX_RATE = 0.0015
MIN_FEE = 20.0


@dataclass(frozen=True)
class FeeSchedule:
    """委託費用規則；預設＝現股牌價、無券商折扣、最低手續費 20 元。"""

    buy_fee_rate: float = BUY_FEE_RATE
    sell_fee_rate: float = SELL_FEE_RATE
    sell_tax_rate: float = SELL_TAX_RATE
    fee_discount: float = 1.0
    min_fee: float = MIN_FEE

    def buy_fee(self, gross: float) -> float:
        return _fee(gross, self.buy_fee_rate, self.fee_discount, self.min_fee)

    def sell_fee(self, gross: float) -> float:
        return _fee(gross, self.sell_fee_rate, self.fee_discount, self.min_fee)

    def sell_tax(self, gross: float) -> float:
        return _round(gross * self.sell_tax_rate)


STOCK = FeeSchedule()
ETF = FeeSchedule(sell_tax_rate=ETF_SELL_TAX_RATE)
DAY_TRADE = FeeSchedule(sell_tax_rate=DAY_TRADE_SELL_TAX_RATE)


def _round(value: float) -> float:
    return round(value, 2)


def _fee(gross: float, rate: float, discount: float, min_fee: float) -> float:
    if gross <= 0:
        return 0.0
    return _round(max(gross * rate * discount, min_fee))


@dataclass(frozen=True)
class Position:
    shares: int = 0
    avg_cost: float = 0.0

    @property
    def is_empty(self) -> bool:
        return self.shares == 0


EMPTY = Position()


@dataclass(frozen=True)
class BuyResult:
    position: Position
    gross: float
    fee: float
    cash_delta: float


@dataclass(frozen=True)
class SellResult:
    position: Position
    gross: float
    fee: float
    tax: float
    net: float
    realized_pnl: float
    pnl_pct: float


def apply_buy(position: Position, *, shares: int, gross: float, fee: float) -> Position:
    total_shares = position.shares + shares
    if total_shares <= 0:
        return EMPTY
    cost_basis = (position.shares * position.avg_cost + gross + fee) / total_shares
    return Position(shares=total_shares, avg_cost=cost_basis)


def apply_sell(position: Position, *, shares: int, net: float) -> tuple[Position, float]:
    realized_pnl = net - shares * position.avg_cost
    remaining = position.shares - shares
    return Position(
        shares=max(remaining, 0),
        avg_cost=position.avg_cost if remaining > 0 else 0.0,
    ), realized_pnl


def apply_dividend(position: Position, *, cash_per_share: float) -> tuple[Position, float]:
    return position, _round(position.shares * cash_per_share)


def apply_shares_delta(position: Position, *, delta: int) -> Position:
    new_shares = position.shares + delta
    if new_shares <= 0:
        return EMPTY
    total_cost = position.shares * position.avg_cost
    return Position(shares=new_shares, avg_cost=total_cost / new_shares)


def apply_rights(position: Position, *, stock_ratio: float) -> Position:
    return apply_shares_delta(position, delta=round(position.shares * stock_ratio))


def buy(position: Position, price: float, shares: int, schedule: FeeSchedule = STOCK) -> BuyResult:
    if price <= 0:
        raise ValueError("price must be positive")
    if shares <= 0:
        raise ValueError("shares must be positive")

    gross = _round(price * shares)
    fee = schedule.buy_fee(gross)
    return BuyResult(
        position=apply_buy(position, shares=shares, gross=gross, fee=fee),
        gross=gross,
        fee=fee,
        cash_delta=-_round(gross + fee),
    )


def sell(position: Position, price: float, shares: int, schedule: FeeSchedule = STOCK) -> SellResult:
    if price <= 0:
        raise ValueError("price must be positive")
    if shares <= 0:
        raise ValueError("shares must be positive")
    if shares > position.shares:
        raise ValueError(f"cannot sell {shares} of {position.shares} held shares")

    gross = _round(price * shares)
    fee = schedule.sell_fee(gross)
    tax = schedule.sell_tax(gross)
    net = _round(gross - fee - tax)
    cost_basis = position.avg_cost
    next_position, realized_pnl = apply_sell(position, shares=shares, net=net)
    net_per_share = net / shares
    pnl_pct = (net_per_share / cost_basis - 1) * 100 if cost_basis else 0.0
    return SellResult(
        position=next_position,
        gross=gross,
        fee=fee,
        tax=tax,
        net=net,
        realized_pnl=_round(realized_pnl),
        pnl_pct=pnl_pct,
    )


def market_value(position: Position, price: float) -> float:
    return _round(position.shares * price)


def unrealized_pnl(position: Position, price: float) -> tuple[float, float]:
    if position.shares == 0 or position.avg_cost == 0:
        return 0.0, 0.0
    value = market_value(position, price)
    cost = position.shares * position.avg_cost
    return _round(value - cost), (value / cost - 1) * 100
