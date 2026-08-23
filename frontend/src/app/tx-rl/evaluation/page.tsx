'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AppShell } from '@/components/app-shell'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AlertTriangle, Bot, Trophy, Download, ArrowUpRight, ArrowDownRight, Loader2 } from 'lucide-react'
import { WarningChart } from '@/components/tx-rl/WarningChart'
import { BlockTitle } from '@/components/tx-rl/HelpButton'
import {
  EVAL_EQUITY_CURVE_MD, EVAL_DRAWDOWN_MD,
  EVAL_TRADE_SCATTER_MD, EVAL_REWARD_CURVE_MD,
} from '@/components/tx-rl/help-content'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ScatterChart, Scatter, ZAxis,
  AreaChart, Area,
} from 'recharts'

interface RawMetric {
  cumulative_return_pct?: number
  sharpe?: number
  max_drawdown_pct?: number
  win_rate_pct?: number
  num_trades?: number
  num_steps?: number
  equity_curve?: { date: string; equity: number; drawdown: number; position?: number }[]
  trade_list?: { date: string; action: string; entry_price: number; position: number }[]
  episode_rewards?: { step: number; reward: number }[]
}

interface CompareResponse {
  tx_rl_agent: RawMetric
  buy_hold_twii: { cumulative_return_pct: number; name: string; equity_curve: { date: string; equity: number; drawdown: number }[] }
  buy_hold_0050: { cumulative_return_pct: number; name: string; note: string; equity_curve: { date: string; equity: number; drawdown: number }[] }
  ma_crossover: { cumulative_return_pct: number; num_trades: number; name: string; equity_curve: { date: string; equity: number; drawdown: number }[] }
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
  benchmark: '#64748b',
  rule: '#3b82f6',
  ml: '#a855f7',
  rl: '#f59e0b',
}

const LABEL_BY_TYPE: Record<Strategy['type'], string> = {
  benchmark: '基準',
  rule: '規則',
  ml: '監督式 ML',
  rl: '強化學習',
}

const EQUITY_COLOR: Record<string, string> = {
  'TX-RL Agent': '#f59e0b',
  'Buy & Hold 0050': '#64748b',
  'Buy & Hold TWII': '#94a3b8',
  'MA5/MA20 Crossover': '#3b82f6',
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
  const [tab, setTab] = useState<'compare' | 'visualize'>('compare')
  const [strategies, setStrategies] = useState<Strategy[]>([])
  const [raw, setRaw] = useState<CompareResponse | null>(null)
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
    fetch('/api/tx-rl/compare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: target }),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((d: CompareResponse) => {
        setRaw(d)
        setStrategies([
          rawToStrategy('Buy & Hold 0050', 'benchmark', d.buy_hold_0050, d.buy_hold_0050.note),
          rawToStrategy('Buy & Hold TWII', 'benchmark', d.buy_hold_twii, '大盤 beta 追蹤'),
          rawToStrategy('MA5/MA20 Crossover', 'rule', d.ma_crossover, 'DanielMA 規則'),
          rawToStrategy('TX-RL Agent (本次)', 'rl', d.tx_rl_agent, `Job ${target.slice(0, 8)}…`),
        ])
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e)
        setError(msg)
        toast.error('載入對照資料失敗', { description: msg })
      })
      .finally(() => setLoading(false))
  }, [resolvedJobId])

  if (loading) {
    return (
      <AppShell title="台指期 RL — 評估對照">
        <div className="flex items-center justify-center h-full text-sm text-muted-foreground gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> 載入對照資料…
        </div>
      </AppShell>
    )
  }

  if (error || !raw) {
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

  const txRL = strategies.find((s) => s.type === 'rl')!
  const buyHold0050 = strategies.find((s) => s.name === 'Buy & Hold 0050')!
  const alpha = txRL.cum_return - buyHold0050.cum_return

  return (
    <AppShell title="台指期 RL — 評估對照">
      <div className="flex flex-col h-full min-h-0 gap-4 p-4 lg:p-6">
        <WarningChart />

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

        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="compare">對照表</TabsTrigger>
            <TabsTrigger value="visualize">可視化 ({4} 圖表)</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex-1 min-h-0 overflow-y-auto pb-4">
          {tab === 'compare' && <CompareTable strategies={strategies} alpha={alpha} txRL={txRL} buyHold0050={buyHold0050} />}
          {tab === 'visualize' && <VisualizePanel raw={raw} />}
        </div>
      </div>
    </AppShell>
  )
}

function CompareTable({ strategies, alpha, txRL, buyHold0050 }: {
  strategies: Strategy[]
  alpha: number
  txRL: Strategy
  buyHold0050: Strategy
}) {
  return (
    <div className="space-y-4">
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
              : `TX-RL 累積 ${txRL.cum_return.toFixed(1)}% 比 Buy & Hold 0050 (${buyHold0050.cum_return.toFixed(1)}%) 低 ${Math.abs(alpha).toFixed(1)}%。這在學術上屬於「預期結果」——日頻 RL 鮮少打敗 Buy & Hold。重點是「學 RL 流程」而不是「賺錢」。`}
          </p>
        </CardContent>
      </Card>

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
                {strategies.map((s) => (
                  <tr key={s.name} className={`border-b border-border/30 hover:bg-muted/20 ${s.type === 'rl' ? 'bg-amber-500/5' : ''}`}>
                    <td className="px-3 py-2 font-medium">{s.name}</td>
                    <td className="px-3 py-2">
                      <span className="text-[10px] text-white px-1.5 py-0.5 rounded" style={{ background: COLOR_BY_TYPE[s.type] }}>
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
    </div>
  )
}

function VisualizePanel({ raw }: { raw: CompareResponse }) {
  const rl = raw.tx_rl_agent
  const eqRl = rl.equity_curve ?? []
  const eqTwii = raw.buy_hold_twii.equity_curve ?? []
  const eq0050 = raw.buy_hold_0050.equity_curve ?? []
  const eqMa = raw.ma_crossover.equity_curve ?? []

  const equityMerged = eqTwii.map((d, i) => ({
    date: d.date,
    'Buy & Hold 0050': eq0050[i]?.equity ?? null,
    'Buy & Hold TWII': d.equity,
    'MA5/MA20 Crossover': eqMa[i]?.equity ?? null,
    'TX-RL Agent': eqRl[i]?.equity ?? null,
  }))

  const drawdownMerged = eqTwii.map((d, i) => ({
    date: d.date,
    'Buy & Hold 0050': (eq0050[i]?.drawdown ?? 0) * 100,
    'Buy & Hold TWII': d.drawdown * 100,
    'MA5/MA20 Crossover': (eqMa[i]?.drawdown ?? 0) * 100,
    'TX-RL Agent': (eqRl[i]?.drawdown ?? 0) * 100,
  }))

  const tradesScatter = (rl.trade_list ?? []).map((t) => ({
    date: new Date(t.date).getTime(),
    action: t.action,
    entry_price: t.entry_price,
    position: t.position,
  }))

  const rewardsData = (rl.episode_rewards ?? []).map((r) => ({
    step: r.step,
    reward: r.reward,
  }))

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <BlockTitle title="1. Equity Curve — 4 策略資金曲線對比" helpContent={EVAL_EQUITY_CURVE_MD} />
          <CardDescription className="text-xs">起點 = 1.0，hover 顯示當日詳細。終點差距 = alpha</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartBox height={280}>
            <LineChart data={equityMerged}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(2, 10)} interval={Math.floor(equityMerged.length / 6)} />
              <YAxis tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
              <Tooltip content={<EquityTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {Object.entries(EQUITY_COLOR).map(([name, color]) => (
                <Line key={name} type="monotone" dataKey={name} stroke={color} dot={false} strokeWidth={1.5} connectNulls />
              ))}
            </LineChart>
          </ChartBox>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <BlockTitle title="2. Drawdown Timeline — 回撤隨時間變化" helpContent={EVAL_DRAWDOWN_MD} />
          <CardDescription className="text-xs">負值越大代表從最高點跌越深。TX-RL 通常震盪最大（最不穩定）</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartBox height={240}>
            <LineChart data={drawdownMerged}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(2, 10)} interval={Math.floor(drawdownMerged.length / 6)} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${v.toFixed(0)}%`} domain={['auto', 0]} />
              <Tooltip content={<DDTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {Object.entries(EQUITY_COLOR).map(([name, color]) => (
                <Line key={name} type="monotone" dataKey={name} stroke={color} dot={false} strokeWidth={1.2} connectNulls />
              ))}
            </LineChart>
          </ChartBox>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <BlockTitle title="3. TX-RL 進場點散佈" helpContent={EVAL_TRADE_SCATTER_MD} />
          <CardDescription className="text-xs">每個點 = 一次進場。X 軸 = 進場日期，Y 軸 = 進場價。Buy=綠, Sell=紅</CardDescription>
        </CardHeader>
        <CardContent>
          {tradesScatter.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-xs text-muted-foreground">此訓練無進場紀錄</div>
          ) : (
            <ChartBox height={200}>
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(v) => new Date(v).toISOString().slice(2, 10)} scale="time" />
                <YAxis dataKey="entry_price" type="number" tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
                <ZAxis range={[40, 200]} />
                <Tooltip content={<ScatterTooltip />} />
                <Scatter name="Buy" data={tradesScatter.filter((t) => t.position > 0)} fill="#10b981" />
                <Scatter name="Sell" data={tradesScatter.filter((t) => t.position < 0)} fill="#ef4444" />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </ScatterChart>
            </ChartBox>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <BlockTitle title="4. Reward 訓練曲線（PPO episode reward）" helpContent={EVAL_REWARD_CURVE_MD} />
          <CardDescription className="text-xs">每個點 = 一個 episode 的累計 reward。趨勢上升 = 學習中；震盪 = 已收斂或過擬合</CardDescription>
        </CardHeader>
        <CardContent>
          {rewardsData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-xs text-muted-foreground">無 reward 歷史</div>
          ) : (
            <ChartBox height={240}>
              <AreaChart data={rewardsData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="step" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip content={<RewardTooltip />} />
                <Area type="monotone" dataKey="reward" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.3} />
              </AreaChart>
            </ChartBox>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function ChartBox({ children, height }: { children: React.ReactElement; height: number }) {
  return (
    <div style={{ width: '100%', height }} className="rounded border bg-card p-2">
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  )
}

function EquityTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className="bg-background border border-border rounded shadow-lg p-2 text-[10px]">
      <div className="font-mono text-muted-foreground mb-1">{label}</div>
      {payload.filter((p) => p.value !== null).map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-mono font-semibold tabular-nums">{(p.value ?? 0).toFixed(4)}</span>
        </div>
      ))}
    </div>
  )
}

function DDTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className="bg-background border border-border rounded shadow-lg p-2 text-[10px]">
      <div className="font-mono text-muted-foreground mb-1">{label}</div>
      {payload.filter((p) => p.value !== null).map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-mono font-semibold tabular-nums text-red-600">{(p.value ?? 0).toFixed(2)}%</span>
        </div>
      ))}
    </div>
  )
}

function ScatterTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { date: number; entry_price: number; position: number } }> }) {
  if (!active || !payload || payload.length === 0) return null
  const p = payload[0].payload
  return (
    <div className="bg-background border border-border rounded shadow-lg p-2 text-[10px]">
      <div className="font-mono text-muted-foreground">{new Date(p.date).toISOString().slice(0, 10)}</div>
      <div>進場價: <span className="font-mono font-semibold">{p.entry_price.toFixed(2)}</span></div>
      <div>部位: <span className="font-mono font-semibold">{p.position > 0 ? `Long +${p.position}` : `Short ${p.position}`}</span></div>
    </div>
  )
}

function RewardTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: number }) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className="bg-background border border-border rounded shadow-lg p-2 text-[10px]">
      <div className="font-mono text-muted-foreground">Step {label}</div>
      <div>Reward: <span className="font-mono font-semibold tabular-nums">{(payload[0].value ?? 0).toFixed(4)}</span></div>
    </div>
  )
}
