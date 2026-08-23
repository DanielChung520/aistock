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
import { BACKTEST_METRICS_MD, BACKTEST_SUMMARY_MD } from '@/components/tx-rl/help-content'

interface TxRLMetrics {
  cumulative_return_pct: number
  sharpe: number
  max_drawdown_pct: number
  win_rate_pct: number
  num_trades: number
  num_steps: number
}

interface TxRLResult {
  job_id: string
  metrics: TxRLMetrics
  model_path: string
  config: Record<string, unknown>
}

export default function TXRLBacktestPage() {
  const router = useRouter()
  const [result, setResult] = useState<TxRLResult | null>(null)
  const jobId = typeof window !== 'undefined' ? sessionStorage.getItem('tx_rl_job_id') : null
  const [loading, setLoading] = useState(!jobId)
  const [error, setError] = useState<string | null>(
    jobId ? null : '找不到訓練 job，請從環境定義頁啟動訓練',
  )

  useEffect(() => {
    if (!jobId) return
    fetch(`/api/tx-rl/jobs/${jobId}/result`)
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
  }, [jobId])

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

  const m = result.metrics
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
              {m.num_steps} 步訓練 · {m.num_trades} 次交易
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
              <Row label="交易次數" value={m.num_trades.toString()} />
              <Row label="訓練步數" value={m.num_steps.toString()} />
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
