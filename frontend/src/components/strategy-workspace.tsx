'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { StrategyEditorModal } from '@/components/strategy-editor-modal'
import {
  MoreVertical,
  Plus,
  TrendingUp,
  Loader2,
  ArrowLeft,
  Clock,
  ChevronRight,
  Layers,
  History,
} from 'lucide-react'

interface ConditionSpec {
  metric: string
  op: string
  value: number | string | null
  note: string
  tf?: string
}

interface StrategyCard {
  id: string
  name: string
  description: string
  conditions: ConditionSpec[]
  source?: string
}

interface ScreenResult {
  stock_id: string
  name?: string | null
  market?: string | null
  price: number | null
  score: number
  passed_count: number
  total_conditions: number
}

interface ScreenResponse {
  total: number
  scanned: number
  results: ScreenResult[]
  conditions: ConditionSpec[]
}

interface RunHit {
  stock_id: string
  name: string
  price: number | null
  score: number
  passed_count: number
  total_conditions: number
}

interface RunMeta {
  id: string
  strategy_id: string | null
  strategy_name: string
  conditions: ConditionSpec[]
  scope: string
  source: string
  executed_at: number
  count: number
}

interface RunFull extends RunMeta {
  hits: RunHit[]
}

const DEFAULT_SCOPE = 'all'

function formatDateTime(ts: number): string {
  const d = new Date(ts * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function conditionsSummary(conditions: ConditionSpec[], max = 3): string {
  if (!conditions || conditions.length === 0) return '（無條件）'
  const notes = conditions.map((c) => c.note || c.metric)
  if (notes.length <= max) return notes.join('、')
  return `${notes.slice(0, max).join('、')} 等 ${notes.length} 條`
}

export function StrategyWorkspace() {
  const [strategies, setStrategies] = useState<StrategyCard[]>([])
  const [strategiesError, setStrategiesError] = useState<string | null>(null)
  const [runs, setRuns] = useState<RunMeta[]>([])
  const [runsError, setRunsError] = useState<string | null>(null)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [selectedRun, setSelectedRun] = useState<RunFull | null>(null)
  const [editing, setEditing] = useState<StrategyCard | null>(null)

  const loadStrategies = useCallback(async () => {
    try {
      const res = await fetch('/api/strategies')
      if (!res.ok) throw new Error(`載入策略失敗 (${res.status})`)
      const json = (await res.json()) as { strategies: StrategyCard[] }
      setStrategies(json.strategies ?? [])
    } catch {
      try {
        const res = await fetch('/api/strategy/presets')
        if (!res.ok) throw new Error(`載入策略失敗 (${res.status})`)
        const json = (await res.json()) as { presets: StrategyCard[] }
        setStrategies(json.presets ?? [])
      } catch (e2) {
        setStrategiesError(e2 instanceof Error ? e2.message : String(e2))
      }
    }
  }, [])

  const loadRuns = useCallback(async () => {
    try {
      const res = await fetch('/api/strategy-runs?limit=100')
      if (!res.ok) throw new Error(`載入記錄失敗 (${res.status})`)
      const json = (await res.json()) as { runs: RunMeta[] }
      setRuns(json.runs ?? [])
    } catch (e) {
      setRunsError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    loadStrategies()
    loadRuns()
  }, [loadStrategies, loadRuns])

  const runStrategy = async (strategy: StrategyCard) => {
    if (runningId) return
    setRunningId(strategy.id)
    try {
      const res = await fetch('/api/strategy/screen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conditions: strategy.conditions, limit: 5000, scope: DEFAULT_SCOPE }),
      })
      if (!res.ok) throw new Error(`掃描失敗 (${res.status})`)
      const json = (await res.json()) as ScreenResponse
      await fetch('/api/strategy-runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategy_id: strategy.id,
          strategy_name: strategy.name,
          conditions: json.conditions,
          scope: DEFAULT_SCOPE,
          source: 'manual',
          hits: json.results,
        }),
      })
      await loadRuns()
    } catch (e) {
      setRunsError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunningId(null)
    }
  }

  const openRun = async (run: RunMeta) => {
    try {
      const res = await fetch(`/api/strategy-runs/${run.id}`)
      if (!res.ok) throw new Error(`載入記錄失敗 (${res.status})`)
      const full = (await res.json()) as RunFull
      setSelectedRun(full)
    } catch (e) {
      setRunsError(e instanceof Error ? e.message : String(e))
    }
  }

  const conditionSignature = (conds: ConditionSpec[]) =>
    conds
      .map((c) => `${c.metric}|${c.op}|${c.value ?? ''}|${c.tf ?? 'd'}`)
      .sort()
      .join(';')

  const strategyStats = (s: StrategyCard) => {
    const key = conditionSignature(s.conditions)
    const matched = runs.filter((r) => conditionSignature(r.conditions) === key)
    const latest = matched[0]
    return {
      runCount: matched.length,
      lastAt: latest ? latest.executed_at : null,
      lastHits: latest ? latest.count : null,
      hitHistory: [...matched].reverse().map((r) => r.count),
    }
  }

  if (selectedRun) {
    return (
      <RunResultView
        run={selectedRun}
        onBack={() => setSelectedRun(null)}
      />
    )
  }

  return (
    <div className="p-4 md:p-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="space-y-3">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Layers className="h-4 w-4" />
                策略庫
              </CardTitle>
              <CardAction>
                <Button
                  size="sm"
                  onClick={() =>
                    setEditing({ id: '__new__', name: '', description: '', conditions: [] })
                  }
                >
                  <Plus className="h-3.5 w-3.5" />
                  新增策略
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-2">
              {strategiesError && <p className="text-xs text-destructive">錯誤：{strategiesError}</p>}
              {strategies.length === 0 && !strategiesError && (
                <p className="text-xs text-muted-foreground">目前沒有策略。</p>
              )}
              {strategies.map((s) => {
                const stats = strategyStats(s)
                return (
                  <div
                    key={s.id}
                    className="rounded-md border border-border p-3 transition-colors hover:bg-muted/20"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold">{s.name}</span>
                          <Badge variant="secondary" className="shrink-0 text-[10px]">
                            {s.source === 'custom' ? '自訂' : '內建'}
                          </Badge>
                        </div>
                        <div className="truncate text-[11px] text-muted-foreground">{s.description}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => runStrategy(s)}
                          disabled={runningId !== null}
                        >
                          {runningId === s.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <TrendingUp className="h-3.5 w-3.5" />
                          )}
                          執行
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          aria-label="編輯策略"
                          onClick={() => setEditing(s)}
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="mt-2.5 flex flex-wrap items-center">
                      <Metric label="年化報酬" value="—" />
                      <Metric label="最大回撤" value="—" />
                      <Metric label="夏普值" value="—" />
                      <Metric label="條件數" value={`${s.conditions.length}`} />
                      <Metric label="執行次數" value={`${stats.runCount}`} />
                      <Metric label="最近命中" value={stats.lastHits !== null ? `${stats.lastHits} 檔` : '—'} />
                      <div className="ml-auto flex items-center gap-2 pl-2">
                        {stats.lastAt !== null && (
                          <span className="text-[10px] text-muted-foreground">{formatDateTime(stats.lastAt)}</span>
                        )}
                        <Sparkline values={stats.hitHistory} />
                      </div>
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>
        </section>

        <section className="space-y-3">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <History className="h-4 w-4" />
                執行記錄
              </CardTitle>
              <CardAction>
                <Button size="sm" variant="ghost" onClick={loadRuns}>
                  重新整理
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="p-0">
              {runsError && <p className="px-6 pb-2 text-xs text-destructive">錯誤：{runsError}</p>}
              {runs.length === 0 && !runsError && (
                <p className="px-6 pb-4 text-xs text-muted-foreground">
                  尚無執行記錄。在左側策略按「執行」即可產生。
                </p>
              )}
              <ScrollArea className={runs.length > 8 ? 'h-[520px]' : ''}>
                <div className="divide-y divide-border">
                  {runs.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => openRun(r)}
                      className="flex w-full items-center justify-between gap-3 px-6 py-3 text-left transition-colors hover:bg-muted/40"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="truncate text-sm font-medium">
                          {r.strategy_name || conditionsSummary(r.conditions)}
                        </div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {conditionsSummary(r.conditions)}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {formatDateTime(r.executed_at)}
                          <Badge variant="outline" className="text-[10px]">
                            {r.source === 'ai' ? 'AI' : '策略'}
                          </Badge>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-sm font-bold tabular-nums">{r.count}</span>
                        <span className="text-[11px] text-muted-foreground">檔</span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </section>
      </div>

      <StrategyEditorModal
        key={editing?.id ?? 'none'}
        open={editing !== null}
        strategy={editing}
        onClose={() => setEditing(null)}
        onSaved={loadStrategies}
      />
    </div>
  )
}

function RunResultView({ run, onBack }: { run: RunFull; onBack: () => void }) {
  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5" />
          返回
        </Button>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{conditionsSummary(run.conditions, 6)}</div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Clock className="h-3 w-3" />
            {formatDateTime(run.executed_at)}
            <span>·</span>
            <span>{run.count} 檔符合</span>
          </div>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full min-w-max text-xs">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b border-border text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">股號 / 名稱</th>
                  <th className="px-3 py-2 text-right font-medium">最新股價</th>
                  <th className="px-3 py-2 text-right font-medium">命中率</th>
                  <th className="px-3 py-2 text-right font-medium">評價分</th>
                </tr>
              </thead>
              <tbody>
                {run.hits.map((h) => (
                  <tr key={h.stock_id} className="border-b border-border/40 hover:bg-muted/30">
                    <td className="px-3 py-1.5">
                      <a href={`/stock/${h.stock_id}`} className="font-mono text-primary hover:underline">
                        {h.stock_id}
                      </a>
                      <span className="ml-2 text-[11px] text-muted-foreground">{h.name}</span>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{h.price || '-'}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {h.total_conditions > 0
                        ? `${Math.round((h.passed_count / h.total_conditions) * 100)}%`
                        : '-'}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-bold">{h.score}</td>
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

function Metric({ label, value }: { label: string; value: string }) {
  const muted = value === '—'
  return (
    <div className="border-l border-border pl-3 pr-3 first:border-l-0 first:pl-0">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`tabular-nums text-sm ${muted ? 'text-muted-foreground/40' : 'font-semibold'}`}>
        {value}
      </div>
    </div>
  )
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length === 0) {
    return <div className="h-6 w-16 rounded bg-muted/30" />
  }
  const shown = values.slice(-10)
  const max = Math.max(...shown, 1)
  return (
    <div className="flex h-6 w-16 items-end gap-0.5">
      {shown.map((v, i) => (
        <div
          key={i}
          className="flex-1 rounded-sm bg-primary/50"
          style={{ height: `${Math.max(10, (v / max) * 100)}%` }}
        />
      ))}
    </div>
  )
}
