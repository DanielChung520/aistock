'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AppShell } from '@/components/app-shell'
import { Toaster } from '@/components/ui/sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Plus, Search, Loader2, ChevronRight, Brain, Filter, Trash2, Check } from 'lucide-react'
import { CreateProjectDialog } from '@/components/ai-training/create-project-dialog'
import { DeleteProjectDialog } from '@/components/ai-training/delete-project-dialog'
import { DeleteBatchDialog } from '@/components/ai-training/delete-batch-dialog'
import { Checkbox } from '@/components/ui/checkbox'

interface ProjectItem {
  job_id: string
  name: string
  tags: string[]
  description: string
  model_type: string | null
  status: string
  created_at: number
  updated_at: number
  finished_at: number | null
  test_metric: { rmse?: number; r2?: number; accuracy?: number } | null
  config_snapshot?: {
    model_type?: string
    model_params?: Record<string, number>
    data?: { target?: string; stock_ids?: string[]; start_date?: string; end_date?: string }
    split?: { ratios?: [number, number, number] }
  } | null
}

const STATUS_OPTIONS = [
  { value: '', label: '全部狀態' },
  { value: 'pending', label: '待訓練' },
  { value: 'running', label: '訓練中' },
  { value: 'completed', label: '已完成' },
  { value: 'failed', label: '失敗' },
  { value: 'stopped', label: '已停止' },
  { value: 'saved', label: '已儲存' },
]

export default function AiTrainingListPage() {
  const router = useRouter()
  const [items, setItems] = useState<ProjectItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ job_id: string; name: string } | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [batchOpen, setBatchOpen] = useState(false)

  const toggleOne = useCallback((jobId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(jobId)) next.delete(jobId)
      else next.add(jobId)
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (prev.size === items.length) return new Set()
      return new Set(items.map((p) => p.job_id))
    })
  }, [items])

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const fetchList = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (statusFilter) params.set('status', statusFilter)
      if (search.trim()) params.set('q', search.trim())
      const url = `/api/ai-training/projects${params.toString() ? `?${params}` : ''}`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setItems(data.items || [])
      setTotal(data.total || 0)
    } catch (e) {
      toast.error('讀取訓練項目失敗', { description: e instanceof Error ? e.message : String(e) })
      setItems([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [statusFilter, search])

  useEffect(() => {
    fetchList()
  }, [fetchList])

  const handleCreated = (jobId: string) => {
    setDialogOpen(false)
    router.push(`/ai-training/${jobId}`)
  }

  return (
    <>
      <Toaster richColors position="top-center" />
      <AppShell title="AI 資料訓練">
        <div className="flex flex-col h-full min-h-0 gap-4 p-4 lg:p-6">
          {/* ── 頂部：標題 + 新建 ── */}
          <div className="shrink-0 flex items-center justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold flex items-center gap-2">
                <Brain className="h-5 w-5 text-muted-foreground" />
                AI 資料訓練
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                建立訓練項目，依序完成訓練流程後查看評估結果
              </p>
            </div>
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              新建訓練
            </Button>
          </div>

          {/* ── 篩選器 ── */}
          <Card className="shrink-0 shadow-sm">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Filter className="h-3.5 w-3.5" />
                  篩選
                </div>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="h-8 rounded border border-border bg-card px-2 text-xs"
                >
                  {STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <div className="relative flex-1 min-w-[180px] max-w-sm">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="搜尋名稱…"
                    className="h-8 text-xs pl-7"
                  />
                </div>
                <Badge variant="outline" className="text-xs ml-auto">
                  共 {total} 筆
                </Badge>
                {selectedIds.size > 0 && (
                  <>
                    <Badge variant="secondary" className="text-xs">
                      已選 {selectedIds.size} 筆
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setBatchOpen(true)}
                      className="h-8 text-xs text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1" />
                      批量刪除
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={clearSelection}
                      className="h-8 text-xs"
                    >
                      清除選取
                    </Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          {/* ── 列表 ── */}
          <Card className="flex-1 min-h-0 overflow-hidden">
            <CardContent className="p-0 h-full overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  載入中…
                </div>
              ) : items.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
                  <Brain className="h-10 w-10 text-muted-foreground/40" />
                  <div>
                    <p className="text-sm text-muted-foreground">尚無訓練項目</p>
                    <p className="text-xs text-muted-foreground/70 mt-1">點右上「新建訓練」開始</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)}>
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    新建訓練
                  </Button>
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-card border-b text-muted-foreground">
                    <tr>
                      <th className="w-8 px-3 py-2">
                        <Checkbox
                          checked={items.length > 0 && selectedIds.size === items.length}
                          onCheckedChange={toggleAll}
                          aria-label="全選"
                        />
                      </th>
                      <th className="text-left px-3 py-2 font-medium">名稱</th>
                      <th className="text-left px-3 py-2 font-medium">狀態</th>
                      <th className="text-left px-3 py-2 font-medium">模型</th>
                      <th className="text-left px-3 py-2 font-medium">股票</th>
                      <th className="text-left px-3 py-2 font-medium">標籤</th>
                      <th className="text-left px-3 py-2 font-medium">建立時間</th>
                      <th className="text-left px-3 py-2 font-medium">最後訓練</th>
                      <th className="text-left px-3 py-2 font-medium">測試指標</th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((p) => (
                      <tr
                        key={p.job_id}
                        onClick={() => router.push(`/ai-training/${p.job_id}`)}
                        className="border-b border-border/50 hover:bg-muted/30 cursor-pointer"
                      >
                        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selectedIds.has(p.job_id)}
                            onCheckedChange={() => toggleOne(p.job_id)}
                            aria-label={`選取 ${p.name}`}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-medium">{p.name}</div>
                          {p.description && (
                            <div className="text-[10px] text-muted-foreground truncate max-w-xs">{p.description}</div>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <ProjectSteps p={p} />
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {p.model_type ?? '—'}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-muted-foreground">
                          {p.config_snapshot?.data?.stock_ids?.length
                            ? `${p.config_snapshot.data.stock_ids.length} 檔`
                            : '—'}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {p.tags?.length ? p.tags.map((t) => (
                              <Badge key={t} variant="secondary" className="text-[10px]">
                                {t}
                              </Badge>
                            )) : <span className="text-muted-foreground/50">—</span>}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground tabular-nums">
                          {formatTime(p.created_at)}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground tabular-nums">
                          {p.finished_at ? formatTime(p.finished_at) : '—'}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-muted-foreground">
                          {p.test_metric
                            ? (p.test_metric.rmse !== undefined
                                ? `RMSE ${p.test_metric.rmse.toFixed(4)}`
                                : p.test_metric.accuracy !== undefined
                                  ? `Acc ${(p.test_metric.accuracy * 100).toFixed(1)}%`
                                  : '—')
                            : '—'}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation()
                                setDeleteTarget({ job_id: p.job_id, name: p.name })
                              }}
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                              title="刪除"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                            <ChevronRight className="h-4 w-4" />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </div>
      </AppShell>

      <CreateProjectDialog
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={handleCreated}
      />
      <DeleteProjectDialog
        target={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={() => {
          setDeleteTarget(null)
          fetchList()
        }}
      />
      <DeleteBatchDialog
        items={items
          .filter((p) => selectedIds.has(p.job_id))
          .map((p) => ({ job_id: p.job_id, name: p.name, status: p.status }))}
        open={batchOpen}
        onClose={() => setBatchOpen(false)}
        onDeleted={() => {
          clearSelection()
          setBatchOpen(false)
          fetchList()
        }}
      />
    </>
  )
}

function formatTime(ts: number): string {
  const d = new Date(ts * 1000)
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${mo}-${da} ${h}:${mi}`
}

function ProjectSteps({ p }: { p: ProjectItem }) {
  const snap = p.config_snapshot
  const paramDone = !!snap?.model_type && !!snap?.model_params && Object.keys(snap.model_params).length > 0
  const targetDone = !!snap?.data?.target
  const dataDone = !!snap?.data?.stock_ids?.length && !!snap?.split?.ratios
  const trained = p.status === 'completed' || p.status === 'saved'
  const saved = p.status === 'saved'

  const steps = [
    { label: '參數', done: paramDone },
    { label: '目標', done: targetDone },
    { label: '資料', done: dataDone },
    { label: '訓練', done: trained },
  ]

  return (
    <div className="flex flex-wrap items-center gap-1">
      {steps.map((s) => (
        <Badge
          key={s.label}
          variant={s.done ? 'default' : 'outline'}
          className={
            'text-[10px] gap-0.5 ' +
            (s.done
              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/40'
              : 'text-muted-foreground/50 border-border/60')
          }
        >
          {s.done && <Check className="h-3 w-3" />}
          {s.label}
        </Badge>
      ))}
      {saved ? (
        <Badge className="text-[10px] bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/40">
          <Check className="h-3 w-3" />
          已保存
        </Badge>
      ) : !paramDone && p.status === 'pending' ? (
        <Badge variant="outline" className="text-[10px] text-muted-foreground/50 border-border/60">
          未開始
        </Badge>
      ) : null}
    </div>
  )
}
