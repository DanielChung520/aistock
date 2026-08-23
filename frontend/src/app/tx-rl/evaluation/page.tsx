'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/app-shell'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AlertTriangle, Bot, Trophy, Download, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react'

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

const STRATEGIES: Strategy[] = [
  // 基準組
  { name: 'Buy & Hold 0050', type: 'benchmark', cum_return: 87.4, ann_return: 42.1, sharpe: 1.12, mdd: -32.5, calmar: 1.30, win_rate: null, num_trades: 1, pf: null, note: '散戶最佳選擇' },
  { name: 'Buy & Hold TWII', type: 'benchmark', cum_return: 112.7, ann_return: 54.2, sharpe: 1.28, mdd: -28.9, calmar: 1.87, win_rate: null, num_trades: 1, pf: null, note: '大盤 beta 追蹤' },
  // 規則型
  { name: 'MA5/MA20 Crossover', type: 'rule', cum_return: 24.6, ann_return: 11.8, sharpe: 0.48, mdd: -18.2, calmar: 0.65, win_rate: 58.2, num_trades: 87, pf: 1.24, note: '昨日實測 2454 結果' },
  { name: 'DanielMA (持有 2-4 週)', type: 'rule', cum_return: 45.3, ann_return: 21.8, sharpe: 0.82, mdd: -15.4, calmar: 1.41, win_rate: 54.5, num_trades: 11, pf: 1.68, note: '完整買→賣 11 筆平均 +10.7%' },
  // ML（你上輪的 4 組）
  { name: 'XGBoost 5d 多 ≥0.55', type: 'ml', cum_return: 2713.3, ann_return: 1304.6, sharpe: 2.34, mdd: -46.2, calmar: 28.2, win_rate: 70.9, num_trades: 368, pf: 2.34, note: 'in-sample 過擬合警告' },
  { name: 'XGBoost 5d OOS', type: 'ml', cum_return: 347.5, ann_return: 167.2, sharpe: 1.35, mdd: -99.6, calmar: 1.68, win_rate: 52.9, num_trades: 70, pf: 1.35, note: '真實 OOS 勝率≈隨機' },
  // RL（本次）
  { name: 'TX-RL Agent (本次)', type: 'rl', cum_return: 23.4, ann_return: 11.2, sharpe: 0.42, mdd: -18.3, calmar: 0.61, win_rate: 54.2, num_trades: 142, pf: 1.18, note: 'mock — 待 backend 實作' },
]

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

export default function TXRLEvaluationPage() {
  const router = useRouter()
  const [filterType, setFilterType] = useState<'all' | Strategy['type']>('all')

  const filtered = filterType === 'all' ? STRATEGIES : STRATEGIES.filter((s) => s.type === filterType)
  const txRL = STRATEGIES.find((s) => s.type === 'rl')!
  const buyHold0050 = STRATEGIES.find((s) => s.name === 'Buy & Hold 0050')!
  const alpha = txRL.ann_return - buyHold0050.ann_return

  return (
    <AppShell title="台指期 RL — 評估對照">
      <div className="flex flex-col h-full min-h-0 gap-4 p-4 lg:p-6">
        {/* 警告 Banner */}
        <Card className="shrink-0 border-amber-500/40 bg-amber-500/5">
          <CardContent className="pt-4 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <div className="text-xs">
              <div className="font-semibold text-amber-700 dark:text-amber-400">
                這個功能的目的是「學 RL」而非「賺錢」
              </div>
              <div className="text-amber-700/80 dark:text-amber-400/80 mt-1">
                7 個策略對照，TX-RL 目前是 mock。真實數據待 backend 實作後填入。
                學術共識：日頻 RL 極少打敗 Buy & Hold，這是預期結果。
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 標題 */}
        <div className="shrink-0 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold flex items-center gap-2">
              <Bot className="h-5 w-5 text-muted-foreground" />
              台指期 RL — 評估對照
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              與基準 / 規則 / 監督式 ML 全方位對比
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
          {/* 結論摘要 */}
          <Card className={alpha >= 0 ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-red-500/40 bg-red-500/5'}>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-2">
                {alpha >= 0 ? <Trophy className="h-4 w-4 text-emerald-500" /> : <AlertTriangle className="h-4 w-4 text-red-500" />}
                <h2 className="text-sm font-semibold">
                  TX-RL vs Buy & Hold 0050：年化 alpha = {alpha >= 0 ? '+' : ''}{alpha.toFixed(1)} 個百分點
                </h2>
              </div>
              <p className="text-xs text-muted-foreground">
                {alpha >= 0
                  ? `🎉 TX-RL 年化 ${txRL.ann_return}% 比 Buy & Hold 0050 (${buyHold0050.ann_return}%) 高 ${alpha.toFixed(1)}%。但注意：交易成本、MDD、Sharpe 仍需綜合判斷。`
                  : `TX-RL 年化 ${txRL.ann_return}% 比 Buy & Hold 0050 (${buyHold0050.ann_return}%) 低 ${Math.abs(alpha).toFixed(1)}%。這在學術上屬於「預期結果」——日頻 RL 鮮少打敗 Buy & Hold。重點是「學 RL 流程」而不是「賺錢」。`}
              </p>
            </CardContent>
          </Card>

          {/* 篩選 */}
          <Tabs value={filterType} onValueChange={(v) => setFilterType(v as typeof filterType)}>
            <TabsList>
              <TabsTrigger value="all">全部 ({STRATEGIES.length})</TabsTrigger>
              <TabsTrigger value="benchmark">基準</TabsTrigger>
              <TabsTrigger value="rule">規則</TabsTrigger>
              <TabsTrigger value="ml">ML</TabsTrigger>
              <TabsTrigger value="rl" className="text-amber-600 dark:text-amber-400">RL</TabsTrigger>
            </TabsList>
          </Tabs>

          {/* 對照表 */}
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

          {/* 5 維雷達圖（純文字版） */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">5 維能力對比（正規化到 0-100）</CardTitle>
                <CardDescription className="text-xs">每個維度用策略中最佳值做 100 分基準</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2.5">
                {(['cum_return', 'sharpe', 'calmar', 'mdd', 'win_rate'] as const).map((dim) => {
                  const best = Math.max(...STRATEGIES.map((s) => {
                    const v = s[dim]
                    return typeof v === 'number' && v !== null ? Math.abs(v) : 0
                  }))
                  return (
                    <div key={dim}>
                      <div className="text-[10px] text-muted-foreground mb-1">{dim}（基準 {best.toFixed(1)}）</div>
                      <div className="space-y-1">
                        {STRATEGIES.map((s) => {
                          const v = s[dim]
                          const val = typeof v === 'number' && v !== null ? Math.abs(v) : 0
                          const pct = best > 0 ? (val / best) * 100 : 0
                          return (
                            <div key={s.name} className="flex items-center gap-2 text-[10px]">
                              <div className="w-32 truncate text-muted-foreground">{s.name}</div>
                              <div className="flex-1 h-3 bg-muted/30 rounded-sm overflow-hidden">
                                <div
                                  className={`h-full ${COLOR_BY_TYPE[s.type]}`}
                                  style={{ width: `${pct}%` }}
                                />
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

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">誠實聲明（DoD 內建）</CardTitle>
                <CardDescription className="text-xs">不論結果如何，這些是預期</CardDescription>
              </CardHeader>
              <CardContent className="text-xs space-y-3">
                <div>
                  <div className="font-semibold text-amber-700 dark:text-amber-400">⚠️ RL 在台指期日頻的歷史實證效果有限</div>
                  <ul className="mt-2 space-y-1 text-muted-foreground list-disc list-inside">
                    <li>學術文獻：日頻 RL agent 鮮少持續打贏 Buy & Hold</li>
                    <li>我們的 ML 測試：XGBoost OOS 勝率 56.9%（≈ 隨機）</li>
                    <li>散戶劣勢：execution gap 0.3% × 2、單台電腦、無 co-location</li>
                  </ul>
                </div>
                <div className="border-t border-border/50 pt-3">
                  <div className="font-semibold text-emerald-700 dark:text-emerald-400">✅ 預期結果（pass-to-accept 標準）</div>
                  <ul className="mt-2 space-y-1 text-muted-foreground list-disc list-inside">
                    <li>TX-RL 流程可重現（seed=42 ±5%）</li>
                    <li>Walk-forward 3 段以上結果記錄</li>
                    <li>4 個策略對照表完整</li>
                    <li>誠實對待 OOS 結果（不隱藏失敗）</li>
                  </ul>
                </div>
                <div className="border-t border-border/50 pt-3">
                  <div className="font-semibold">📚 學習價值</div>
                  <ul className="mt-2 space-y-1 text-muted-foreground list-disc list-inside">
                    <li>學會 Gymnasium 環境設計、stable-baselines3 訓練</li>
                    <li>理解 state / action / reward 設計的 trade-off</li>
                    <li>建立「誠實對照 baseline」的習慣</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
