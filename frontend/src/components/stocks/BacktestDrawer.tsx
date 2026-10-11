'use client'

import { useState } from 'react'
import { X, Play, AlertTriangle, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { BacktestRequest, BacktestResult, BacktestSuggestion } from '@/types/stock'

interface BacktestDrawerProps {
  isOpen: boolean
  onClose: () => void
  stockId: string
  stockName?: string
}

const MONTH_OPTIONS = [
  { label: '6個月', value: 6 },
  { label: '1年', value: 12 },
  { label: '2年', value: 24 },
  { label: '3年', value: 36 },
  { label: '5年', value: 60 },
]

const DEFAULT_FORM: BacktestRequest = {
  stock_id: '',
  months: 24,
  cooldown: 1,
  buy_slope_min: 0.05,
  sell_slope_max: 0.02,
  max_hold_bars: 0,
  stop_loss_pct: 0,
  initial_capital: 100000,
}

function formatMoney(v: number): string {
  if (v >= 1e8) return (v / 1e8).toFixed(2) + '億'
  if (v >= 1e4) return (v / 1e4).toFixed(1) + '萬'
  return v.toLocaleString()
}

export function BacktestDrawer({ isOpen, onClose, stockId, stockName }: BacktestDrawerProps) {
  const [form, setForm] = useState<BacktestRequest>({ ...DEFAULT_FORM, stock_id: stockId })
  const [result, setResult] = useState<BacktestResult | null>(null)
  const [suggestion, setSuggestion] = useState<BacktestSuggestion | null>(null)
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setField = <K extends keyof BacktestRequest>(key: K, value: BacktestRequest[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const run = async () => {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/backtest/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, stock_id: form.stock_id || stockId }),
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => null)
        throw new Error(detail?.detail || `回測失敗 (${res.status})`)
      }
      const data = (await res.json()) as BacktestResult
      setResult(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : '回測失敗')
    } finally {
      setLoading(false)
    }
  }

  const suggest = async () => {
    setSuggestLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/backtest/suggest?stock_id=${form.stock_id || stockId}&months=${form.months}`)
      if (!res.ok) {
        const detail = await res.json().catch(() => null)
        throw new Error(detail?.detail || `建議失敗 (${res.status})`)
      }
      const data = (await res.json()) as BacktestSuggestion
      setSuggestion(data)
      setForm((prev) => ({
        ...prev,
        cooldown: data.suggested_params.cooldown,
        buy_slope_min: data.suggested_params.buy_slope_min,
        sell_slope_max: data.suggested_params.sell_slope_max,
        max_hold_bars: data.suggested_params.max_hold_bars,
        stop_loss_pct: data.suggested_params.stop_loss_pct,
      }))
    } catch (e) {
      setError(e instanceof Error ? e.message : '建議失敗')
    } finally {
      setSuggestLoading(false)
    }
  }

  const curvePoints = result?.equity_curve ?? []
  const minEquity = curvePoints.length > 0 ? Math.min(...curvePoints.map((p) => p.equity)) : 0
  const maxEquity = curvePoints.length > 0 ? Math.max(...curvePoints.map((p) => p.equity)) : 100
  const curveRange = Math.max(maxEquity - minEquity, 1)

  const statCard = (label: string, value: string, tone: 'good' | 'bad' | 'neutral' = 'neutral') => (
    <div className="flex flex-col items-center rounded-md border border-border bg-muted/30 px-2 py-2">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className={cn(
        'text-sm font-bold tabular-nums',
        tone === 'good' && 'text-red-500',
        tone === 'bad' && 'text-green-500',
        tone === 'neutral' && 'text-foreground',
      )}>{value}</span>
    </div>
  )

  return (
    <>
      {isOpen && <div className="absolute inset-0 z-10 bg-black/30 pointer-events-none" />}
      <div
        className={cn(
          'absolute z-20 flex flex-col bg-background border-t border-border shadow-2xl rounded-t-lg transition-transform duration-300 ease-out',
          '-left-4 md:-left-6 -right-4 md:-right-6',
          'bottom-0',
          isOpen ? 'translate-y-0' : 'translate-y-full',
        )}
        style={{ maxHeight: '100%' }}
      >
        <div className="flex items-center justify-end pl-3 pr-[18px] py-1.5 shrink-0">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="space-y-1">
            <h3 className="text-sm font-bold">Daniel MA 回測</h3>
            <p className="text-xs text-muted-foreground">
              {stockName ? `${stockName} (${stockId})` : stockId} — 依買賣訊號模擬多頭波段交易
            </p>
          </div>

          {/* ── 參數表單 ── */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5 col-span-2">
              <Label className="text-xs">回測區間</Label>
              <div className="flex flex-wrap gap-1.5">
                {MONTH_OPTIONS.map((opt) => (
                  <Button
                    key={opt.value}
                    size="sm"
                    variant={form.months === opt.value ? 'default' : 'outline'}
                    className="h-7 px-2 text-xs"
                    onClick={() => setField('months', opt.value)}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">訊號冷卻 (根)</Label>
              <Input
                type="number"
                min={0}
                max={50}
                value={form.cooldown}
                onChange={(e) => setField('cooldown', parseInt(e.target.value, 10) || 0)}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">買進斜率下限 (%)</Label>
              <Input
                type="number"
                min={0}
                max={10}
                step={0.01}
                value={form.buy_slope_min}
                onChange={(e) => setField('buy_slope_min', parseFloat(e.target.value) || 0)}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">賣出斜率上限 (%)</Label>
              <Input
                type="number"
                min={0}
                max={10}
                step={0.01}
                value={form.sell_slope_max}
                onChange={(e) => setField('sell_slope_max', parseFloat(e.target.value) || 0)}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">停損 (%) 0=關閉</Label>
              <Input
                type="number"
                min={0}
                max={50}
                step={0.5}
                value={form.stop_loss_pct}
                onChange={(e) => setField('stop_loss_pct', parseFloat(e.target.value) || 0)}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label className="text-xs">最大持股天數 (0=不限)</Label>
              <Input
                type="number"
                min={0}
                max={250}
                value={form.max_hold_bars}
                onChange={(e) => setField('max_hold_bars', parseInt(e.target.value, 10) || 0)}
                className="h-8 text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" className="h-8 text-xs gap-1" onClick={run} disabled={loading || suggestLoading}>
              <Play className="h-3.5 w-3.5" />
              {loading ? '回測中…' : '執行回測'}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="h-8 text-xs gap-1"
              onClick={suggest}
              disabled={suggestLoading || loading}
            >
              <Sparkles className="h-3.5 w-3.5" />
              {suggestLoading ? '分析中…' : 'AI 建議策略'}
            </Button>
          </div>

          {suggestion && (
            <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold flex items-center gap-1">
                  <Sparkles className="h-3 w-3 text-primary" />
                  AI 建議參數
                </span>
                <span className="text-[10px] text-muted-foreground">
                  波動 {suggestion.profile.volatility_pct}% · 訊號 {suggestion.profile.buys_per_month}/月 · 多頭佔比 {suggestion.profile.trend_share_pct}%
                </span>
              </div>
              <ul className="space-y-1 text-[11px] text-muted-foreground">
                {suggestion.reasons.map((r, i) => (
                  <li key={i} className="flex gap-1.5">
                    <span className="text-primary shrink-0">•</span>
                    {r}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border/50 pt-1.5 text-[11px]">
                <span>冷卻 <b className="text-foreground">{suggestion.suggested_params.cooldown}</b></span>
                <span>買斜率 <b className="text-foreground">{suggestion.suggested_params.buy_slope_min}</b></span>
                <span>賣斜率 <b className="text-foreground">{suggestion.suggested_params.sell_slope_max}</b></span>
                <span>停損 <b className="text-foreground">{suggestion.suggested_params.stop_loss_pct}%</b></span>
                <span>持股 <b className="text-foreground">{suggestion.suggested_params.max_hold_bars || '不限'}</b></span>
              </div>
              {suggestion.expected_result.total_return_pct != null && (
                <div className="border-t border-border/50 pt-1.5 text-[11px] text-muted-foreground">
                  以建議參數回測預估：總報酬 <b className="text-red-500">{suggestion.expected_result.total_return_pct}%</b> · 勝率 {suggestion.expected_result.win_rate_pct}% · 回撤 -{suggestion.expected_result.max_drawdown_pct}% · {suggestion.expected_result.closed_trades} 筆
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {error}
            </div>
          )}

          {/* ── 結果 ── */}
          {result && (
            <>
              <div className="grid grid-cols-3 gap-2">
                {statCard('總報酬', `${result.total_return_pct > 0 ? '+' : ''}${result.total_return_pct}%`, result.total_return_pct >= 0 ? 'good' : 'bad')}
                {statCard('勝率', `${result.win_rate_pct}%`)}
                {statCard('盈虧比', result.profit_factor != null ? String(result.profit_factor) : '—')}
                {statCard('最大回撤', `-${result.max_drawdown_pct}%`, 'bad')}
                {statCard('交易次數', String(result.closed_trades))}
                {statCard('平均獲利', `${result.avg_win_pct > 0 ? '+' : ''}${result.avg_win_pct}%`, result.avg_win_pct > 0 ? 'good' : 'bad')}
                {statCard('平均虧損', `${result.avg_loss_pct}%`, 'bad')}
                {statCard('期末資金', formatMoney(result.final_equity))}
                {statCard('最後狀態', result.last_signal === 'holding' ? '持倉中' : '空倉')}
              </div>

              {/* 權益曲線 */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground">權益曲線 (初始=100)</span>
                  <span className="text-[10px] text-muted-foreground">{curvePoints.length} 交易日</span>
                </div>
                <div className="relative h-28 w-full overflow-hidden rounded-md border border-border bg-muted/20">
                  <svg className="h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                    <line
                      x1="0"
                      y1={100 - ((100 - minEquity) / curveRange) * 100}
                      x2="100"
                      y2={100 - ((100 - minEquity) / curveRange) * 100}
                      stroke="#9ca3af"
                      strokeWidth="0.5"
                      strokeDasharray="2,2"
                    />
                    <polyline
                      fill="none"
                      stroke="#ef4444"
                      strokeWidth="1.2"
                      points={curvePoints
                        .map((p, i) => {
                          const x = (i / Math.max(curvePoints.length - 1, 1)) * 100
                          const y = 100 - ((p.equity - minEquity) / curveRange) * 100
                          return `${x},${y}`
                        })
                        .join(' ')}
                    />
                  </svg>
                </div>
              </div>

              {/* 交易列表 */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground">交易明細 ({result.trades.length})</span>
                  <span className="text-[10px] text-muted-foreground">綠=虧損 紅=獲利 (台股慣例)</span>
                </div>
                <div className="max-h-56 overflow-y-auto rounded-md border border-border">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-background">
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="px-2 py-1.5 text-left font-medium">買入</th>
                        <th className="px-2 py-1.5 text-left font-medium">賣出</th>
                        <th className="px-2 py-1.5 text-right font-medium">損益%</th>
                        <th className="px-2 py-1.5 text-right font-medium">原因</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.trades.map((t, i) => (
                        <tr key={i} className="border-b border-border/50 last:border-0">
                          <td className="px-2 py-1.5">{t.entry_date}</td>
                          <td className="px-2 py-1.5">{t.exit_date}</td>
                          <td className={cn(
                            'px-2 py-1.5 text-right font-semibold tabular-nums',
                            t.return_pct > 0 ? 'text-red-500' : 'text-green-500',
                          )}>
                            {t.return_pct > 0 ? '+' : ''}{t.return_pct}%
                          </td>
                          <td className="px-2 py-1.5 text-right text-muted-foreground">
                            {t.exit_reason === 'signal' ? '訊號' : t.exit_reason === 'stop_loss' ? '停損' : t.exit_reason === 'max_hold' ? '持滿' : '持倉中'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
