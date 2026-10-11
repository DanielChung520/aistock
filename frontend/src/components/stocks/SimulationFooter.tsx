'use client'

import { useEffect, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  FastForward,
  Play,
  RotateCcw,
  Bot,
  TrendingUp,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type {
  AiAdvice,
  SimulationAdvanceResult,
  SimulationDay,
  SimulationInitResult,
  SimulationState,
} from '@/types/stock'

interface SimulationFooterProps {
  symbol: string
  stockName?: string
  onDayChange?: (date: string | null) => void
  onMonthsChange?: (months: number) => void
}

const MONTH_OPTIONS = [
  { label: '3月', value: 3 },
  { label: '6月', value: 6 },
  { label: '9月', value: 9 },
  { label: '1年', value: 12 },
  { label: '18月', value: 18 },
  { label: '2年', value: 24 },
  { label: '3年', value: 36 },
  { label: '4年', value: 48 },
  { label: '5年', value: 60 },
]

const STRATEGY_PARAMS = {
  cooldown: 1,
  buy_slope_min: 0.05,
  sell_slope_max: 0.02,
}

const ACTION_META: Record<string, { label: string; cls: string }> = {
  buy: { label: '建議買入', cls: 'bg-red-500/15 text-red-500' },
  sell: { label: '建議賣出', cls: 'bg-green-500/15 text-green-500' },
  hold: { label: '建議續抱', cls: 'bg-amber-500/15 text-amber-500' },
  wait: { label: '觀望', cls: 'bg-muted text-muted-foreground' },
}

export function SimulationFooter({ symbol, stockName, onDayChange, onMonthsChange }: SimulationFooterProps) {
  const [open, setOpen] = useState(false)
  const [months, setMonths] = useState(12)
  const [capital, setCapital] = useState(1000000)
  const [capitalText, setCapitalText] = useState('1,000,000')
  const [init, setInit] = useState<SimulationInitResult | null>(null)
  const [state, setState] = useState<SimulationState | null>(null)
  const [currentDay, setCurrentDay] = useState<SimulationDay | null>(null)
  const [adviceModal, setAdviceModal] = useState(false)
  const [pendingManual, setPendingManual] = useState<'buy' | 'sell' | null>(null)
  const [buyPrice, setBuyPrice] = useState('')
  const [sellPrice, setSellPrice] = useState('')
  const [buyLots, setBuyLots] = useState(1)
  const [sellLots, setSellLots] = useState(1)
  const [showTradesPanel, setShowTradesPanel] = useState(false)
  const [lastRejected, setLastRejected] = useState<string | null>(null)
  const [history, setHistory] = useState<Array<{ state: SimulationState; day: SimulationDay }>>([])
  const tradesRef = useRef<HTMLDivElement>(null)
  // Keep the latest state in a ref so rapid clicks (掛單 → 下一步) always send
  // the freshest state, avoiding a race where advance uses a stale snapshot.
  const stateRef = useRef<SimulationState | null>(null)
  stateRef.current = state

  // Close the trades modal on outside pointerdown (DOM event, no overlay).
  useEffect(() => {
    if (!showTradesPanel) return
    const onPointerDown = (e: PointerEvent) => {
      if (tradesRef.current && !tradesRef.current.contains(e.target as Node)) {
        setShowTradesPanel(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [showTradesPanel])
  const [loading, setLoading] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const start = async () => {
    setLoading(true)
    setError(null)
    setCompleted(false)
    try {
      const res = await fetch('/api/backtest/simulate/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stock_id: symbol, months, ...STRATEGY_PARAMS, initial_capital: capital }),
      })
      if (!res.ok) throw new Error(`初始化失敗 (${res.status})`)
      const data = (await res.json()) as SimulationInitResult
      setInit(data)
      setState(data.state)
      stateRef.current = data.state
      const firstDay = data.days[data.state.day_index - 1] ?? data.days[0]
      setCurrentDay(firstDay)
      onDayChange?.(firstDay?.date ?? null)
      // Align the chart's data range with the simulation window so replayed
      // dates always fall inside the chart's history. Add +5 months so the
      // chart also shows the MA warm-up bars (MA89 needs ~89 bars) before the
      // sim start date.
      onMonthsChange?.(months + 5)
    } catch (e) {
      setError(e instanceof Error ? e.message : '初始化失敗')
    } finally {
      setLoading(false)
    }
  }

  const advance = async (steps = 1, manual?: 'buy' | 'sell', limitPrice?: string, lots?: number) => {
    const currentState = stateRef.current
    if (!currentState) return
    setLoading(true)
    setError(null)
    setPendingManual(null)
    setLastRejected(null)
    const parsedLimit = limitPrice ? parseFloat(limitPrice) : undefined
    try {
      const res = await fetch('/api/backtest/simulate/advance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stock_id: symbol,
          months,
          ...STRATEGY_PARAMS,
          initial_capital: capital,
          ...currentState,
          steps,
          manual_order: manual
            ? {
                action: manual,
                limit_price: parsedLimit && !isNaN(parsedLimit) ? parsedLimit : null,
                lots: lots && lots > 0 ? lots : null,
              }
            : null,
        }),
      })
      if (!res.ok) throw new Error(`推進失敗 (${res.status})`)
      const data = await res.json()
      const days = data.days as SimulationAdvanceResult['days']
      // Snapshot the pre-advance state so 上一步 can restore it.
      if (currentState && currentDay) {
        setHistory((prev) => [...prev, { state: { ...currentState }, day: currentDay }])
      }
      setState(data.state)
      stateRef.current = data.state
      const last = days[days.length - 1]
      setCurrentDay({ ...last, signal: last.signal, advice: last.advice })
      onDayChange?.(last?.date ?? null)
      setCompleted(data.completed)
      // Surface a rejected (limit not met) outcome in the trade area.
      const rejectedDay = days.find((d) => (d as { rejected?: boolean }).rejected)
      if (rejectedDay) {
        const rd = rejectedDay as { rejected_reason?: string; date: string }
        setLastRejected(`${rd.date}：${rd.rejected_reason ?? '限價未成交'}`)
      }
      // Limit orders are valid for 1 bar only. Whether the order filled or
      // was rejected, clear the price inputs so the next order must be
      // entered explicitly (prevents accidental repeat-orders at the old
      // quote).
      if (days.some((d) => (d as { order_executed?: string | null }).order_executed != null)) {
        setBuyPrice('')
        setSellPrice('')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '推進失敗')
    } finally {
      setLoading(false)
    }
  }
  // Place a next-bar order WITHOUT advancing the calendar. If an order is
  // already pending for the same side, clicking again cancels it instead.
  const placeOrder = async (manual: 'buy' | 'sell', limitPrice?: string, lots?: number) => {
    const currentState = stateRef.current
    if (!currentState) return
    setLoading(true)
    setError(null)
    const parsedLimit = limitPrice ? parseFloat(limitPrice) : undefined
    try {
      const isSameSide = currentState.pending_order?.action === manual
      const url = isSameSide ? '/api/backtest/simulate/cancel-order' : '/api/backtest/simulate/order'
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stock_id: symbol,
          months,
          ...STRATEGY_PARAMS,
          initial_capital: capital,
          ...currentState,
          steps: 1,
          manual_order: isSameSide
            ? undefined
            : {
                action: manual,
                limit_price: parsedLimit && !isNaN(parsedLimit) ? parsedLimit : null,
                lots: lots && lots > 0 ? lots : null,
              },
        }),
      })
      if (!res.ok) throw new Error(isSameSide ? `取消掛單失敗 (${res.status})` : `掛單失敗 (${res.status})`)
      const data = await res.json()
      setState(data.state)
      stateRef.current = data.state
    } catch (e) {
      setError(e instanceof Error ? e.message : '掛單失敗')
    } finally {
      setLoading(false)
    }
  }

  // Step back one day, restoring the previous state/date snapshot.
  const goBack = () => {
    const snap = history[history.length - 1]
    if (!snap) return
    setHistory((prev) => prev.slice(0, -1))
    setState(snap.state)
    setCurrentDay(snap.day)
    onDayChange?.(snap.day.date ?? null)
    setCompleted(false)
    setLastRejected(null)
  }

  // Auto-advance until a buy/sell signal day is reached.
  const autoAdvance = async () => {
    const currentState = stateRef.current
    if (!currentState) return
    setLoading(true)
    setError(null)
    setLastRejected(null)
    try {
      const res = await fetch('/api/backtest/simulate/advance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stock_id: symbol,
          months,
          ...STRATEGY_PARAMS,
          initial_capital: capital,
          ...currentState,
          steps: 500,
          stop_on_signal: true,
        }),
      })
      if (!res.ok) throw new Error(`自動推進失敗 (${res.status})`)
      const data = await res.json()
      const days = data.days as SimulationAdvanceResult['days']
      if (currentState && currentDay) {
        setHistory((prev) => [...prev, { state: { ...currentState }, day: currentDay }])
      }
      setState(data.state)
      stateRef.current = data.state
      const last = days[days.length - 1]
      setCurrentDay({ ...last, signal: last.signal, advice: last.advice })
      onDayChange?.(last?.date ?? null)
      setCompleted(data.completed)
      // Same 1-bar order validity: if auto-advance consumed an order on its
      // first step, clear the price inputs (see advance() for rationale).
      if (days.some((d) => (d as { order_executed?: string | null }).order_executed != null)) {
        setBuyPrice('')
        setSellPrice('')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '自動推進失敗')
    } finally {
      setLoading(false)
    }
  }

  const reset = () => {
    setInit(null)
    setState(null)
    setCurrentDay(null)
    setAdviceModal(false)
    setPendingManual(null)
    setCompleted(false)
    setError(null)
    onDayChange?.(null)
    setCapital(1000000)
    setCapitalText('1,000,000')
    setHistory([])
    stateRef.current = null
  }

  const advice = currentDay?.advice
  const sig = currentDay?.signal
  const positionValue = state ? state.cash + state.shares * (currentDay?.close ?? 0) : 0
  const totalReturn = init && state
    ? ((positionValue - init.initial_capital) / init.initial_capital) * 100
    : 0
  const meta = advice ? ACTION_META[advice.action] : null
  const nextOrder = state?.pending_order
  const hasPosition = (state?.shares ?? 0) > 0
  const buyPending = nextOrder?.action === 'buy'
  const sellPending = nextOrder?.action === 'sell'

  const renderAdviceModal = () => {
    if (!advice) return null
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setAdviceModal(false)}>
        <div
          className="w-80 rounded-lg border border-border bg-background p-4 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5 text-sm font-bold">
              <Bot className="h-4 w-4 text-primary" />
              AI 建議
            </div>
            <button onClick={() => setAdviceModal(false)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
          {currentDay && <p className="mb-2 text-xs text-muted-foreground">{currentDay.date} 收盤研判</p>}
          <div className={cn('mb-3 inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold', meta?.cls)}>
            {meta?.label}
          </div>
          {advice.suggested_price.length > 0 && (
            <div className="mb-2 text-xs">
              參考價位：<span className="font-semibold tabular-nums">{advice.suggested_price.join(' ~ ')}</span>
            </div>
          )}
          <ul className="space-y-1 text-xs text-muted-foreground">
            {advice.reasons.map((r, i) => (
              <li key={i} className="flex gap-1.5">
                <span className="text-primary shrink-0">•</span>
                {r}
              </li>
            ))}
          </ul>
          <p className="mt-3 border-t border-border/50 pt-2 text-[11px] text-muted-foreground">
            AI 建議僅供參考，請自行判斷下單。
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative shrink-0 border-t border-border bg-background/95 backdrop-blur">
      {adviceModal && renderAdviceModal()}

      {/* ── 交易明細 modal（無遮罩，DOM 外部點擊關閉）── */}
      {showTradesPanel && state && state.trades.length > 0 && (
        <div
          ref={tradesRef}
          className="fixed right-4 bottom-20 z-40 w-80 rounded-md border border-border bg-background shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
            <span className="text-[11px] font-semibold text-muted-foreground">交易明細（{state.trades.length} 筆）</span>
            <button
              onClick={() => setShowTradesPanel(false)}
              className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b border-border text-muted-foreground">
                  <th className="px-2 py-1 text-left font-medium">日期</th>
                  <th className="px-2 py-1 text-right font-medium">操作</th>
                  <th className="px-2 py-1 text-right font-medium">張數</th>
                  <th className="px-2 py-1 text-right font-medium">成交價</th>
                  <th className="px-2 py-1 text-right font-medium">均價</th>
                </tr>
              </thead>
              <tbody>
                {state.trades.slice().reverse().map((t, i) => (
                  <tr key={i} className="border-b border-border/40 last:border-0">
                    <td className="px-2 py-1 text-muted-foreground">{t.date}</td>
                    <td className={cn('px-2 py-1 text-right font-semibold', t.action === 'buy' ? 'text-red-500' : 'text-green-500')}>
                      {t.action === 'buy' ? '買' : '賣'}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">{t.shares / 1000}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{t.price}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
                      {t.avg_cost ?? '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-border px-3 py-1 text-[10px] text-muted-foreground">
            累計交易成本：<span className="font-semibold">${state.total_fees.toLocaleString()}</span>
          </div>
        </div>
      )}

      {/* ── 折疊列 ── */}
      <button
        className="flex w-full items-center justify-between px-4 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex items-center gap-1.5 font-semibold">
          <TrendingUp className="h-3.5 w-3.5" />
          模擬交易{stockName ? ` — ${stockName} (${symbol})` : ` — ${symbol}`}
          {state && currentDay && (
            <span className="text-muted-foreground font-normal">· {currentDay.date}</span>
          )}
        </span>
        <span className="flex items-center gap-2">
          {state && currentDay && (
            <span className="text-muted-foreground">
              權益{' '}
              <span className={cn('font-bold tabular-nums', totalReturn >= 0 ? 'text-red-500' : 'text-green-500')}>
                {totalReturn >= 0 ? '+' : ''}{totalReturn.toFixed(1)}%
              </span>
            </span>
          )}
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
        </span>
      </button>

      {/* ── 展開面板 ── */}
      {open && (
        <div className="px-4 pb-3 space-y-2">
          {/* 控制列 */}
          <div className="flex flex-wrap items-center gap-2">
            {!init ? (
              <>
                <span className="text-[11px] text-muted-foreground">區間</span>
                <ButtonGroup className="h-8">
                  {MONTH_OPTIONS.map((m) => (
                    <Button
                      key={m.value}
                      size="sm"
                      variant={months === m.value ? 'default' : 'ghost'}
                      className="h-8 px-2 text-[11px]"
                      onClick={() => setMonths(m.value)}
                    >
                      {m.label}
                    </Button>
                  ))}
                </ButtonGroup>
                <div className="flex items-center gap-1">
                  <Label className="text-[11px] text-muted-foreground">資金</Label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    value={capitalText}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/\D/g, '')
                      setCapitalText(digits ? Number(digits).toLocaleString() : '')
                      setCapital(digits ? parseInt(digits, 10) : 0)
                    }}
                    onBlur={() => {
                      if (!capital || capital < 100000) {
                        setCapital(1000000)
                        setCapitalText('1,000,000')
                      } else {
                        setCapitalText(capital.toLocaleString())
                      }
                    }}
                    className="h-8 w-32 text-xs tabular-nums text-right"
                  />
                </div>
                <Button size="sm" className="h-8 text-xs gap-1" onClick={start} disabled={loading}>
                  <Play className="h-3.5 w-3.5" />
                  {loading ? '載入中…' : '開始模擬'}
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  onClick={goBack}
                  disabled={loading || history.length === 0}
                  title="退回上一天"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                  上一步
                </Button>
                <Button size="sm" className="h-8 text-xs gap-1" onClick={() => advance(1)} disabled={loading || completed}>
                  <ChevronUp className="h-3.5 w-3.5" />
                  {loading ? '推進中…' : completed ? '已到最新' : '下一步 (1日)'}
                </Button>
                <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => advance(5)} disabled={loading || completed}>
                  快進 5日
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-8 text-xs"
                  onClick={autoAdvance}
                  disabled={loading || completed}
                  title="自動推進到下一個買/賣訊號日"
                >
                  <FastForward className="h-3.5 w-3.5" />
                  {loading ? '搜尋中…' : '自動下一步'}
                </Button>
                <Button size="sm" variant="ghost" className="h-8 w-8 px-0" onClick={reset} title="重新開始">
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
                {meta && (
                  <span
                    className={cn('cursor-pointer rounded-md px-2 py-1 text-xs font-bold', meta.cls)}
                    onClick={() => setAdviceModal(true)}
                    title="點擊看詳細建議"
                  >
                    {meta.label}
                  </span>
                )}
                <div className="ml-auto">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={() => setShowTradesPanel(true)}
                    disabled={state?.trades.length === 0}
                  >
                    交易明細{state && state.trades.length > 0 ? `（${state.trades.length} 筆）` : ''}
                  </Button>
                </div>
              </>
            )}
          </div>

          {init && state && (
            <div className="space-y-1.5">
              {/* 持倉：單行，標籤小字 + 數值加粗有顏色 */}
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11px]">
                <span className="text-muted-foreground">現金</span>
                <span className="font-bold tabular-nums text-foreground">{state.cash.toLocaleString()}</span>
                <span className="text-muted-foreground">持股</span>
                <span className="font-bold tabular-nums text-foreground">
                  {state.shares}
                  {state.shares > 0 && ` @ ${state.entry_price}`}
                  {state.shares > 0 && <span className="text-muted-foreground font-normal"> 均價{state.avg_cost.toFixed(2)}</span>}
                </span>
                <span className="text-muted-foreground">權益</span>
                <span className={cn('font-bold tabular-nums', totalReturn >= 0 ? 'text-red-500' : 'text-green-500')}>
                  {positionValue.toLocaleString()}
                  <span className="ml-1 text-[10px]">({totalReturn >= 0 ? '+' : ''}{totalReturn.toFixed(1)}%)</span>
                </span>
                {sig && (
                  <>
                    <span className="text-muted-foreground">MA8</span>
                    <span className="font-semibold tabular-nums">{sig.slope8 != null ? sig.slope8.toFixed(2) + '%' : '—'}</span>
                    <span className="text-muted-foreground">MA21</span>
                    <span className="font-semibold tabular-nums">{sig.slope21 != null ? sig.slope21.toFixed(2) + '%' : '—'}</span>
                    <span className="text-muted-foreground">強度</span>
                    <span className="font-semibold">{sig.trend ?? '—'}</span>
                    <span className="text-muted-foreground">成本</span>
                    <span className="font-semibold tabular-nums">${state.total_fees.toLocaleString()}</span>
                  </>
                )}
              </div>

              {lastRejected && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-600">
                  未成交：{lastRejected}
                </div>
              )}

              <div className="rounded-md border border-border bg-muted/20 px-2 py-1.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className={cn('text-[11px] font-bold', hasPosition ? 'text-amber-500' : 'text-red-500')}>
                    {hasPosition ? '加倉' : '買入'}
                  </span>
                  <span className="flex items-center gap-0.5">
                    <input
                      type="number"
                      min={1}
                      max={999}
                      step={1}
                      value={buyLots}
                      onChange={(e) => setBuyLots(Math.max(1, parseInt(e.target.value, 10) || 1))}
                      className="h-6 w-10 rounded border border-border bg-background px-1 text-right text-[11px] tabular-nums"
                    />
                    <span className="text-[10px] text-muted-foreground">張</span>
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    placeholder="報價"
                    value={buyPrice}
                    onChange={(e) => setBuyPrice(e.target.value)}
                    className="h-6 w-32 rounded border border-border bg-background px-1 text-[11px]"
                  />
                  <Button
                    size="sm"
                    variant={buyPending ? 'default' : 'outline'}
                    className={cn(
                      'h-6 px-2 text-[11px]',
                      buyPending ? 'bg-amber-500 text-black' : 'border-red-500/40 text-red-500 hover:bg-red-500/10',
                    )}
                    onClick={() => placeOrder('buy', buyPrice, buyLots)}
                    disabled={loading || completed}
                    title={buyPending ? '點擊取消加倉掛單' : hasPosition ? '加倉掛單' : '買入掛單'}
                  >
                    {buyPending ? '預加倉 [man]' : '掛單'}
                  </Button>
                  <span className="text-[10px] text-muted-foreground">
                    = <b className="tabular-nums">{(buyLots * 1000 * (buyPrice ? parseFloat(buyPrice) : (currentDay?.close ?? 0))).toLocaleString()}</b>
                  </span>

                  <span className="ml-2 text-[11px] font-bold text-green-500">賣出</span>
                  <span className="flex items-center gap-0.5">
                    <input
                      type="number"
                      min={1}
                      max={999}
                      step={1}
                      value={sellLots}
                      onChange={(e) => setSellLots(Math.max(1, parseInt(e.target.value, 10) || 1))}
                      className="h-6 w-10 rounded border border-border bg-background px-1 text-right text-[11px] tabular-nums"
                    />
                    <span className="text-[10px] text-muted-foreground">張</span>
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    placeholder="報價"
                    value={sellPrice}
                    onChange={(e) => setSellPrice(e.target.value)}
                    className="h-6 w-32 rounded border border-border bg-background px-1 text-[11px]"
                  />
                  <Button
                    size="sm"
                    variant={sellPending ? 'default' : 'outline'}
                    className={cn(
                      'h-6 px-2 text-[11px]',
                      sellPending
                        ? 'bg-green-500 text-black'
                        : 'border-green-500/40 text-green-500 hover:bg-green-500/10',
                    )}
                    onClick={() => placeOrder('sell', sellPrice, sellLots)}
                    disabled={loading || completed || !hasPosition}
                    title={sellPending ? '點擊取消賣出掛單' : hasPosition ? `減倉 ${sellLots}張` : '無持股可賣'}
                  >
                    {sellPending ? '預平倉 [man]' : '掛單'}
                  </Button>
                  {hasPosition && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[11px] text-green-600 hover:bg-green-500/10"
                      onClick={() => placeOrder('sell', sellPrice, Math.ceil(state.shares / 1000))}
                      disabled={loading || completed || sellPending}
                      title="全部持股掛出清倉"
                    >
                      平倉
                    </Button>
                  )}
                  <span className="text-[10px] text-muted-foreground">
                    = <b className="tabular-nums">{(sellLots * 1000 * (sellPrice ? parseFloat(sellPrice) : (currentDay?.close ?? 0))).toLocaleString()}</b>
                  </span>

                  {nextOrder && (
                    <span className="text-[10px] text-muted-foreground">
                      已掛單：{nextOrder.action === 'buy' ? (hasPosition ? '加倉' : '買入') : '賣出'}{nextOrder.lots ? ` ${nextOrder.lots}張` : ''}{' '}
                      {nextOrder.limit_price ? `@ ${nextOrder.limit_price}` : '市價'}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  有持股時買入=加倉（加權均價）；賣出可輸入張數減倉或一鍵平倉。報價留空=市價單（開盤價成交），填報價=限價單（價格觸及報價即成交，成交價為開盤價與報價較佳者）。AI 僅供參考。
                </p>
              </div>
            </div>
          )}

          {error && <p className="text-[11px] text-destructive">{error}</p>}
        </div>
      )}
    </div>
  )
}
