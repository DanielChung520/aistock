'use client'

import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/app-shell'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AlertTriangle, Bot, TrendingUp, TrendingDown, BarChart3, ChevronRight } from 'lucide-react'

const METRICS = {
  cumulative_return: 23.4,
  annualized_return: 11.2,
  sharpe: 0.42,
  max_drawdown: -18.3,
  calmar: 0.61,
  win_rate: 54.2,
  profit_factor: 1.18,
  num_trades: 142,
  avg_trade_pnl: 0.038,
}

// 模擬每日 PnL（用 sin 模擬 equity curve）
const EQUITY_DATA = Array.from({ length: 495 }, (_, i) => {
  const t = i / 495
  const trend = 1 + t * 0.234
  const cycle = 1 + Math.sin(t * Math.PI * 4) * 0.04
  const noise = 1 + (Math.random() - 0.5) * 0.02
  return { day: i, equity: trend * cycle * noise, drawdown: Math.min(0, -Math.abs(Math.sin(t * Math.PI * 6)) * 0.18) }
})

const TRADE_EXAMPLES = [
  { date: '2024-09-12', action: 'Buy', entry: 21250, exit: 21480, pnl: 46000, hold_days: 5 },
  { date: '2024-10-05', action: 'Sell', entry: 22800, exit: 22450, pnl: 70000, hold_days: 3 },
  { date: '2024-11-18', action: 'Buy', entry: 22100, exit: 22350, pnl: 50000, hold_days: 7 },
  { date: '2025-01-22', action: 'Buy', entry: 23500, exit: 23200, pnl: -60000, hold_days: 4 },
  { date: '2025-03-10', action: 'Sell', entry: 23800, exit: 23600, pnl: 40000, hold_days: 6 },
  { date: '2025-05-15', action: 'Buy', entry: 21400, exit: 21900, pnl: 100000, hold_days: 8 },
  { date: '2025-07-08', action: 'Buy', entry: 24200, exit: 23850, pnl: -70000, hold_days: 5 },
  { date: '2025-09-20', action: 'Sell', entry: 26100, exit: 26450, pnl: 70000, hold_days: 4 },
]

export default function TXRLBacktestPage() {
  const router = useRouter()

  return (
    <AppShell title="台指期 RL — 回測結果">
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
                目前為 mock 數據。真實結果待 SPEC 確認 + Celery 實作後填入。
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 標題 */}
        <div className="shrink-0 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold flex items-center gap-2">
              <Bot className="h-5 w-5 text-muted-foreground" />
              台指期 RL — 回測結果
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              TWII 495 天測試區間（mock 資料）
            </p>
          </div>
          <Button onClick={() => router.push('/tx-rl/evaluation')}>
            與 Buy & Hold 對照
            <ChevronRight className="h-3.5 w-3.5 ml-1" />
          </Button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto grid grid-cols-1 lg:grid-cols-3 gap-4 pb-4">
          {/* 權益曲線 */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">權益曲線（mock）</CardTitle>
              <CardDescription className="text-xs">初始資金 100 萬，1 口 × 200 元/點，扣 0.3% × 2 滑價</CardDescription>
            </CardHeader>
            <CardContent>
              <EquityChart data={EQUITY_DATA} />
              <div className="grid grid-cols-3 gap-3 mt-3 pt-3 border-t border-border/50">
                <MetricBox label="累積報酬" value={`+${METRICS.cumulative_return}%`} tone="good" />
                <MetricBox label="年化" value={`+${METRICS.annualized_return}%`} tone="good" />
                <MetricBox label="MDD" value={`${METRICS.max_drawdown}%`} tone="bad" />
              </div>
            </CardContent>
          </Card>

          {/* 風險指標 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">風險指標</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Row label="Sharpe" value={METRICS.sharpe.toFixed(2)} />
              <Row label="Calmar" value={METRICS.calmar.toFixed(2)} />
              <Row label="勝率" value={`${METRICS.win_rate}%`} />
              <Row label="Profit Factor" value={METRICS.profit_factor.toFixed(2)} />
              <Row label="交易次數" value={METRICS.num_trades.toString()} />
              <Row label="平均損益/筆" value={`${METRICS.avg_trade_pnl > 0 ? '+' : ''}${METRICS.avg_trade_pnl}%`} />
            </CardContent>
          </Card>

          {/* 交易明細 */}
          <Card className="lg:col-span-3">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <BarChart3 className="h-4 w-4" /> 交易明細（最近 8 筆，mock）
              </CardTitle>
            </CardHeader>
            <CardContent>
              <table className="w-full text-xs">
                <thead className="text-muted-foreground border-b">
                  <tr>
                    <th className="text-left px-2 py-1.5">日期</th>
                    <th className="text-left px-2 py-1.5">動作</th>
                    <th className="text-right px-2 py-1.5">進場</th>
                    <th className="text-right px-2 py-1.5">出場</th>
                    <th className="text-right px-2 py-1.5">損益（元）</th>
                    <th className="text-right px-2 py-1.5">持有天數</th>
                  </tr>
                </thead>
                <tbody>
                  {TRADE_EXAMPLES.map((t, i) => (
                    <tr key={i} className="border-b border-border/30">
                      <td className="px-2 py-1.5 font-mono text-[11px]">{t.date}</td>
                      <td className="px-2 py-1.5">
                        <Badge variant={t.action === 'Buy' ? 'default' : 'secondary'} className="text-[10px]">
                          {t.action === 'Buy' ? <TrendingUp className="h-3 w-3 mr-0.5" /> : <TrendingDown className="h-3 w-3 mr-0.5" />}
                          {t.action}
                        </Badge>
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{t.entry.toLocaleString()}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{t.exit.toLocaleString()}</td>
                      <td className={`px-2 py-1.5 text-right tabular-nums font-bold ${t.pnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                        {t.pnl >= 0 ? '+' : ''}{t.pnl.toLocaleString()}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{t.hold_days}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-xs py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-medium tabular-nums">{value}</span>
    </div>
  )
}

function MetricBox({ label, value, tone }: { label: string; value: string; tone: 'good' | 'bad' | 'neutral' }) {
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

function EquityChart({ data }: { data: { day: number; equity: number; drawdown: number }[] }) {
  const w = 800; const h = 200; const pad = 12
  const maxE = Math.max(...data.map((d) => d.equity))
  const minDD = Math.min(...data.map((d) => d.drawdown))
  const equityPath = data.map((d, i) => {
    const x = pad + (i / (data.length - 1)) * (w - 2 * pad)
    const y = h - pad - ((d.equity - 1) / (maxE - 1)) * (h * 0.6)
    return `${x},${y}`
  }).join(' ')
  const ddPath = data.map((d, i) => {
    const x = pad + (i / (data.length - 1)) * (w - 2 * pad)
    const y = h * 0.4 - pad - (d.drawdown / minDD) * (h * 0.3)
    return `${x},${y}`
  }).join(' ')
  return (
    <div className="rounded border bg-muted/10 p-2">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-48" preserveAspectRatio="none">
        <text x={pad} y={pad + 10} fontSize="10" fill="#3b82f6">權益曲線</text>
        <text x={pad} y={h * 0.4 + 10} fontSize="10" fill="#ef4444">回撤</text>
        <line x1={pad} y1={h * 0.4} x2={w - pad} y2={h * 0.4} stroke="#e5e7eb" strokeDasharray="2,2" />
        <polyline fill="none" stroke="#3b82f6" strokeWidth="1.5" points={equityPath} />
        <polyline fill="none" stroke="#ef4444" strokeWidth="1" points={ddPath} opacity="0.6" />
      </svg>
    </div>
  )
}
