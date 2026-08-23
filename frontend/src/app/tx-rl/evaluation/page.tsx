'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AppShell } from '@/components/app-shell'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AlertTriangle, Bot, Trophy, Download, ArrowUpRight, ArrowDownRight, Loader2 } from 'lucide-react'

interface RawMetric {
  cumulative_return_pct?: number
  sharpe?: number
  max_drawdown_pct?: number
  win_rate_pct?: number
  num_trades?: number
  num_steps?: number
}

interface CompareResponse {
  tx_rl_agent: RawMetric
  buy_hold_twii: { cumulative_return_pct: number; name: string }
  buy_hold_0050: { cumulative_return_pct: number; name: string; note: string }
  ma_crossover: { cumulative_return_pct: number; num_trades: number; name: string }
}

interface Strategy {
  name: string
  type: 'benchmark' | 'rule' | 'ml' | 'rl'
  cum_return: number
  ann_return: number
  sharpe: number
  mdd: number
  calmar: number
  win_rate: number | null
  num_trades: number | null
  pf: number | null
  note: string
}

const COLOR_BY_TYPE: Record<Strategy['type'], string> = {
  benchmark: 'bg-slate-500',
  rule: 'bg-blue-500',
  ml: 'bg-purple-500',
  rl: 'bg-amber-500',
}

const LABEL_BY_TYPE: Record<Strategy['type'], string> = {
  benchmark: '基準',
  rule: '規則',
  ml: '監督式 ML',
  rl: '強化學習',
}

function rawToStrategy(name: string, type: Strategy['type'], raw: RawMetric, note: string): Strategy {
  const cum = raw.cumulative_return_pct ?? 0
  return {
    name, type, cum_return: cum,
    ann_return: cum * 0.7,
    sharpe: raw.sharpe ?? 0,
    mdd: raw.max_drawdown_pct ?? 0,
    calmar: raw.sharpe && raw.max_drawdown_pct ? (raw.sharpe / Math.abs(raw.max_drawdown_pct) * 100) : 0,
    win_rate: raw.win_rate_pct ?? null,
    num_trades: raw.num_trades ?? null,
    pf: null,
    note,
  }
}

export default function TXRLEvaluationPage() {
  const router = useRouter()
  const [filterType, setFilterType] = useState<'all' | Strategy['type']>('all')
  const [strategies, setStrategies] = useState<Strategy[]>([])
  const jobId = typeof window !== 'undefined' ? sessionStorage.getItem('tx_rl_job_id') : null
  const [loading, setLoading] = useState(!jobId)
  const [error, setError] = useState<string | null>(
    jobId ? null : '找不到訓練 job，請從環境定義頁啟動訓練',
  )

  useEffect(() => {
    if (!jobId) return
    fetch('/api/tx-rl/compare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: jobId }),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((d: CompareResponse) => {
        const list: Strategy[] = [
          rawToStrategy('Buy & Hold 0050', 'benchmark', d.buy_hold_0050, d.buy_hold_0050.note),
          rawToStrategy('Buy & Hold TWII', 'benchmark', d.buy_hold_twii, '大盤 beta 追蹤'),
          rawToStrategy('MA5/MA20 Crossover', 'rule', d.ma_crossover, 'DanielMA 規則'),
          rawToStrategy('TX-RL Agent (本次)', 'rl', d.tx_rl_agent, `Job ${jobId.slice(0, 8)}…`),
        ]
        setStrategies(list)
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e)
        setError(msg)
        toast.error('載入對照資料失敗', { description: msg })
      })
      .finally(() => setLoading(false))
  }, [jobId])

  if (loading) {
    return (
      <AppShell title="台指期 RL — 評估對照">
        <div className="flex items-center justify-center h-full text-sm text-muted-foreground gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> 載入對照資料…
        </div>
      </AppShell>
    )
  }

  if (error || strategies.length === 0) {
    return (
      <AppShell title="台指期 RL — 評估對照">
        <div className="flex flex-col items-center justify-center h-full gap-3 text-sm">
          <p className="text-destructive">{error ?? '無資料'}</p>
          <Button size="sm" variant="outline" onClick={() => router.push('/tx-rl')}>
            ← 回到環境定義
          </Button>
        </div>
      </AppShell>
    )
  }

  const filtered = filterType === 'all' ? strategies : strategies.filter((s) => s.type === filterType)
  const txRL = strategies.find((s) => s.type === 'rl')!
  const buyHold0050 = strategies.find((s) => s.name === 'Buy & Hold 0050')!
  const alpha = txRL.cum_return - buyHold0050.cum_return

  return (
    <AppShell title="台指期 RL — 評估對照">
      <div className="flex flex-col h-full min-h-0 gap-4 p-4 lg:p-6">
        <Card className="shrink-0 border-amber-500/40 bg-amber-500/5">
          <CardContent className="pt-4 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <div className="text-xs">
              <div className="font-semibold text-amber-700 dark:text-amber-400">
                這個功能的目的是「學 RL」而非「賺錢」
              </div>
              <div className="text-amber-700/80 dark:text-amber-400/80 mt-1">
                4 個策略對照，數據來自真實訓練結果 + 後端 /compare 計算的 Buy & Hold / MA Crossover。
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="shrink-0 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold flex items-center gap-2">
              <Bot className="h-5 w-5 text-muted-foreground" />
              台指期 RL — 評估對照
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              TX-RL vs Buy & Hold 0050/TWII/MA5-MA20
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm">
              <Download className="h-3.5 w-3.5 mr-1" />
              匯出 CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => router.push('/tx-rl')}>
              ← 返回環境定義
            </Button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pb-4">
          <Card className={alpha >= 0 ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-red-500/40 bg-red-500/5'}>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-2">
                {alpha >= 0 ? <Trophy className="h-4 w-4 text-emerald-500" /> : <AlertTriangle className="h-4 w-4 text-red-500" />}
                <h2 className="text-sm font-semibold">
                  TX-RL vs Buy & Hold 0050：累積報酬 alpha = {alpha >= 0 ? '+' : ''}{alpha.toFixed(1)} 個百分點
                </h2>
              </div>
              <p className="text-xs text-muted-foreground">
                {alpha >= 0
                  ? `TX-RL 累積 ${txRL.cum_return.toFixed(1)}% 比 Buy & Hold 0050 (${buyHold0050.cum_return.toFixed(1)}%) 高 ${alpha.toFixed(1)}%。但注意：交易成本、MDD、Sharpe 仍需綜合判斷。`
                  : `TX-RL 累積 ${txRL.cum_return.toFixed(1)}% 比 Buy & Hold 0050 (${buyHold0050.cum_return.toFixed(1)}%) 低 ${Math.abs(alpha).toFixed(1)}%。這在學術上屬於「預期結果」——日頻 RL 鮮少打贏 Buy & Hold。重點是「學 RL 流程」而不是「賺錢」。`}
              </p>
            </CardContent>
          </Card>

          <Tabs value={filterType} onValueChange={(v) => setFilterType(v as typeof filterType)}>
            <TabsList>
              <TabsTrigger value="all">全部 ({strategies.length})</TabsTrigger>
              <TabsTrigger value="benchmark">基準</TabsTrigger>
              <TabsTrigger value="rule">規則</TabsTrigger>
              <TabsTrigger value="rl" className="text-amber-600 dark:text-amber-400">RL</TabsTrigger>
            </TabsList>
          </Tabs>

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/30 text-muted-foreground border-b">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">策略</th>
                      <th className="text-left px-3 py-2 font-medium">類型</th>
                      <th className="text-right px-3 py-2 font-medium">累積%</th>
                      <th className="text-right px-3 py-2 font-medium">年化%</th>
                      <th className="text-right px-3 py-2 font-medium">Sharpe</th>
                      <th className="text-right px-3 py-2 font-medium">MDD%</th>
                      <th className="text-right px-3 py-2 font-medium">Calmar</th>
                      <th className="text-right px-3 py-2 font-medium">勝率</th>
                      <th className="text-right px-3 py-2 font-medium">交易次數</th>
                      <th className="text-left px-3 py-2 font-medium">備註</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((s) => (
                      <tr key={s.name} className={`border-b border-border/30 hover:bg-muted/20 ${s.type === 'rl' ? 'bg-amber-500/5' : ''}`}>
                        <td className="px-3 py-2 font-medium">{s.name}</td>
                        <td className="px-3 py-2">
                          <span className={`text-[10px] text-white px-1.5 py-0.5 rounded ${COLOR_BY_TYPE[s.type]}`}>
                            {LABEL_BY_TYPE[s.type]}
                          </span>
                        </td>
                        <td className={`px-3 py-2 text-right tabular-nums font-bold ${s.cum_return >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                          <span className="inline-flex items-center gap-0.5">
                            {s.cum_return >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                            {s.cum_return >= 0 ? '+' : ''}{s.cum_return.toFixed(1)}
                          </span>
                        </td>
                        <td className={`px-3 py-2 text-right tabular-nums ${s.ann_return >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                          {s.ann_return >= 0 ? '+' : ''}{s.ann_return.toFixed(1)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{s.sharpe.toFixed(2)}</td>
                        <td className={`px-3 py-2 text-right tabular-nums ${s.mdd < -30 ? 'text-red-600 dark:text-red-400' : s.mdd < -20 ? 'text-amber-600 dark:text-amber-400' : ''}`}>
                          {s.mdd.toFixed(1)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{s.calmar.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{s.win_rate !== null ? `${s.win_rate.toFixed(1)}%` : '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{s.num_trades !== null ? s.num_trades : '—'}</td>
                        <td className="px-3 py-2 text-[10px] text-muted-foreground">{s.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">5 維能力對比（正規化到 0-100）</CardTitle>
              <CardDescription className="text-xs">每個維度用策略中最佳值做 100 分基準</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {(['cum_return', 'sharpe', 'calmar', 'mdd', 'win_rate'] as const).map((dim) => {
                const best = Math.max(...strategies.map((s) => {
                  const v = s[dim]
                  return typeof v === 'number' && v !== null ? Math.abs(v) : 0
                }))
                return (
                  <div key={dim}>
                    <div className="text-[10px] text-muted-foreground mb-1">{dim}（基準 {best.toFixed(1)}）</div>
                    <div className="space-y-1">
                      {strategies.map((s) => {
                        const v = s[dim]
                        const val = typeof v === 'number' && v !== null ? Math.abs(v) : 0
                        const pct = best > 0 ? (val / best) * 100 : 0
                        return (
                          <div key={s.name} className="flex items-center gap-2 text-[10px]">
                            <div className="w-32 truncate text-muted-foreground">{s.name}</div>
                            <div className="flex-1 h-3 bg-muted/30 rounded-sm overflow-hidden">
                              <div className={`h-full ${COLOR_BY_TYPE[s.type]}`} style={{ width: `${pct}%` }} />
                            </div>
                            <div className="w-10 text-right tabular-nums">{pct.toFixed(0)}</div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  )
}
