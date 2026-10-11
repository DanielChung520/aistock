"""Bar-replay style paper trading simulator for the Daniel MA strategy.

Unlike a plain backtest, this walks the calendar one day at a time: the user
"sees" bar T's close, a signal is generated from data up to and including T,
and any trade is executed at the NEXT bar's open (T+1) — mirroring TradingView
replay but without look-ahead, since the decision always uses data available
at the close of T.

Trade costs are included: buy fee 0.1425%, sell fee 0.1425% + 0.3% tax.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from src.data_fetcher import fetch_daily_history
from src.indicators import calculate_ma_daniel

BUY_FEE_RATE = 0.001425
SELL_FEE_RATE = 0.001425
SELL_TAX_RATE = 0.003
WARMUP_MONTHS = 5  # ~110 trading days, enough for MA89 (89 bars) warm-up


@dataclass
class SimState:
    """Mutable paper-trading state, advanced one day at a time."""

    day_index: int
    cash: float
    shares: int = 0
    entry_price: float = 0.0
    entry_index: int = -1
    avg_cost: float = 0.0
    pending_order: dict | None = None
    last_reject_reason: str | None = None
    trades: list[dict] = field(default_factory=list)
    total_fees: float = 0.0
    start_capital: float = 100_000.0


@dataclass
class SimContext:
    """Pre-loaded history + pre-computed signals for a stock."""

    stock_id: str
    dates: list[str]
    opens: list[float]
    highs: list[float]
    lows: list[float]
    closes: list[float]
    signals: list[dict]
    warmup_offset: int = 0  # bars prepended for MA warm-up (not part of the sim timeline)


def _fetch_context(stock_id: str, months: int, cooldown: int, buy_slope_min: float, sell_slope_max: float) -> SimContext:
    # Fetch ~100 extra trading days before the requested window so the Daniel
    # MA (MA89 needs ~89 bars) is fully warmed up when the sim starts. The
    # extra bars are prepended and excluded from the sim timeline via
    # warmup_offset.
    data = fetch_daily_history(stock_id, months=months + WARMUP_MONTHS)
    if not data:
        raise ValueError(f"no data for {stock_id}")

    dates = [str(item["date"]) for item in data]
    opens = [float(item.get("open") or item["close"]) for item in data]
    highs = [float(item["high"]) for item in data]
    lows = [float(item["low"]) for item in data]
    closes = [float(item["close"]) for item in data]
    volumes = [float(item.get("volume") or 0) for item in data]

    # Determine how many of the earliest bars fall before the requested window
    # start (months back from today) → those are warm-up bars only.
    from datetime import date, timedelta

    window_start = (date.today() - timedelta(days=months * 35)).isoformat()
    warmup_offset = 0
    for d in dates:
        if d < window_start:
            warmup_offset += 1
        else:
            break

    signals = calculate_ma_daniel(
        dates,
        highs,
        lows,
        closes,
        volumes,
        cooldown=cooldown,
        buy_slope_min=buy_slope_min,
        sell_slope_max=sell_slope_max,
    )
    return SimContext(
        stock_id=stock_id,
        dates=dates,
        opens=opens,
        highs=highs,
        lows=lows,
        closes=closes,
        signals=signals,
        warmup_offset=warmup_offset,
    )


def _buy(ctx: SimContext, state: SimState, idx: int, limit_price: float | None = None, lots: int | None = None) -> bool:
    """Execute a buy on bar idx. Returns False if the limit is not met.

    A limit buy fills as soon as the bar's low reaches the limit
    (`low <= limit`); if the whole bar trades below the limit the order is
    still filled, at the better of the open and the limit. The fill price is
    `min(open, limit)` for a limit order (a marketable limit fills at the
    open), otherwise the open. When `lots` is given (1 lot = 1000 shares) the
    order buys exactly that many lots; otherwise it invests the full cash
    balance. Adding to an existing position is allowed: shares accumulate and
    the average cost is a weighted average across the old and new lots (both
    including buy fees).
    """
    if limit_price is not None and ctx.lows[idx] > limit_price:
        state.last_reject_reason = (
            f"未到價：當日最低 {ctx.lows[idx]:.2f} 高於買價 {limit_price:.2f}"
        )
        return False
    price = min(ctx.opens[idx], limit_price) if limit_price is not None else ctx.opens[idx]
    if lots:
        shares = lots * 1000
    else:
        shares = int(state.cash / (price * (1 + BUY_FEE_RATE)))
    if shares <= 0:
        state.pending_order = None
        state.last_reject_reason = "資金不足以買入 1 股"
        return False
    cost = shares * price
    fee = cost * BUY_FEE_RATE
    if cost + fee > state.cash:
        # Insufficient cash for the requested lots — fall back to the maximum
        # affordable, or reject if even one share cannot be bought.
        shares = int(state.cash / (price * (1 + BUY_FEE_RATE)))
        if shares <= 0:
            state.pending_order = None
            state.last_reject_reason = f"資金不足：買 {lots or 1} 張需 ${cost + fee:,.0f}，僅有 ${state.cash:,.0f}"
            return False
        cost = shares * price
        fee = cost * BUY_FEE_RATE
    state.cash -= cost + fee
    prev_shares = state.shares
    prev_avg = state.avg_cost if state.avg_cost else state.entry_price
    # Weighted average cost across existing + newly bought shares.
    if prev_shares > 0:
        total_shares = prev_shares + shares
        state.avg_cost = (prev_shares * prev_avg + cost + fee) / total_shares
        state.shares = total_shares
    else:
        state.avg_cost = (cost + fee) / shares
        state.shares = shares
    state.entry_price = price
    state.entry_index = idx
    state.total_fees += fee
    state.pending_order = None
    state.trades.append(
        {
            "date": ctx.dates[idx],
            "action": "buy",
            "price": round(price, 2),
            "shares": shares,
            "fee": round(fee, 2),
            "cash_after": round(state.cash, 2),
            "limit_price": round(limit_price, 2) if limit_price is not None else None,
            "avg_cost": round(state.avg_cost, 2),
        }
    )
    return True


def _sell(ctx: SimContext, state: SimState, idx: int, reason: str = "signal", limit_price: float | None = None, lots: int | None = None) -> bool:
    """Execute a sell on bar idx. Returns False if the limit is not met.

    A limit sell fills as soon as the bar's high reaches the limit
    (`high >= limit`); if the whole bar trades above the limit the order is
    still filled, at the better of the open and the limit. The fill price is
    `max(open, limit)` for a limit order (a marketable limit fills at the
    open), otherwise the open. When `lots` is given only that many lots are
    sold; otherwise the whole position is closed.
    """
    if limit_price is not None and ctx.highs[idx] < limit_price:
        state.last_reject_reason = (
            f"未到價：當日最高 {ctx.highs[idx]:.2f} 低於賣價 {limit_price:.2f}"
        )
        return False
    price = max(ctx.opens[idx], limit_price) if limit_price is not None else ctx.opens[idx]
    sell_shares = min(lots * 1000, state.shares) if lots else state.shares
    gross = sell_shares * price
    fee = gross * SELL_FEE_RATE
    tax = gross * SELL_TAX_RATE
    net = gross - fee - tax
    state.cash += net
    state.total_fees += fee + tax
    cost_basis = state.avg_cost if state.avg_cost else state.entry_price
    pnl = net - sell_shares * cost_basis
    # Return % vs the position's average cost (incl. buy fee), net of sell costs.
    net_per_share = net / sell_shares
    pnl_pct = (net_per_share / cost_basis - 1) * 100 if cost_basis else 0.0
    state.trades.append(
        {
            "date": ctx.dates[idx],
            "action": "sell",
            "price": round(price, 2),
            "shares": sell_shares,
            "fee": round(fee + tax, 2),
            "cash_after": round(state.cash, 2),
            "pnl": round(pnl, 2),
            "pnl_pct": round(pnl_pct, 2),
            "reason": reason,
            "limit_price": round(limit_price, 2) if limit_price is not None else None,
            "avg_cost": round(cost_basis, 2),
        }
    )
    if sell_shares >= state.shares:
        state.shares = 0
        state.entry_price = 0.0
        state.entry_index = -1
        state.avg_cost = 0.0
    else:
        state.shares -= sell_shares
    state.pending_order = None
    return True


def init_simulation(
    stock_id: str,
    months: int = 24,
    cooldown: int = 1,
    buy_slope_min: float = 0.05,
    sell_slope_max: float = 0.02,
    initial_capital: float = 100_000,
) -> tuple[SimContext, SimState]:
    """Load history and initialise the simulation at the first bar."""
    ctx = _fetch_context(stock_id, months, cooldown, buy_slope_min, sell_slope_max)
    state = SimState(day_index=0, cash=initial_capital, start_capital=initial_capital)
    return ctx, state


def advance(
    ctx: SimContext,
    state: SimState,
    steps: int = 1,
    manual_order: dict | None = None,
    stop_on_signal: bool = False,
) -> list[dict]:
    """Advance the simulation `steps` bars. Returns a log of day outcomes.

    On each bar T (0-based index i):
    1. If a pending order exists for this bar, execute it at the open.
    2. Emit the day snapshot: signals seen at T's close + AI advice input.
    3. If `manual_order` is given ({action: buy|sell, reason?}), it becomes
       the pending order for bar T+1. Otherwise no order is scheduled —
       signals are informational only (shown via chart markers / AI advice)
       and the user must explicitly place an order via the UI to trade.

    With `stop_on_signal=True` the loop halts after the first bar whose close
    produces a buy/sell signal (the auto-follow "find the next decision day"
    behaviour), so the caller can step to it in one call and place a manual
    order.
    """
    log: list[dict] = []
    for _ in range(steps):
        i = state.day_index
        if i >= len(ctx.dates):
            break

        day: dict = {"date": ctx.dates[i], "open": ctx.opens[i], "high": ctx.highs[i], "low": ctx.lows[i], "close": ctx.closes[i]}

        if state.pending_order and state.pending_order.get("date") == ctx.dates[i]:
            action = state.pending_order["action"]
            limit = state.pending_order.get("limit_price")
            lots = state.pending_order.get("lots")
            if action == "buy":
                executed = _buy(ctx, state, i, limit_price=limit, lots=lots)
                day["order_executed"] = "buy" if executed else "rejected"
            else:
                executed = _sell(
                    ctx,
                    state,
                    i,
                    reason=state.pending_order.get("reason", "manual"),
                    limit_price=limit,
                    lots=lots,
                )
                day["order_executed"] = "sell" if executed else "rejected"
            if not executed:
                # Limit never traded or funds insufficient — order expires.
                day["rejected"] = True
                day["rejected_reason"] = state.last_reject_reason or "無法成交"
                state.pending_order = None
                state.last_reject_reason = None
        else:
            day["order_executed"] = None

        sig = ctx.signals[i]
        day["signal"] = {
            "buy": bool(sig.get("buy")),
            "sell": bool(sig.get("sell")),
            "slope8": sig.get("slope8"),
            "slope21": sig.get("slope21"),
            "trend": sig.get("trend"),
            "volume_distance": sig.get("volume_distance"),
            "close_offset": sig.get("close_offset"),
        }
        day["position"] = {
            "shares": state.shares,
            "entry_price": state.entry_price,
        }
        day["cash"] = round(state.cash, 2)

        # Signals are informational only. A pending order for T+1 is created
        # solely when the caller supplies a `manual_order` (i.e. the user
        # explicitly placed an order via the UI). Auto-trading on signals
        # is intentionally not supported — the chart markers and AI advice
        # surface the signal so the user can decide.
        if manual_order:
            state.pending_order = {
                "action": manual_order["action"],
                "date": ctx.dates[i + 1] if i + 1 < len(ctx.dates) else None,
                "reason": "manual",
                "limit_price": manual_order.get("limit_price"),
                "lots": manual_order.get("lots"),
            }
        else:
            state.pending_order = None
        day["next_order"] = state.pending_order

        # Portfolio value at this bar's close (mark to market).
        value = state.cash + state.shares * ctx.closes[i]
        day["equity"] = round(value, 2)
        day["equity_pct"] = round(value / state.start_capital * 100, 2)

        log.append(day)
        state.day_index += 1

        if stop_on_signal and (day["signal"]["buy"] or day["signal"]["sell"]):
            break

    return log
