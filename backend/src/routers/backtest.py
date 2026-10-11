"""Backtest API — run Daniel MA strategy simulations and suggest parameters."""
from __future__ import annotations

import statistics
from datetime import date

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from src.backtest import run_backtest
from src.data_fetcher import fetch_daily_history
from src.indicators import calculate_ma_daniel
from src.simulation import SimContext, SimState, advance, init_simulation
from src.ai_advice import generate_advice

router = APIRouter(prefix="/backtest", tags=["backtest"])


class BacktestRequest(BaseModel):
    stock_id: str = Field(..., min_length=4, max_length=4, description="台股代碼，如 2330")
    months: int = Field(default=24, ge=1, le=120, description="回測月份數")
    cooldown: int = Field(default=1, ge=0, le=50, description="訊號冷卻根數")
    buy_slope_min: float = Field(default=0.05, ge=0.0, le=10.0, description="買進斜率下限 %")
    sell_slope_max: float = Field(default=0.02, ge=0.0, le=10.0, description="賣出斜率上限 %")
    max_hold_bars: int = Field(default=0, ge=0, le=250, description="最大持股天數，0=不限")
    stop_loss_pct: float = Field(default=0.0, ge=0.0, le=50.0, description="停損百分比，0=不停損")
    initial_capital: float = Field(default=1_000_000, gt=0, description="初始資金")


@router.post("/run")
def backtest(req: BacktestRequest) -> dict:
    result = run_backtest(
        stock_id=req.stock_id,
        months=req.months,
        cooldown=req.cooldown,
        buy_slope_min=req.buy_slope_min,
        sell_slope_max=req.sell_slope_max,
        max_hold_bars=req.max_hold_bars,
        stop_loss_pct=req.stop_loss_pct,
        initial_capital=req.initial_capital,
    )
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "today": date.today().isoformat()}


@router.get("/suggest")
def suggest_params(
    stock_id: str,
    months: int = Query(default=24, ge=1, le=120),
) -> dict:
    """Suggest Daniel MA parameters tuned to the stock's price behaviour.

    Uses three observable properties of the recent history:
    - daily volatility (std of close-to-close % change): wider swings demand a
      wider stop-loss and a higher buy-slope threshold so noise does not
      trigger entries.
    - signal density (buy markers per month): frequent signals mean the
      cooldown should be raised to filter whipsaws.
    - trend strength (share of bars with MA8 above MA55): strong uptrends can
      ride without a max-hold cap; choppy markets get a holding limit.
    """
    data = fetch_daily_history(stock_id, months=months)
    if not data:
        raise HTTPException(status_code=404, detail="no data for stock")

    dates = [str(item["date"]) for item in data]
    highs = [float(item["high"]) for item in data]
    lows = [float(item["low"]) for item in data]
    closes = [float(item["close"]) for item in data]
    volumes = [float(item.get("volume") or 0) for item in data]

    # 1) Daily volatility (%)
    returns = [
        (closes[i] / closes[i - 1] - 1) * 100
        for i in range(1, len(closes))
        if closes[i - 1] > 0
    ]
    volatility = statistics.pstdev(returns) if len(returns) > 1 else 1.0

    # 2) Signal density from a baseline run (cooldown=0 → raw signal count)
    baseline = calculate_ma_daniel(dates, highs, lows, closes, volumes, cooldown=0)
    n_buy = sum(1 for s in baseline if s.get("buy"))
    months_span = max(len(dates) / 21, 1)
    buys_per_month = n_buy / months_span

    # 3) Trend strength: fraction of bars in MA8 > MA55 alignment
    n_uptrend = 0
    n_valid = 0
    for s in baseline:
        ma8 = s.get("ma8")
        ma55 = s.get("ma55")
        if ma8 is not None and ma55 is not None:
            n_valid += 1
            if ma8 >= ma55:
                n_uptrend += 1
    trend_share = n_uptrend / n_valid if n_valid > 0 else 0.5

    # 4) Rule-based suggestions
    if volatility >= 3.0:
        stop_loss = round(volatility * 3, 1)  # wide: noise-safe
        buy_slope = 0.08
    elif volatility >= 1.5:
        stop_loss = round(volatility * 2.5, 1)
        buy_slope = 0.06
    else:
        stop_loss = round(volatility * 2, 1)
        buy_slope = 0.05

    if buys_per_month >= 3:
        cooldown = 3
    elif buys_per_month >= 1.5:
        cooldown = 2
    else:
        cooldown = 1

    if trend_share >= 0.6:
        max_hold = 0  # let winners run in strong trends
        hold_reason = "多頭趨勢強 (MA8>MA55 佔比較高)，不需設持股上限，讓獲利奔馳"
    elif trend_share >= 0.4:
        max_hold = 30
        hold_reason = "趨勢中性，設 30 根持股上限控制回吐"
    else:
        max_hold = 15
        hold_reason = "空頭/盤整為主，縮短持股週期降低風險"

    sell_slope = 0.02

    reasons = [
        f"日均波動 {volatility:.2f}% → 停損設 {stop_loss}%（約 {round(volatility * 2, 1)}~{round(volatility * 3, 1)}% 防被雜訊掃出）",
        f"買進訊號密度 {buys_per_month:.1f} 個/月 → 訊號冷卻設 {cooldown} 根（過濾假突破）",
        f"MA8>MA55 佔比 {trend_share * 100:.0f}% → {hold_reason}",
    ]

    suggested = {
        "cooldown": cooldown,
        "buy_slope_min": buy_slope,
        "sell_slope_max": sell_slope,
        "max_hold_bars": max_hold,
        "stop_loss_pct": stop_loss,
    }

    # Validate the suggestion by running a backtest with it
    backtest_result = run_backtest(
        stock_id=stock_id,
        months=months,
        cooldown=cooldown,
        buy_slope_min=buy_slope,
        sell_slope_max=sell_slope,
        max_hold_bars=max_hold,
        stop_loss_pct=stop_loss,
    )

    return {
        "stock_id": stock_id,
        "months": months,
        "profile": {
            "volatility_pct": round(volatility, 2),
            "buys_per_month": round(buys_per_month, 1),
            "trend_share_pct": round(trend_share * 100, 0),
        },
        "suggested_params": suggested,
        "reasons": reasons,
        "expected_result": {
            "total_return_pct": backtest_result.get("total_return_pct"),
            "win_rate_pct": backtest_result.get("win_rate_pct"),
            "max_drawdown_pct": backtest_result.get("max_drawdown_pct"),
            "closed_trades": backtest_result.get("closed_trades"),
        },
    }


class SimInitRequest(BaseModel):
    stock_id: str = Field(..., min_length=4, max_length=4)
    months: int = Field(default=24, ge=1, le=120)
    cooldown: int = Field(default=1, ge=0, le=50)
    buy_slope_min: float = Field(default=0.05, ge=0.0, le=10.0)
    sell_slope_max: float = Field(default=0.02, ge=0.0, le=10.0)
    initial_capital: float = Field(default=1_000_000, gt=0)


class SimAdvanceRequest(BaseModel):
    stock_id: str = Field(..., min_length=4, max_length=4)
    months: int = Field(default=24, ge=1, le=120)
    cooldown: int = Field(default=1, ge=0, le=50)
    buy_slope_min: float = Field(default=0.05, ge=0.0, le=10.0)
    sell_slope_max: float = Field(default=0.02, ge=0.0, le=10.0)
    initial_capital: float = Field(default=1_000_000, gt=0)
    day_index: int = Field(..., ge=0)
    cash: float = Field(..., ge=0)
    shares: int = Field(default=0, ge=0)
    entry_price: float = Field(default=0.0, ge=0.0)
    entry_index: int = Field(default=-1)
    avg_cost: float = Field(default=0.0, ge=0.0)
    pending_order: dict | None = None
    last_reject_reason: str | None = None
    trades: list[dict] = Field(default_factory=list)
    total_fees: float = Field(default=0.0, ge=0.0)
    steps: int = Field(default=1, ge=1, le=500)
    # Manual next-bar order ({action: "buy"|"sell", limit_price?: float,
    # lots?: int}) — overrides the auto signal. Without limit_price it's a
    # market order; without lots a buy invests all cash / a sell sells all.
    manual_order: dict | None = None
    # Stop advancing at the first bar that produces a buy/sell signal.
    stop_on_signal: bool = False


def _ctx_from_req(req) -> SimContext:
    from src.simulation import _fetch_context

    return _fetch_context(
        req.stock_id,
        months=req.months,
        cooldown=req.cooldown,
        buy_slope_min=req.buy_slope_min,
        sell_slope_max=req.sell_slope_max,
    )


def _state_from_req(req) -> SimState:
    return SimState(
        day_index=req.day_index,
        cash=req.cash,
        shares=req.shares,
        entry_price=req.entry_price,
        entry_index=req.entry_index,
        avg_cost=req.avg_cost,
        pending_order=req.pending_order,
        last_reject_reason=req.last_reject_reason,
        trades=list(req.trades),
        total_fees=req.total_fees,
        start_capital=req.initial_capital,
    )


def _serialize_state(state: SimState) -> dict:
    return {
        "day_index": state.day_index,
        "cash": round(state.cash, 2),
        "shares": state.shares,
        "entry_price": round(state.entry_price, 2),
        "entry_index": state.entry_index,
        "avg_cost": round(state.avg_cost, 2),
        "pending_order": state.pending_order,
        "trades": state.trades,
        "total_fees": round(state.total_fees, 2),
        "last_reject_reason": state.last_reject_reason,
    }


@router.post("/simulate/init")
def simulate_init(req: SimInitRequest) -> dict:
    try:
        ctx = _ctx_from_req(req)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    state = SimState(
        day_index=ctx.warmup_offset,
        cash=req.initial_capital,
        start_capital=req.initial_capital,
    )

    # Baseline: no signal before the first bar is visible → first day just shows
    # the bar; the first trade can only trigger from bar 1 onward.
    days: list[dict] = []
    for i, d in enumerate(ctx.dates):
        sig = ctx.signals[i]
        advice_input = {
            "signal": {
                "buy": bool(sig.get("buy")),
                "sell": bool(sig.get("sell")),
                "slope8": sig.get("slope8"),
                "slope21": sig.get("slope21"),
                "trend": sig.get("trend"),
                "volume_distance": sig.get("volume_distance"),
                "close_offset": sig.get("close_offset"),
            },
            "position": {"shares": 0, "entry_price": 0.0},
            "close": ctx.closes[i],
        }
        days.append(
            {
                "date": d,
                "open": round(ctx.opens[i], 2),
                "high": round(ctx.highs[i], 2),
                "low": round(ctx.lows[i], 2),
                "close": round(ctx.closes[i], 2),
                "volume": 0,
                "signal": advice_input["signal"],
                "advice": generate_advice(
                    advice_input["signal"],
                    advice_input["position"],
                    advice_input["close"],
                ),
            }
        )

    # Execute the first bar so the timeline starts from bar 1 (the user has
    # "seen" bar 0's close already).
    log = advance(ctx, state, steps=1)
    first_day = log[0] if log else None
    if first_day:
        first_day["advice"] = generate_advice(
            first_day["signal"],
            first_day["position"],
            first_day["close"],
        )

    return {
        "stock_id": req.stock_id,
        "bars": len(ctx.dates),
        "initial_capital": req.initial_capital,
        "days": days,
        "state": _serialize_state(state),
        "last_day": first_day,
    }


@router.post("/simulate/advance")
def simulate_advance(req: SimAdvanceRequest) -> dict:
    try:
        ctx = _ctx_from_req(req)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    state = _state_from_req(req)
    log = advance(ctx, state, steps=req.steps, manual_order=req.manual_order, stop_on_signal=req.stop_on_signal)
    if not log:
        raise HTTPException(status_code=400, detail="已到最新交易日，無法再推進")

    # Attach advice for each advanced day
    for day in log:
        day["advice"] = generate_advice(
            day["signal"],
            day["position"],
            day["close"],
        )

    return {
        "days": log,
        "state": _serialize_state(state),
        "completed": state.day_index >= len(ctx.dates),
    }


@router.post("/simulate/order")
def simulate_order(req: SimAdvanceRequest) -> dict:
    """Place a next-bar order WITHOUT advancing the calendar.

    The user sees bar T's close (and AI advice), decides to place a limit or
    market order for bar T+1, then presses 下一步 which executes it. This keeps
    the order date aligned with the visible bar instead of silently advancing.
    """
    try:
        ctx = _ctx_from_req(req)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    state = _state_from_req(req)
    i = state.day_index
    if i >= len(ctx.dates):
        raise HTTPException(status_code=400, detail="已到最新交易日，無法掛單")

    order = req.manual_order or {}
    action = order.get("action")
    if action not in ("buy", "sell"):
        raise HTTPException(status_code=400, detail="manual_order.action must be buy or sell")

    state.pending_order = {
        "action": action,
        "date": ctx.dates[i],
        "reason": "manual",
        "limit_price": order.get("limit_price"),
        "lots": order.get("lots"),
    }

    return {"state": _serialize_state(state)}


@router.post("/simulate/cancel-order")
def simulate_cancel_order(req: SimAdvanceRequest) -> dict:
    """Cancel any pending manual order without advancing the calendar."""
    state = _state_from_req(req)
    state.pending_order = None
    return {"state": _serialize_state(state)}
