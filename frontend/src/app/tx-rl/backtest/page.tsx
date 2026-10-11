'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AppShell } from '@/components/app-shell'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Bot, ChevronRight, Loader2 } from 'lucide-react'
import { WarningChart } from '@/components/tx-rl/WarningChart'
import { BlockTitle } from '@/components/tx-rl/HelpButton'
import { BACKTEST_METRICS_MD, BACKTEST_SUMMARY_MD, BACKTEST_REWARD_MD, BACKTEST_EQUITY_MD } from '@/components/tx-rl/help-content'

interface TxRLMetrics {
  cumulative_return_pct?: number
  cumulative_return_pct_mean?: number
  cumulative_return_pct_std?: number
  sharpe?: number
  sharpe_mean?: number
  sharpe_std?: number
  sortino?: number
  sortino_mean?: number
  calmar?: number
  calmar_mean?: number
  max_drawdown_pct?: number
  max_drawdown_pct_mean?: number
  max_drawdown_pct_std?: number
  win_rate_pct?: number
  win_rate_pct_mean?: number
  num_trades?: number
  num_trades_mean?: number
  num_steps?: number
  n_folds?: number
}

interface TxRLResult {
  job_id: string
  metrics: TxRLMetrics
  model_path: string
  config: Record<string, unknown>
  equity_curve?: Array<{ date: string; equity: number; drawdown: number; position: number }>
  trade_list?: Array<{ date: string; action: string; entry_price: number; position: number }>
  training_rewards?: Array<{ step: number; reward: number; fold?: number }>
}

function normalizeMetrics(raw: TxRLMetrics | undefined | null): {
  cumulative_return_pct: number
  sharpe: number
  sortino: number
  calmar: number
  max_drawdown_pct: number
  win_rate_pct: number
  num_trades: number
  num_steps: number
  is_walk_forward: boolean
  n_folds: number
  std_label: string
} {
  const fallback = {
    cumulative_return_pct: 0,
    sharpe: 0,
    sortino: 0,
    calmar: 0,
    max_drawdown_pct: 0,
    win_rate_pct: 0,
    num_trades: 0,
    num_steps: 0,
    is_walk_forward: false,
    n_folds: 1,
    std_label: '',
  }
  if (!raw) return fallback
  const wf = typeof raw.n_folds === 'number' && raw.n_folds > 1
  const pick = (rawKey: string, meanKey: string): number => {
    const obj = raw as unknown as Record<string, unknown>
    if (wf && typeof obj[meanKey] === 'number') {
      return obj[meanKey] as number
    }
    const v = obj[rawKey]
    return typeof v === 'number' ? (v as number) : 0
  }
  return {
    cumulative_return_pct: pick('cumulative_return_pct', 'cumulative_return_pct_mean'),
    sharpe: pick('sharpe', 'sharpe_mean'),
    sortino: pick('sortino', 'sortino_mean'),
    calmar: pick('calmar', 'calmar_mean'),
    max_drawdown_pct: pick('max_drawdown_pct', 'max_drawdown_pct_mean'),
    win_rate_pct: pick('win_rate_pct', 'win_rate_pct_mean'),
    num_trades: pick('num_trades', 'num_trades_mean'),
    num_steps: wf ? 0 : (typeof raw.num_steps === 'number' ? raw.num_steps : 0),
    is_walk_forward: wf,
    n_folds: wf && typeof raw.n_folds === 'number' ? raw.n_folds : 1,
    std_label: wf && typeof raw.n_folds === 'number' ? `（${raw.n_folds} 折 mean ± std）` : '',
  }
}

export default function TXRLBacktestPage() {
  const router = useRouter()
  const [result, setResult] = useState<TxRLResult | null>(null)
  const jobId = typeof window !== 'undefined' ? sessionStorage.getItem('tx_rl_job_id') : null
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [resolvedJobId, setResolvedJobId] = useState<string | null>(jobId)

  useEffect(() => {
    if (jobId) return
    fetch('/api/tx-rl/jobs/latest')
      .then((r) => {
        if (r.status === 404) throw new Error('找不到訓練 job，請從環境定義頁啟動訓練')
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((d) => {
        sessionStorage.setItem('tx_rl_job_id', d.job_id)
        setResolvedJobId(d.job_id)
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e)
        setError(msg)
        toast.error(msg)
        setLoading(false)
      })
  }, [jobId])

  useEffect(() => {
    const target = resolvedJobId
    if (!target) return
    fetch(`/api/tx-rl/jobs/${target}/result`)
      .then((r) => {
        if (r.status === 404) throw new Error('訓練尚未完成或結果未就緒')
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((d: TxRLResult) => setResult(d))
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e)
        setError(msg)
        toast.error('讀取回測結果失敗', { description: msg })
      })
      .finally(() => setLoading(false))
  }, [resolvedJobId])

  if (loading) {
    return (
      <AppShell title="台指期 RL — 回測結果">
        <div className="flex items-center justify-center h-full text-sm text-muted-foreground gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> 讀取訓練結果…
        </div>
      </AppShell>
    )
  }

  if (error || !result) {
    return (
      <AppShell title="台指期 RL — 回測結果">
        <div className="flex flex-col items-center justify-center h-full gap-3 text-sm">
          <p className="text-destructive">{error ?? '無資料'}</p>
          <Button size="sm" variant="outline" onClick={() => router.push('/tx-rl')}>
            ← 回到環境定義
          </Button>
        </div>
      </AppShell>
    )
  }

  const m = normalizeMetrics(result.metrics)
  const fmtPct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
  const fmtNum = (v: number, d = 2) => v.toFixed(d)

  return (
    <AppShell title="台指期 RL — 回測結果">
      <div className="flex flex-col h-full min-h-0 gap-4 p-4 lg:p-6">
        <WarningChart />

        <div className="shrink-0 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold flex items-center gap-2">
              <Bot className="h-5 w-5 text-muted-foreground" />
              台指期 RL — 回測結果
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {m.is_walk_forward
                ? `${m.n_folds} 折 · ${m.num_trades.toFixed(1)} 次交易（折平均）${m.std_label}`
                : `${m.num_steps} 步訓練 · ${m.num_trades} 次交易`}
            </p>
          </div>
          <Button onClick={() => router.push('/tx-rl/evaluation')}>
            與 Buy & Hold 對照
            <ChevronRight className="h-3.5 w-3.5 ml-1" />
          </Button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto grid grid-cols-1 lg:grid-cols-3 gap-4 pb-4">
          <Card>
            <CardHeader className="pb-3">
              <BlockTitle title="核心指標" helpContent={BACKTEST_METRICS_MD} />
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                <MetricBox label="累積報酬" value={fmtPct(m.cumulative_return_pct)} tone={m.cumulative_return_pct >= 0 ? 'good' : 'bad'} />
                <MetricBox label="Sharpe" value={fmtNum(m.sharpe)} />
                <MetricBox label="MDD" value={fmtPct(m.max_drawdown_pct)} tone="bad" />
                <MetricBox label="勝率" value={`${m.win_rate_pct.toFixed(1)}%`} />
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader className="pb-3">
              <BlockTitle title="訓練摘要" helpContent={BACKTEST_SUMMARY_MD} />
            </CardHeader>
            <CardContent className="space-y-2">
              <Row label={m.is_walk_forward ? "交易次數（折平均）" : "交易次數"} value={m.num_trades.toFixed(m.is_walk_forward ? 1 : 0)} />
              <Row label={m.is_walk_forward ? "Walk-Forward" : "訓練步數"} value={m.is_walk_forward ? `${m.n_folds} 折` : m.num_steps.toString()} />
              <Row label="模型路徑" value={result.model_path} mono />
              <Row label="Job ID" value={result.job_id} mono />
              {result.config && Object.keys(result.config).length > 0 && (
                <details className="text-xs pt-2 border-t border-border/50">
                  <summary className="cursor-pointer text-muted-foreground">查看完整 config</summary>
                  <pre className="mt-2 text-[10px] bg-muted/30 p-2 rounded overflow-x-auto">
                    {JSON.stringify(result.config, null, 2)}
                  </pre>
                </details>
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-3">
            <CardHeader className="pb-3">
              <BlockTitle title="訓練 Reward 曲線" helpContent={BACKTEST_REWARD_MD} />
            </CardHeader>
            <CardContent>
              <RewardChart rewards={result.training_rewards ?? []} totalSteps={((): number => {
                const cfg = result.config as { model?: { total_timesteps?: number } } | undefined
                const t = cfg?.model?.total_timesteps ?? 50000
                const nFolds = result.metrics?.n_folds && result.metrics.n_folds > 1 ? result.metrics.n_folds : 1
                return nFolds * t
              })()} />
            </CardContent>
          </Card>

          <Card className="lg:col-span-3">
            <CardHeader className="pb-3">
              <BlockTitle title="Equity Curve（含交易標記）" helpContent={BACKTEST_EQUITY_MD} />
            </CardHeader>
            <CardContent>
              <EquityCurveWithTrades
                equity={result.equity_curve ?? []}
                trades={result.trade_list ?? []}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between text-xs py-1 gap-3">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className={`${mono ? 'font-mono text-[10px]' : 'font-mono font-medium'} tabular-nums truncate`} title={value}>
        {value}
      </span>
    </div>
  )
}

function MetricBox({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' | 'neutral' }) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2 text-center">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`text-base font-bold tabular-nums mt-0.5 ${
        tone === 'good' ? 'text-emerald-600 dark:text-emerald-400' :
        tone === 'bad' ? 'text-red-600 dark:text-red-400' : ''
      }`}>{value}</div>
    </div>
  )
}

function RewardChart({ rewards, totalSteps }: { rewards: Array<{ step: number; reward: number; fold?: number }>; totalSteps: number }) {
  if (!rewards || rewards.length === 0) {
    return <p className="text-xs text-muted-foreground">無訓練 reward 資料（可能是舊 job）</p>
  }
  const W = 800, H = 160, P = 24
  const xs = rewards.map((r) => r.step)
  const ys = rewards.map((r) => r.reward)
  const xMin = 0, xMax = Math.max(totalSteps, xs[xs.length - 1] ?? totalSteps)
  const yMin = Math.min(...ys, 0)
  const yMax = Math.max(...ys, 0)
  const yRange = yMax - yMin || 1
  const xRange = xMax - xMin || 1
  const sx = (x: number) => P + (W - 2 * P) * ((x - xMin) / xRange)
  const sy = (y: number) => H - P - (H - 2 * P) * ((y - yMin) / yRange)
  const path = rewards.map((r, i) => `${i === 0 ? 'M' : 'L'}${sx(r.step).toFixed(1)},${sy(r.reward).toFixed(1)}`).join(' ')
  const zeroY = sy(0)
  const folds = Array.from(new Set(rewards.map((r) => r.fold).filter((f): f is number => typeof f === 'number')))
  return (
    <div className="space-y-2">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-40" role="img" aria-label="PPO training reward curve">
          <rect x="0" y="0" width={W} height={H} fill="currentColor" className="text-muted/20" />
          <line x1={P} y1={zeroY} x2={W - P} y2={zeroY} stroke="currentColor" strokeDasharray="2 2" className="text-muted-foreground/40" />
          {folds.length > 1 && folds.slice(0, -1).map((f) => {
            const x = sx(f * (totalSteps / folds.length))
            return <line key={f} x1={x} y1={P} x2={x} y2={H - P} stroke="currentColor" strokeDasharray="3 3" className="text-blue-400/40" />
          })}
          <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-blue-500" />
          {rewards.map((r, i) => (
            <circle key={i} cx={sx(r.step)} cy={sy(r.reward)} r="2" fill="currentColor" className={r.reward >= 0 ? 'text-emerald-500' : 'text-red-500'} />
          ))}
        </svg>
        <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono">
          <span>step {xMin.toLocaleString()} ~ {xMax.toLocaleString()}</span>
          <span>reward {yMin.toFixed(2)} ~ {yMax.toFixed(2)}</span>
          <span>{rewards.length} points{folds.length > 1 ? ` · ${folds.length} 折` : ''}</span>
        </div>
      </div>
  )
}

function EquityCurveWithTrades({
  equity,
  trades,
}: {
  equity: Array<{ date: string; equity: number; drawdown: number; position: number }>
  trades: Array<{ date: string; action: string; entry_price: number; position: number }>
}) {
  if (!equity || equity.length === 0) {
    return <p className="text-xs text-muted-foreground">無 equity curve 資料</p>
  }
  const W = 800, H = 200, P = 24
  const eqs = equity.map((e) => e.equity)
  const yMin = Math.min(...eqs, 1.0)
  const yMax = Math.max(...eqs, 1.0)
  const yRange = yMax - yMin || 0.01
  const sx = (i: number) => P + (W - 2 * P) * (i / Math.max(1, equity.length - 1))
  const sy = (y: number) => H - P - (H - 2 * P) * ((y - yMin) / yRange)
  const path = equity.map((e, i) => `${i === 0 ? 'M' : 'L'}${sx(i).toFixed(1)},${sy(e.equity).toFixed(1)}`).join(' ')
  const baselineY = sy(1.0)
  const dateToIdx = new Map<string, number>()
  equity.forEach((e, i) => dateToIdx.set(e.date, i))
  const tradeMarkers = (trades ?? []).map((t, i) => {
    const idx = dateToIdx.get(t.date)
    if (idx === undefined) return null
    const isBuy = t.action === 'Buy'
    return { x: sx(idx), y: sy(equity[idx].equity), color: isBuy ? '#10b981' : '#ef4444', label: t.action, idx }
  }).filter((x): x is NonNullable<typeof x> => x !== null)
  const firstDate = equity[0]?.date?.slice(0, 10) ?? ''
  const lastDate = equity[equity.length - 1]?.date?.slice(0, 10) ?? ''
  return (
    <div className="space-y-2">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-52" role="img" aria-label="Equity curve with trade markers">
          <rect x="0" y="0" width={W} height={H} fill="currentColor" className="text-muted/20" />
          <line x1={P} y1={baselineY} x2={W - P} y2={baselineY} stroke="currentColor" strokeDasharray="2 2" className="text-muted-foreground/40" />
          <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-blue-500" />
          {tradeMarkers.map((m, i) => (
            <g key={i}>
              <line x1={m.x} y1={m.y - 8} x2={m.x} y2={m.y + 8} stroke={m.color} strokeWidth="1.5" />
              <polygon
                points={m.color === '#10b981' ? `${m.x - 5},${m.y - 5} ${m.x + 5},${m.y - 5} ${m.x},${m.y + 4}` : `${m.x - 5},${m.y + 5} ${m.x + 5},${m.y + 5} ${m.x},${m.y - 4}`}
                fill={m.color}
              />
            </g>
          ))}
        </svg>
        <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono">
          <span>{firstDate} ~ {lastDate}</span>
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 bg-emerald-500 rounded-sm" />Buy</span>
            <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 bg-red-500 rounded-sm" />Sell</span>
            <span>{equity.length} 天 · {tradeMarkers.length} 次交易</span>
          </span>
          <span>equity {yMin.toFixed(3)} ~ {yMax.toFixed(3)}</span>
        </div>
      </div>
  )
}
