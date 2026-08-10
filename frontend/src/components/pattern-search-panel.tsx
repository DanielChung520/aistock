'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { ScanSearch, Trash2, Play, Loader2, Sparkles } from 'lucide-react'
import { useSystemSettings } from '@/hooks/use-system-settings'
import {
  DEFAULT_PATTERN_PARAMS,
  type PatternParams,
  type PatternSearchResponse,
  type SearchPattern,
} from '@/types/pattern'

interface PatternSearchPanelProps {
  initialPatternId?: string | null
}

export function PatternSearchPanel({ initialPatternId }: PatternSearchPanelProps) {
  const { settings: sysSettings } = useSystemSettings()
  const [patterns, setPatterns] = useState<SearchPattern[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedKey, setSelectedKey] = useState<string | null>(initialPatternId ?? null)
  const [draftParams, setDraftParams] = useState<PatternParams>(DEFAULT_PATTERN_PARAMS)
  const [searchingKey, setSearchingKey] = useState<string | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [result, setResult] = useState<PatternSearchResponse | null>(null)
  const [resultModalOpen, setResultModalOpen] = useState(false)
  const [useAiSummary, setUseAiSummary] = useState(false)
  const [renamingKey, setRenamingKey] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const loadPatterns = useCallback(async () => {
    try {
      const res = await fetch('/api/patterns')
      if (!res.ok) throw new Error(`讀取失敗 (${res.status})`)
      const json = (await res.json()) as SearchPattern[]
      setPatterns(json)
      if (!selectedKey && json.length > 0) {
        setSelectedKey(json[0]._key)
        setDraftParams(json[0].params)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [selectedKey])

  useEffect(() => {
    loadPatterns()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectPattern = (p: SearchPattern) => {
    setSelectedKey(p._key)
    setDraftParams(p.params)
    setResult(null)
    setSearchError(null)
  }

  const deletePattern = async (key: string) => {
    try {
      const res = await fetch(`/api/patterns/${key}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 204) throw new Error(`刪除失敗 (${res.status})`)
      toast.success('圖形已刪除')
      setPatterns((prev) => prev.filter((p) => p._key !== key))
      if (selectedKey === key) {
        const next = patterns.find((p) => p._key !== key)
        setSelectedKey(next?._key ?? null)
        setDraftParams(next?.params ?? DEFAULT_PATTERN_PARAMS)
        setResult(null)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const renamePattern = async (key: string) => {
    const name = renameValue.trim()
    if (!name) return
    try {
      const res = await fetch(`/api/patterns/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) throw new Error(`更新失敗 (${res.status})`)
      setPatterns((prev) => prev.map((p) => (p._key === key ? { ...p, name } : p)))
      setRenamingKey(null)
      toast.success('已重新命名')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const saveParams = async () => {
    if (!selectedKey) return
    try {
      const res = await fetch(`/api/patterns/${selectedKey}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ params: draftParams }),
      })
      if (!res.ok) throw new Error(`更新失敗 (${res.status})`)
      setPatterns((prev) =>
        prev.map((p) => (p._key === selectedKey ? { ...p, params: draftParams } : p))
      )
      toast.success('參數已更新')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const runSearch = async () => {
    if (!selectedKey || searchingKey) return
    const fb = sysSettings.llm.fallback
    const hasFallback = !!fb?.enabled && !!fb?.apiKey
    if (useAiSummary && !sysSettings.llm.apiKey && !hasFallback) {
      setSearchError('尚未設定 LLM API Key，請先到「系統設定 → 一般設定」填入')
      return
    }
    setSearchingKey(selectedKey)
    setSearchError(null)
    setResult(null)
    try {
      const res = await fetch(`/api/patterns/${selectedKey}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ai_summary: useAiSummary,
          llm: {
            base_url: sysSettings.llm.baseUrl,
            model: sysSettings.llm.model,
            api_key: sysSettings.llm.apiKey,
            temperature: sysSettings.llm.temperature,
            max_tokens: Math.min(sysSettings.llm.maxTokens, sysSettings.llm.contextWindow),
            fallback: sysSettings.llm.fallback
              ? {
                  enabled: sysSettings.llm.fallback.enabled,
                  base_url: sysSettings.llm.fallback.baseUrl,
                  model: sysSettings.llm.fallback.model,
                  api_key: sysSettings.llm.fallback.apiKey,
                }
              : undefined,
          },
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { detail?: string } | null
        throw new Error(body?.detail ?? `搜尋失敗 (${res.status})`)
      }
      const json = (await res.json()) as PatternSearchResponse
      setResult(json)
      setResultModalOpen(true)
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : String(e))
    } finally {
      setSearchingKey(null)
    }
  }

  const updateDraft = <K extends keyof PatternParams>(key: K, value: PatternParams[K]) => {
    setDraftParams((prev) => ({ ...prev, [key]: value }))
  }

  const selected = patterns.find((p) => p._key === selectedKey) ?? null

  return (
    <div className="grid grid-cols-1 lg:grid-cols-10 gap-4">
      {/* Left: saved pattern list (30%) */}
      <div className="lg:col-span-3 space-y-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ScanSearch className="h-4 w-4" />
              我的圖形
              <span className="text-xs font-normal text-muted-foreground">({patterns.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 max-h-[60vh] overflow-y-auto">
            {loading ? (
              <Skeleton className="h-16 w-full" />
            ) : patterns.length === 0 ? (
              <p className="text-xs text-muted-foreground px-1 py-4">
                尚無圖形。到個股頁面在K線圖上點「框選圖形」，拖曳選取一段走勢後即可儲存。
              </p>
            ) : (
              patterns.map((p) => (
                <div
                  key={p._key}
                  className={
                    'border rounded-md px-2 py-1.5 cursor-pointer transition-colors ' +
                    (p._key === selectedKey
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:bg-muted/40')
                  }
                  onClick={() => selectPattern(p)}
                >
                  <div className="flex items-center justify-between gap-2">
                    {renamingKey === p._key ? (
                      <Input
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') renamePattern(p._key)
                          if (e.key === 'Escape') setRenamingKey(null)
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="h-6 text-xs flex-1"
                        autoFocus
                      />
                    ) : (
                      <span
                        className="text-sm font-medium truncate"
                        onDoubleClick={() => {
                          setRenamingKey(p._key)
                          setRenameValue(p.name)
                        }}
                        title="雙擊重新命名"
                      >
                        {p.name}
                      </span>
                    )}
                    <div className="flex items-center gap-1.5 shrink-0">
                      {searchingKey === p._key ? (
                        <span className="flex items-center gap-1 text-[10px] text-primary">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          搜索中
                        </span>
                      ) : (
                        <button
                          className="text-muted-foreground hover:text-primary"
                          title="執行搜索"
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelectedKey(p._key)
                            setDraftParams(p.params)
                            setResult(null)
                            setSearchError(null)
                            setTimeout(() => runSearch(), 0)
                          }}
                        >
                          <Play className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        className="text-muted-foreground hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation()
                          deletePattern(p._key)
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-1 space-y-0.5">
                    <div
                      className="text-[11px] text-foreground/80 line-clamp-2 leading-snug min-h-[1.5em]"
                      title={p.ai_description ?? ''}
                    >
                      {p.ai_description ?? '—'}
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      {p.symbol} · {p.bars.length} 根 · {new Date(p.created_at * 1000).toLocaleDateString('zh-TW')}
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Right: 70%, internally split 7:3 (params | thumbnail) */}
      <div className="lg:col-span-7">
        <div className="grid grid-cols-1 lg:grid-cols-10 gap-4">
          {/* Params + results (70% of right) */}
          <div className="lg:col-span-7 space-y-4">
            {selected ? (
              <>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <span className="truncate">{selected.name}</span>
                      <span className="text-xs font-normal text-muted-foreground shrink-0">
                        {selected.symbol} · 樣本 {selected.bars.length} 根
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-x-3 gap-y-2">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">比對最近 N 根</Label>
                        <Input
                          type="number"
                          min={5}
                          max={200}
                          value={draftParams.window}
                          onChange={(e) => updateDraft('window', parseInt(e.target.value, 10) || 5)}
                          className="h-7 text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">正規化</Label>
                        <Select
                          value={draftParams.normalize}
                          onValueChange={(v) => updateDraft('normalize', v as PatternParams['normalize'])}
                        >
                          <SelectTrigger size="sm" className="h-7 text-xs w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="zscore">z-score（純形狀）</SelectItem>
                            <SelectItem value="pct">漲跌幅度</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">距離度量</Label>
                        <Select
                          value={draftParams.metric}
                          onValueChange={(v) => updateDraft('metric', v as PatternParams['metric'])}
                        >
                          <SelectTrigger size="sm" className="h-7 text-xs w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="euclidean">歐氏距離（快）</SelectItem>
                            <SelectItem value="dtw" disabled>DTW（開發中）</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">趨勢過濾</Label>
                        <Select
                          value={draftParams.trend_filter}
                          onValueChange={(v) => updateDraft('trend_filter', v as PatternParams['trend_filter'])}
                        >
                          <SelectTrigger size="sm" className="h-7 text-xs w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">不限</SelectItem>
                            <SelectItem value="up">上漲</SelectItem>
                            <SelectItem value="down">下跌</SelectItem>
                            <SelectItem value="range">盤整</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">相似度門檻 (0~1)</Label>
                        <Input
                          type="number"
                          step={0.05}
                          min={0}
                          max={1}
                          value={draftParams.threshold}
                          onChange={(e) =>
                            updateDraft('threshold', parseFloat(e.target.value) || 0)
                          }
                          className="h-7 text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">回傳筆數</Label>
                        <Input
                          type="number"
                          min={1}
                          max={200}
                          value={draftParams.limit}
                          onChange={(e) => updateDraft('limit', parseInt(e.target.value, 10) || 30)}
                          className="h-7 text-xs"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button size="sm" onClick={runSearch} disabled={!!searchingKey}>
                        {searchingKey === selectedKey ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Play className="h-3.5 w-3.5" />
                        )}
                        {searchingKey === selectedKey ? '搜尋中…' : '執行搜索'}
                      </Button>
                      <Button size="sm" variant="outline" onClick={saveParams}>
                        儲存參數
                      </Button>
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer ml-auto">
                        <input
                          type="checkbox"
                          checked={useAiSummary}
                          onChange={(e) => setUseAiSummary(e.target.checked)}
                          className="h-3.5 w-3.5"
                        />
                        <Sparkles className="h-3.5 w-3.5" />
                        AI 補述
                      </label>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      搜索方式：掃描每檔股票最近 {draftParams.window} 根日K收盤，與此圖形比對相似度（AI 補述需在系統設定中配置 LLM）。
                    </p>
                  </CardContent>
                </Card>

                {searchError && (
                  <p className="text-xs text-destructive px-1">錯誤：{searchError}</p>
                )}
              </>
            ) : (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground space-y-2">
                  <ScanSearch className="h-8 w-8 opacity-40" />
                  <p className="text-sm">請選擇左側一個圖形，或先到個股頁面框選儲存圖形</p>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Large thumbnail (30% of right) */}
          <div className="lg:col-span-3 space-y-4">
            {selected ? (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">縮圖預覽</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {selected.thumbnail ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={selected.thumbnail}
                      alt={`${selected.name} 縮圖`}
                      className="w-full h-auto rounded-sm border border-border"
                    />
                  ) : (
                    <div className="aspect-square rounded-sm border border-dashed border-border flex items-center justify-center text-xs text-muted-foreground">
                      無縮圖
                    </div>
                  )}
                  <div className="text-[11px] text-muted-foreground space-y-0.5">
                    <div className="font-mono">{selected.symbol}</div>
                    <div>樣本 {selected.bars.length} 根</div>
                    <div>{new Date(selected.created_at * 1000).toLocaleDateString('zh-TW')}</div>
                  </div>
                  {selected.ai_description && (
                    <div className="text-[11px] text-foreground/80 border-t border-border pt-2 leading-snug">
                      {selected.ai_description}
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <p className="text-xs">選擇圖形以預覽縮圖</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* 搜索結果 modal */}
      <Dialog open={resultModalOpen} onOpenChange={setResultModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <ScanSearch className="h-4 w-4" />
              搜索結果
              {result && (
                <span className="text-xs font-normal text-muted-foreground">
                  {result.pattern.name} · 共 {result.total} 檔相似
                </span>
              )}
            </DialogTitle>
            <DialogDescription>
              {result && (
                <span>
                  樣本 {result.pattern.symbol}（{result.pattern.bars.length} 根）· 相似度門檻 {draftParams.threshold}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          {result?.ai_summary && (
            <div className="rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm leading-relaxed">
              <span className="flex items-center gap-1.5 text-xs font-medium text-primary mb-1">
                <Sparkles className="h-3.5 w-3.5" />AI 補述
              </span>
              {result.ai_summary}
              {result.used_fallback && (
                <p className="mt-1.5 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600">
                  ⚠️ 主要 LLM 連線失敗，已自動改用本機 dllm（{result.fallback_model ?? '本機 dllm'}）
                </p>
              )}
            </div>
          )}

          {result && (
            <div className="max-h-[50vh] overflow-y-auto rounded-md border border-border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-background">
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="px-2 py-1 text-left font-medium">股票</th>
                    <th className="px-2 py-1 text-right font-medium">相似度</th>
                    <th className="px-2 py-1 text-right font-medium">距離</th>
                  </tr>
                </thead>
                <tbody>
                  {result.results.map((r) => (
                    <tr key={r.stock_id} className="border-b border-border/40 hover:bg-muted/30">
                      <td className="px-2 py-1">
                        <div className="font-mono leading-tight">
                          <a href={`/stock/${r.stock_id}`} className="text-primary hover:underline">
                            {r.stock_id}
                          </a>
                        </div>
                        <div className="leading-tight text-[10px] text-muted-foreground">
                          {r.name ?? ''}
                        </div>
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums font-bold">
                        {(r.similarity * 100).toFixed(1)}%
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">{r.distance.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setResultModalOpen(false)}>
              關閉
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
