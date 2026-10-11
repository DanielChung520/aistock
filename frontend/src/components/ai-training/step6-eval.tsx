'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { AlertCircle, Save, RotateCcw, Loader2, CheckCircle2 } from 'lucide-react'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import type { ModelType } from './step1-model'
import type { Target } from './step3-target'
import type { TrainStatus } from './step5-training'

interface SplitMetrics {
  mae?: number
  rmse?: number
  r2?: number
  win_rate?: number
  accuracy?: number
  auc?: number | null
  f1?: number
}

interface Metrics {
  train: SplitMetrics
  val: SplitMetrics
  test: SplitMetrics
}

interface BacktestPoint {
  date: string
  y: number
  pred: number
}

interface BacktestSplit {
  days?: number
  total_return_pct?: number
  win_rate_pct?: number
  max_drawdown_pct?: number
  trades?: number
  buys?: number
  sells?: number
  profit_factor?: number | null
  buy_threshold?: number
  sell_threshold?: number
  precision_at_threshold?: number
  recall_at_threshold?: number
  series?: BacktestPoint[]
}

interface BacktestResults {
  val: BacktestSplit
  test: BacktestSplit
  thresholds?: { buy_pct?: number; sell_pct?: number }
}

const chartConfig = {
  y: {
    label: '目標值 (y)',
    color: '#3b82f6',
  },
  pred: {
    label: '預測值 (pred)',
    color: '#f59e0b',
  },
} satisfies ChartConfig

const PRESET_TAGS = ['baseline', 'production', 'experimental', 'retired']

export function Step6Evaluation({
  model,
  target,
  metrics,
  trainStatus,
  backtestResults,
  onRunBacktest,
  onSaveModel,
  onRestart,
  saved,
}: {
  model: ModelType
  target: Target
  metrics: Metrics | null
  trainStatus: TrainStatus
  backtestResults?: BacktestResults | null
  onRunBacktest?: (buyPct: number, sellPct: number) => Promise<unknown>
  onSaveModel?: (name: string, description: string, tags: string[]) => Promise<unknown>
  onRestart?: () => void
  saved?: boolean
}) {
  const [buyThresh, setBuyThresh] = useState(0.5)
  const [sellThresh, setSellThresh] = useState(-0.5)
  const [backtesting, setBacktesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [period, setPeriod] = useState<'val' | 'test'>('val')
  const [name, setName] = useState(`${model.toUpperCase()}-v1-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`)
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState<string[]>([])

  const isRegression = target === 'next_return' || target === 'next_5d_return'
  const hasMetrics = metrics !== null && trainStatus === 'completed'
  const hasBacktest = backtestResults !== null && backtestResults !== undefined
  const canBacktest = hasMetrics && isRegression

  const fmt = (v: number | null | undefined, digits = 4) =>
    v === null || v === undefined ? '—' : v.toFixed(digits)
  const fmtPct = (v: number | null | undefined) =>
    v === null || v === undefined ? '—' : `${v.toFixed(2)}%`

  // 過擬合偵測（§十一）：train 指標遠優於 val/test → 警告
  const overfitGap =
    hasMetrics && metrics?.val.r2 !== undefined && metrics?.train.r2 !== undefined
      ? metrics.train.r2 - metrics.val.r2
      : null
  const showOverfit = overfitGap !== null && overfitGap > 0.2

  const rerun = async () => {
    if (!onRunBacktest) return
    setBacktesting(true)
    try {
      await onRunBacktest(buyThresh, sellThresh)
    } finally {
      setBacktesting(false)
    }
  }

  const toggleTag = (t: string) => {
    setTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))
  }

  const saveModel = async () => {
    if (!onSaveModel) return
    setSaving(true)
    try {
      await onSaveModel(name, description, tags)
    } finally {
      setSaving(false)
    }
  }

  const btVal = backtestResults?.val
  const btTest = backtestResults?.test

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Step 6 / 6：回測與模型評估</h2>
        <p className="text-xs text-muted-foreground mt-1">
          雙軌指標：ML 軌（擬合能力）+ 回測軌（實務交易價值）
        </p>
      </div>

      {/* ── 回測訊號閾值 ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">回測訊號閾值</CardTitle>
          <CardDescription className="text-xs">依預測值轉交易訊號：&gt; buy 閾值 → 買；&lt; sell 閾值 → 賣</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 max-w-md">
            <div>
              <Label className="text-xs text-muted-foreground">Buy 閾值 (%)</Label>
              <Input
                type="number"
                step={0.1}
                value={buyThresh}
                onChange={(e) => setBuyThresh(parseFloat(e.target.value) || 0)}
                className="h-8 text-xs"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Sell 閾值 (%)</Label>
              <Input
                type="number"
                step={0.1}
                value={sellThresh}
                onChange={(e) => setSellThresh(parseFloat(e.target.value) || 0)}
                className="h-8 text-xs"
              />
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="mt-2"
            disabled={!canBacktest || backtesting}
            onClick={rerun}
            title={canBacktest ? '以目前閾值重新計算回測' : '分類目標不支援回測'}
          >
            {backtesting ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5 mr-1" />
            )}
            重新回測
          </Button>
        </CardContent>
      </Card>

      {/* ── ML 軌 ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            🤖 ML 軌（模型擬合能力）
            {hasMetrics ? (
              <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-500/40">
                已計算
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px]">訓練完成後顯示</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left py-2 pr-3">指標</th>
                  <th className="text-right py-2 px-3">Train</th>
                  <th className="text-right py-2 px-3">Val</th>
                  <th className="text-right py-2 pl-3">Test</th>
                </tr>
              </thead>
              <tbody className="font-mono tabular-nums">
                {isRegression ? (
                  <>
                    <MetricRow label="MAE" v={[fmt(metrics?.train.mae), fmt(metrics?.val.mae), fmt(metrics?.test.mae)]} />
                    <MetricRow label="RMSE" v={[fmt(metrics?.train.rmse), fmt(metrics?.val.rmse), fmt(metrics?.test.rmse)]} />
                    <MetricRow label="R²" v={[fmt(metrics?.train.r2, 3), fmt(metrics?.val.r2, 3), fmt(metrics?.test.r2, 3)]} />
                    <MetricRow label="勝率(>0)" v={[fmtPct(metrics?.train.win_rate), fmtPct(metrics?.val.win_rate), fmtPct(metrics?.test.win_rate)]} />
                  </>
                ) : (
                  <>
                    <MetricRow label="Accuracy" v={[fmt(metrics?.train.accuracy, 3), fmt(metrics?.val.accuracy, 3), fmt(metrics?.test.accuracy, 3)]} />
                    <MetricRow label="AUC" v={[fmt(metrics?.train.auc, 3), fmt(metrics?.val.auc, 3), fmt(metrics?.test.auc, 3)]} />
                    <MetricRow label="F1" v={[fmt(metrics?.train.f1, 3), fmt(metrics?.val.f1, 3), fmt(metrics?.test.f1, 3)]} />
                  </>
                )}
              </tbody>
            </table>
          </div>
          {!hasMetrics && (
            <p className="text-[11px] text-muted-foreground mt-2">ⓘ 完成 Step 5 訓練後自動填入真實指標</p>
          )}
        </CardContent>
      </Card>

      {/* ── 回測軌 ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            📈 回測軌（實務交易價值）
            {hasBacktest ? (
              <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-500/40">
                已計算
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px]">
                {hasMetrics ? '回測待計算' : '訓練完成後顯示'}
              </Badge>
            )}
          </CardTitle>
          <CardDescription className="text-xs">
            模型預測值轉訊號：&gt; buy 閾值 → 買進；&lt; sell 閾值 → 賣出（每日多股票等權聚合）
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left py-2 pr-3">指標</th>
                  <th className="text-right py-2 px-3">Val Period</th>
                  <th className="text-right py-2 pl-3">Test Period</th>
                </tr>
              </thead>
              <tbody className="font-mono tabular-nums">
                <MetricRow label="總報酬" v={[fmtPct(btVal?.total_return_pct), fmtPct(btTest?.total_return_pct)]} />
                <MetricRow label="勝率" v={[fmtPct(btVal?.win_rate_pct), fmtPct(btTest?.win_rate_pct)]} />
                <MetricRow label="最大回撤" v={[fmtPct(btVal?.max_drawdown_pct), fmtPct(btTest?.max_drawdown_pct)]} />
                <MetricRow label="交易次數" v={[fmt(btVal?.trades, 0), fmt(btTest?.trades, 0)]} />
                <MetricRow label="盈虧比" v={[fmt(btVal?.profit_factor, 2), fmt(btTest?.profit_factor, 2)]} />
                <MetricRow label="Precision" v={[fmtPct(btVal?.precision_at_threshold != null ? btVal.precision_at_threshold * 100 : null), fmtPct(btTest?.precision_at_threshold != null ? btTest.precision_at_threshold * 100 : null)]} />
                <MetricRow label="Recall" v={[fmtPct(btVal?.recall_at_threshold != null ? btVal.recall_at_threshold * 100 : null), fmtPct(btTest?.recall_at_threshold != null ? btTest.recall_at_threshold * 100 : null)]} />
                <MetricRow label="交易日數" v={[fmt(btVal?.days, 0), fmt(btTest?.days, 0)]} />
              </tbody>
            </table>
          </div>
          {hasBacktest && backtestResults?.thresholds && (
            <p className="text-[11px] text-muted-foreground mt-2">
              ⓘ 目前閾值：buy {backtestResults.thresholds.buy_pct}% · sell {backtestResults.thresholds.sell_pct}%
            </p>
          )}
          {!hasBacktest && hasMetrics && (
            <p className="text-[11px] text-muted-foreground mt-2">
              {isRegression
                ? 'ⓘ 按「重新回測」以目前閾值計算'
                : 'ⓘ 分類目標不支援報酬率回測'}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── 預測值 vs 目標值 ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            📊 預測值 vs 目標值
            {hasBacktest && (btVal?.series || btTest?.series) ? (
              <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-500/40">
                已計算
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px]">
                訓練完成後顯示
              </Badge>
            )}
          </CardTitle>
          <CardDescription className="text-xs">
            每日多股票等權聚合：藍線為實際目標值 (y)，橘線為模型預測值 (pred)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {hasBacktest ? (
            <>
              <div className="flex items-center gap-1 mb-2">
                {(['val', 'test'] as const).map((p) => (
                  <Button
                    key={p}
                    size="sm"
                    variant={period === p ? 'default' : 'outline'}
                    className="h-7 px-3 text-xs"
                    onClick={() => setPeriod(p)}
                  >
                    {p === 'val' ? 'Val Period' : 'Test Period'}
                  </Button>
                ))}
              </div>
              <ChartContainer config={chartConfig} className="h-56 w-full">
                <LineChart
                  data={backtestResults?.[period]?.series ?? []}
                  margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
                  accessibilityLayer
                >
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    minTickGap={40}
                    tickFormatter={(v: string) => v.slice(5)}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={50}
                    tickFormatter={(v: number) => v.toFixed(3)}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line
                    dataKey="y"
                    type="monotone"
                    stroke="var(--color-y)"
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                  <Line
                    dataKey="pred"
                    type="monotone"
                    stroke="var(--color-pred)"
                    strokeWidth={2}
                    strokeDasharray="4 3"
                    dot={false}
                    connectNulls
                  />
                </LineChart>
              </ChartContainer>
              <p className="text-[11px] text-muted-foreground mt-2">
                ⓘ 切換 Val / Test 檢視不同期間的擬合趨勢
              </p>
            </>
          ) : (
            <div className="h-40 rounded border border-dashed bg-muted/20 flex items-center justify-center text-xs text-muted-foreground">
              {hasMetrics && isRegression ? (
                <div className="flex flex-col items-center gap-2">
                  <span>重新回測以產生預測值 vs 目標值圖表</span>
                  <Button size="sm" variant="outline" disabled={backtesting} onClick={rerun}>
                    {backtesting ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                    ) : (
                      <RotateCcw className="h-3.5 w-3.5 mr-1" />
                    )}
                    重新回測
                  </Button>
                </div>
              ) : hasMetrics ? (
                '分類目標不支援預測值 vs 目標值圖表'
              ) : (
                '完成 Step 5 訓練後顯示預測值 vs 目標值圖表'
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── 過擬合警告 ── */}
      {hasMetrics && (
        <Card className={showOverfit ? 'border-amber-500/30 bg-amber-500/5' : 'border-emerald-500/30 bg-emerald-500/5'}>
          <CardContent className="pt-4 flex items-start gap-2">
            <AlertCircle className={`h-4 w-4 shrink-0 mt-0.5 ${showOverfit ? 'text-amber-500' : 'text-emerald-500'}`} />
            <div className="text-xs">
              {showOverfit ? (
                <span className="text-amber-600 dark:text-amber-400">
                  過擬合警示：train R² = {fmt(metrics.train.r2, 3)} 遠高於 val R² = {fmt(metrics.val.r2, 3)}（差距 {fmt(overfitGap, 2)}）。
                  建議增加資料、降低 max_depth / n_estimators 或加入 regularisation。
                </span>
              ) : (
                <span className="text-emerald-600 dark:text-emerald-400">
                  train 與 val 指標差距正常（{fmt(overfitGap ?? 0, 2)} ≤ 0.2），未偵測到明顯過擬合。
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── 儲存模型 ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">儲存模型</CardTitle>
          <CardDescription className="text-xs">寫入 model_artifacts collection（含 metadata + scaler）</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">模型名稱</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-8 text-xs max-w-md"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">描述（選填）</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={`${model.toUpperCase()} 基線，89 欄特徵，70/15/15`}
              className="h-8 text-xs max-w-md"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Tags（多選）</Label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {PRESET_TAGS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleTag(t)}
                  className={
                    'text-[11px] px-2 py-0.5 rounded-full border transition-colors ' +
                    (tags.includes(t)
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background text-muted-foreground border-border hover:border-primary/50')
                  }
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={!hasMetrics || saving || !!saved} onClick={saveModel}>
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : saved ? (
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
              ) : (
                <Save className="h-3.5 w-3.5 mr-1" />
              )}
              {saved ? '已儲存' : '儲存模型'}
            </Button>
            <Button size="sm" variant="outline" onClick={onRestart} disabled={saving || backtesting}>
              不儲存，重來
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function MetricRow({ label, v }: { label: string; v: string[] }) {
  return (
    <tr className="border-b border-border/50">
      <td className="py-1.5 pr-3 text-muted-foreground">{label}</td>
      {v.map((x, i) => (
        <td key={i} className="py-1.5 px-3 text-right">
          {x}
        </td>
      ))}
    </tr>
  )
}
