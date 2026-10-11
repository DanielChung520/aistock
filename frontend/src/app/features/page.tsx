'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Settings2, Play, Sparkles, TableProperties, Loader2, AlertCircle } from 'lucide-react'
import { AppShell } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { FeatureSettingsModal, DEFAULT_FEATURES, type FeatureConfigSummary } from '@/components/feature-settings-modal'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { lookupColumnDesc, type FeatureNeed } from '@/components/feature-descriptions'
import universeData from '@/lib/data/research-universe-ai-memory-passive.json'

const UNIVERSE: { stock_id: string; name: string }[] = universeData.stocks
const START_DATE = '2024-08-01'
const END_DATE = '2026-08-07'
const JOB_KEY = 'aistock-feature-job'
const SENS_JOB_KEY = 'aistock-sensitivity-job'
const CONFIG_KEY = 'aistock-feature-config'

interface GenState {
  status: 'idle' | 'running' | 'completed' | 'failed'
  stocksDone: number
  stocksTotal: number
  rowsWritten: number
  error: string | null
}

const IDLE: GenState = {
  status: 'idle', stocksDone: 0, stocksTotal: 0, rowsWritten: 0, error: null,
}

const SENS_TARGETS = [
  { key: 'next_return', label: '隔日漲跌幅', task: 'regression' },
  { key: 'next_5d_return', label: '5日總漲跌幅', task: 'regression' },
  { key: 'next_direction', label: '隔日漲跌分類', task: 'classification' },
  { key: 'next_5d_direction', label: '5日總漲跌分類', task: 'classification' },
] as const

const SENS_MODELS = [
  { key: 'xgboost', label: 'XGBoost' },
  { key: 'lightgbm', label: 'LightGBM' },
  { key: 'randomforest', label: 'RandomForest' },
] as const

interface SensState {
  status: 'idle' | 'running' | 'completed' | 'failed' | 'cached'
  target: string
  models: string[]
  result: {
    feature_columns: string[]
    models: Record<string, Record<string, number>>
  } | null
  error: string | null
  jobId: string | null
  finishedAt: number | null
}

const SENS_IDLE: SensState = {
  status: 'idle', target: 'next_5d_return', models: ['xgboost', 'lightgbm', 'randomforest'],
  result: null, error: null, jobId: null, finishedAt: null,
}

export default function FeaturesPage() {
  const [modalOpen, setModalOpen] = useState(false)
  const [gen, setGen] = useState<GenState>(IDLE)
  const [sens, setSens] = useState<SensState>(SENS_IDLE)
  const [dimsOpen, setDimsOpen] = useState(false)
  const [dims, setDims] = useState<{ groups: Record<string, string[]>; total: number } | null>(null)
  const [config, setConfig] = useState<FeatureConfigSummary | null>(null)
  const [expandedModels, setExpandedModels] = useState<Set<string>>(new Set())
  const [stats, setStats] = useState<{
    total_rows: number
    distinct_stocks: number
    date_range: { mn: string; mx: string }
  } | null>(null)
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const jobIdRef = useRef<string | null>(null)

  // 重新整理後從 localStorage 恢復進行中的 job
  useEffect(() => {
    const saved = window.localStorage.getItem(JOB_KEY)
    if (saved) {
      jobIdRef.current = saved
      setGen((g) => ({ ...g, status: 'running' }))
      pollRef.current = setTimeout(() => pollJob(saved), 500)
    }
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const clearSavedJob = useCallback(() => {
    jobIdRef.current = null
    window.localStorage.removeItem(JOB_KEY)
  }, [])

  const pollJob = useCallback(async (jobId: string) => {
    try {
      const res = await fetch(`/api/features/jobs/${jobId}`)
      if (res.status === 404) {
        clearSavedJob()
        setGen((g) => ({ ...g, status: 'failed', error: '任務不存在' }))
        return
      }
      const job = (await res.json()) as {
        status?: string
        rows_written?: number
        stocks_total?: number
        stocks_done?: number
        error?: string
      }
      if (job.status === 'completed') {
        clearSavedJob()
        setGen((g) => ({
          ...g,
          status: 'completed',
          rowsWritten: job.rows_written ?? g.rowsWritten,
          stocksDone: job.stocks_done ?? g.stocksTotal,
        }))
      } else if (job.status === 'failed') {
        clearSavedJob()
        setGen((g) => ({ ...g, status: 'failed', error: job.error ?? '生成失敗' }))
      } else {
        setGen((g) => ({
          ...g,
          status: 'running',
          stocksDone: job.stocks_done ?? g.stocksDone,
          stocksTotal: job.stocks_total ?? g.stocksTotal,
        }))
        pollRef.current = setTimeout(() => pollJob(jobId), 1500)
      }
    } catch {
      setGen((g) => ({ ...g, status: 'failed', error: '查詢任務狀態失敗' }))
    }
  }, [clearSavedJob])

  const handleJobStarted = useCallback((jobId: string) => {
    jobIdRef.current = jobId
    window.localStorage.setItem(JOB_KEY, jobId)
    setGen({ ...IDLE, status: 'running' })
    pollRef.current = setTimeout(() => pollJob(jobId), 1500)
  }, [pollJob])

  // ── 敏感度分析 ──
  const loadHistoricalResult = useCallback(async (target: string, models: string[]) => {
    if (models.length === 0) return
    try {
      const res = await fetch(`/api/features/sensitivity/list?target=${encodeURIComponent(target)}&limit=10`)
      if (!res.ok) return
      const data = (await res.json()) as {
        items?: Array<{
          job_id: string
          target: string
          model_types: string[] | null
          finished_at: number | null
          stock_count: number
        }>
      }
      const items = data.items ?? []
      const sorted = [...items].sort((a, b) => {
        const aOk = a.model_types && models.every((m) => a.model_types!.includes(m))
        const bOk = b.model_types && models.every((m) => b.model_types!.includes(m))
        if (aOk && !bOk) return -1
        if (!aOk && bOk) return 1
        return (b.finished_at ?? 0) - (a.finished_at ?? 0)
      })
      const match = sorted.find(
        (it) => it.model_types && models.every((m) => it.model_types!.includes(m))
      )
      if (!match) return

      const detail = await fetch(`/api/features/sensitivity/${match.job_id}`)
      if (!detail.ok) return
      const job = (await detail.json()) as {
        status?: string
        result?: SensState['result']
        finished_at?: number | null
      }
      if (job.status === 'completed' && job.result) {
        setSens((s) => ({
          ...s,
          status: 'cached',
          result: job.result ?? null,
          jobId: match.job_id,
          finishedAt: match.finished_at ?? job.finished_at ?? null,
          error: null,
        }))
      }
    } catch {
      return
    }
  }, [])

  const runSensitivity = async () => {
    if (sens.status === 'running') return
    setSens((s) => ({ ...s, status: 'running', error: null, result: null }))
    try {
      const res = await fetch('/api/features/sensitivity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: sens.target,
          stock_ids: UNIVERSE.map((s) => s.stock_id),
          start_date: START_DATE,
          end_date: END_DATE,
          model_types: sens.models,
          n_estimators: 100,
        }),
      })
      const body = (await res.json()) as { job_id?: string; error?: string; detail?: string }
      if (!res.ok) throw new Error(body.error ?? body.detail ?? '敏感度分析失敗')
      if (!body.job_id) throw new Error('未回傳 job_id')
      window.localStorage.setItem(SENS_JOB_KEY, body.job_id)
      pollSensitivity(body.job_id)
    } catch (e) {
      setSens((s) => ({ ...s, status: 'failed', error: e instanceof Error ? e.message : String(e) }))
    }
  }

  const pollSensitivity = useCallback(async (jobId: string) => {
    try {
      const res = await fetch(`/api/features/sensitivity/${jobId}`)
      if (res.status === 404) {
        setSens((s) => ({ ...s, status: 'failed', error: '任務不存在' }))
        window.localStorage.removeItem(SENS_JOB_KEY)
        return
      }
      const job = (await res.json()) as {
        status?: string
        error?: string
        result?: SensState['result']
      }
      if (job.status === 'completed') {
        window.localStorage.removeItem(SENS_JOB_KEY)
        setSens((s) => ({ ...s, status: 'completed', result: job.result ?? null }))
      } else if (job.status === 'failed') {
        window.localStorage.removeItem(SENS_JOB_KEY)
        setSens((s) => ({ ...s, status: 'failed', error: job.error ?? '分析失敗' }))
      } else {
        pollRef.current = setTimeout(() => pollSensitivity(jobId), 1500)
      }
    } catch {
      setSens((s) => ({ ...s, status: 'failed', error: '查詢分析狀態失敗' }))
    }
  }, [])

  // 重新整理後恢復敏感度分析進行中的 job
  useEffect(() => {
    const saved = window.localStorage.getItem(SENS_JOB_KEY)
    if (saved) {
      setSens((s) => ({ ...s, status: 'running' }))
      pollRef.current = setTimeout(() => pollSensitivity(saved), 500)
    }
  }, [pollSensitivity])

  const loadDimensions = async () => {
    setDimsOpen(true)
    try {
      const res = await fetch('/api/features/dimensions')
      if (!res.ok) throw new Error('載入維度失敗')
      const data = (await res.json()) as { groups: Record<string, string[]>; total: number }
      setDims(data)
    } catch (e) {
      setDims({ groups: {}, total: 0 })
    }
  }

  const handleConfigChange = useCallback((summary: FeatureConfigSummary) => {
    setConfig(summary)
    window.localStorage.setItem(CONFIG_KEY, JSON.stringify(summary))
  }, [])

  // 刷新後恢復摘要設定 + 載入 DB 實際資料統計
  useEffect(() => {
    const saved = window.localStorage.getItem(CONFIG_KEY)
    if (saved) {
      try {
        setConfig(JSON.parse(saved) as FeatureConfigSummary)
      } catch {
        window.localStorage.removeItem(CONFIG_KEY)
      }
    }
    fetch('/api/features/stats')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setStats(data))
      .catch(() => setStats(null))
  }, [])

  const progressPct =
    gen.stocksTotal > 0 ? Math.round((gen.stocksDone / gen.stocksTotal) * 100) : 0

  return (
    <AppShell title="生成特征值">
      <div className="flex flex-col gap-4 p-4 lg:p-6">
        {/* ── 特徵生成（設定摘要 + 進度整合） ── */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Play className="h-4 w-4 text-muted-foreground" />
                特徵生成
              </CardTitle>
              <CardDescription>生成條件一覽與批次計算進度</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="gap-1.5" onClick={loadDimensions}>
                <TableProperties className="h-3.5 w-3.5" />
                生成維度
              </Button>
              <Button size="sm" className="gap-1.5" onClick={() => setModalOpen(true)}>
                <Settings2 className="h-3.5 w-3.5" />
                生成設定
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 設定摘要（反映實際設定） */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <div className="rounded-md border bg-muted/40 px-3 py-2.5">
                <div className="text-xs text-muted-foreground">股票清單</div>
                <div className="mt-0.5 text-sm font-medium truncate">
                  {config ? (
                    config.stockScope === 'all'
                      ? `全市場 ${config.stockCount} 檔`
                      : `研究 ${config.stockCount} 檔`
                  ) : (
                    '尚未設定'
                  )}
                </div>
              </div>
              <div className="rounded-md border bg-muted/40 px-3 py-2.5">
                <div className="text-xs text-muted-foreground">生成區間</div>
                <div className="mt-0.5 text-sm font-medium truncate">
                  {config ? `${config.startDate} ~ ${config.endDate}` : '尚未設定'}
                </div>
              </div>
              <div className="rounded-md border bg-muted/40 px-3 py-2.5">
                <div className="text-xs text-muted-foreground">特徵值項目</div>
                <div className="mt-0.5 text-sm font-medium truncate">
                  {config ? `${config.featureCount} / ${DEFAULT_FEATURES.length} 啟用` : '尚未設定'}
                </div>
              </div>
              <div className="rounded-md border bg-muted/40 px-3 py-2.5">
                <div className="text-xs text-muted-foreground">目標項目</div>
                <div className="mt-0.5 text-sm font-medium truncate">
                  {config ? `${config.targetCount} / 4 個目標` : '尚未設定'}
                </div>
              </div>
              <div className="rounded-md border bg-muted/40 px-3 py-2.5">
                <div className="text-xs text-muted-foreground">指數</div>
                <div className="mt-0.5 text-sm font-medium truncate">
                  {config ? `${config.indexCount} 檔` : '尚未設定'}
                </div>
              </div>
            </div>

            {/* DB 實際資料 */}
            {stats && (
              <div className="rounded-md border bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
                <span className="font-medium">資料庫實際資料：</span>
                {stats.total_rows.toLocaleString()} 筆 · {stats.distinct_stocks} 檔 ·{' '}
                {stats.date_range?.mn} ~ {stats.date_range?.mx}
              </div>
            )}

            {/* 進度 */}
            <div className="flex items-center gap-3">
              <Progress value={progressPct} className="h-2 flex-1" />
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {gen.status === 'idle'
                  ? '尚未開始'
                  : `${gen.stocksDone} / ${gen.stocksTotal} 檔`}
              </span>
            </div>
            {gen.status === 'failed' && (
              <p className="text-xs text-destructive flex items-center gap-1.5">
                <AlertCircle className="h-3.5 w-3.5" />
                {gen.error}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {gen.status === 'idle' &&
                '點擊「生成設定」選擇股票清單、特徵項目與指數，於彈窗內點擊「開始生成」。'}
              {gen.status === 'running' && `正在計算特徵值... 已寫入 ${gen.rowsWritten} 筆`}
              {gen.status === 'completed' && `生成完成，共寫入 ${gen.rowsWritten} 筆特徵值`}
            </p>
          </CardContent>
        </Card>

        {/* ── 特徵敏感度分析 ── */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <TableProperties className="h-4 w-4 text-muted-foreground" />
                特徵敏感度分析
              </CardTitle>
              <CardDescription>多目標 × 多模型特徵重要性，找出最有預測力的特徵</CardDescription>
            </div>
            <Button
              size="sm"
              className="gap-1.5"
              onClick={runSensitivity}
              disabled={sens.status === 'running'}
            >
              {sens.status === 'running' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {sens.status === 'running' ? '分析中...' : '執行敏感度分析'}
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 設定列 */}
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">預測目標</Label>
                <div className="flex gap-1.5">
                  {SENS_TARGETS.map((t) => (
                    <Button
                      key={t.key}
                      size="sm"
                      variant={sens.target === t.key ? 'default' : 'outline'}
                      onClick={() => {
                        const newTarget = t.key
                        setSens((s) => ({ ...s, target: newTarget, result: null, status: 'idle', jobId: null, finishedAt: null, error: null }))
                        loadHistoricalResult(newTarget, sens.models)
                      }}
                    >
                      {t.label}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">比較模型</Label>
                <div className="flex gap-1.5">
                  {SENS_MODELS.map((m) => (
                    <Button
                      key={m.key}
                      size="sm"
                      variant={sens.models.includes(m.key) ? 'default' : 'outline'}
                      onClick={() => {
                        const nextModels = sens.models.includes(m.key)
                          ? sens.models.filter((x) => x !== m.key)
                          : [...sens.models, m.key]
                        setSens((s) => ({ ...s, models: nextModels, result: null, status: 'idle', jobId: null, finishedAt: null, error: null }))
                        if (nextModels.length > 0) {
                          loadHistoricalResult(sens.target, nextModels)
                        }
                      }}
                    >
                      {m.label}
                    </Button>
                  ))}
                </div>
              </div>
              <p className="text-xs text-muted-foreground ml-auto">
                分析範圍：研究清單 {UNIVERSE.length} 檔 · {START_DATE} ~ {END_DATE}
              </p>
            </div>

            {(sens.status === 'completed' || sens.status === 'cached') && sens.finishedAt && (
              <p className="text-xs text-muted-foreground flex items-center gap-2">
                <span>
                  上次分析：{new Date(sens.finishedAt * 1000).toLocaleString('zh-TW')}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs"
                  onClick={runSensitivity}
                >
                  重新生成
                </Button>
              </p>
            )}

            {sens.status === 'failed' && (
              <p className="text-xs text-destructive flex items-center gap-1.5">
                <AlertCircle className="h-3.5 w-3.5" />
                {sens.error}
              </p>
            )}
            {sens.status === 'running' && (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                正在計算 {SENS_TARGETS.find((t) => t.key === sens.target)?.label} 的
                {sens.models.length} 個模型特徵重要性...
              </p>
            )}

            {/* 結果表 */}
            {(sens.status === 'completed' || sens.status === 'cached') && sens.result && (
              <div className="space-y-3">
                {sens.models.map((m) => {
                  const imp = sens.result?.models?.[m]
                  if (!imp) return null
                  const entries = Object.entries(imp)
                  const expanded = expandedModels.has(m)
                  const shown = expanded ? entries : entries.slice(0, 20)
                  const max = entries.length ? entries[0][1] : 1
                  return (
                    <div key={m} className="rounded-md border p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-sm font-medium">
                          {SENS_MODELS.find((x) => x.key === m)?.label} 特徵重要性
                        </div>
                        {entries.length > 20 && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="gap-1 text-xs"
                            onClick={() =>
                              setExpandedModels((prev) => {
                                const next = new Set(prev)
                                if (expanded) next.delete(m)
                                else next.add(m)
                                return next
                              })
                            }
                          >
                            {expanded ? '收合' : `顯示全部 ${entries.length} 個`}
                          </Button>
                        )}
                      </div>
                      <div className="space-y-1">
                        {shown.map(([name, score], idx) => {
                          const desc = lookupColumnDesc(name)
                          const rank = idx + 1
                          return (
                            <div key={name} className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground w-8 text-right tabular-nums">
                                {rank}.
                              </span>
                              <span
                                className="font-mono text-xs text-muted-foreground w-36 truncate"
                                title={name}
                              >
                                {name}
                              </span>
                              {desc ? (
                                <span className="text-xs text-foreground/80 truncate w-44" title={desc.label}>
                                  {desc.label}
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground italic w-44">（無說明）</span>
                              )}
                              {desc && (
                                <Badge
                                  variant={
                                    desc.need === 'required'
                                      ? 'default'
                                      : desc.need === 'recommended'
                                      ? 'secondary'
                                      : 'outline'
                                  }
                                  className="text-[10px] h-5 shrink-0"
                                >
                                  {desc.need === 'required'
                                    ? '必要'
                                    : desc.need === 'recommended'
                                    ? '建議'
                                    : '輔助'}
                                </Badge>
                              )}
                              <div className="flex-1 h-2 bg-muted rounded overflow-hidden min-w-[60px]">
                                <div
                                  className="h-full bg-primary"
                                  style={{ width: `${Math.max(3, (score / max) * 100)}%` }}
                                />
                              </div>
                              <span className="font-mono text-xs w-16 text-right tabular-nums">
                                {score.toFixed(4)}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <FeatureSettingsModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onJobStarted={handleJobStarted}
        onConfigChange={handleConfigChange}
      />

      {/* ── 生成維度 modal ── */}
      <Dialog open={dimsOpen} onOpenChange={setDimsOpen}>
        <DialogContent className="sm:max-w-[70vw] max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>生成維度</DialogTitle>
            <DialogDescription>
              目前生成的資料維度（共 {dims?.total ?? 0} 個欄位）。目標值欄位已隨特徵一併生成。
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1 min-h-0">
            <div className="space-y-4 p-1">
              {dims && Object.entries(dims.groups).map(([group, cols]) => (
                <div key={group} className="rounded-md border p-3">
                  <div className="text-sm font-medium mb-2 flex items-center gap-2">
                    {group}
                    <span className="text-xs text-muted-foreground">({cols.length} 欄)</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {cols.map((c) => (
                      <span
                        key={c}
                        className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </AppShell>
  )
}
