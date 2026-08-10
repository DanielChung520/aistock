'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { TrendingUp, ArrowUp, ArrowDown, Sparkles, Loader2 } from 'lucide-react'
import { useSystemSettings } from '@/hooks/use-system-settings'

type ScopeType = 'all' | 'watchlist' | `sector:${string}`

interface StrategyScreenerProps {
  scope?: ScopeType
  onHit?: (response: ScreenResponse, source: 'manual' | 'ai') => void
}

interface ConditionResult {
  metric: string
  op: string
  value: number | string | null
  note: string
  actual: number | boolean | null
  passed: boolean
}

interface ScreenResult {
  stock_id: string
  name?: string | null
  price: number | null
  score: number
  date: string
  passed: boolean
  passed_count: number
  total_conditions: number
  condition_results: ConditionResult[]
}

export interface ScreenResponse {
  total: number
  scanned: number
  results: ScreenResult[]
  conditions: Array<{
    metric: string
    op: string
    value: number | string | null
    note: string
  }>
}

export interface AiScreenResponse extends ScreenResponse {
  description: string
  explanation?: string
  used_fallback?: boolean
  fallback_model?: string | null
}

function buildQuery(params: Record<string, string | number | boolean | undefined>) {
  const usp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) usp.set(k, String(v))
  }
  return usp.toString()
}

function formatActual(actual: number | boolean | null): string {
  if (actual === null || actual === undefined) return '-'
  if (typeof actual === 'boolean') return actual ? '真' : '假'
  if (typeof actual === 'number') {
    if (Number.isInteger(actual)) return String(actual)
    return actual.toFixed(2)
  }
  return String(actual)
}

export function StrategyScreener({ scope = 'all', onHit }: StrategyScreenerProps = {}) {
  // Manual common-strategy screening (7 boolean switches)
  const [ma_bull, setMa_bull] = useState(true)
  const [ma_slope, setMa_slope] = useState(false)
  const [slope_min, setSlope_min] = useState(0.05)
  const [kdj_golden, setKdj_golden] = useState(false)
  const [kdj_max, setKdj_max] = useState(80)
  const [rsi_mid, setRsi_mid] = useState(false)
  const [rsi_min, setRsi_min] = useState(50)
  const [rsi_max, setRsi_max] = useState(70)
  const [macd_pos, setMacd_pos] = useState(false)
  const [above_offset, setAbove_offset] = useState(false)
  const [vol_expand, setVol_expand] = useState(false)
  const [vol_ratio, setVol_ratio] = useState(1.2)
  const [limit, setLimit] = useState(50)

  const [data, setData] = useState<ScreenResponse | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [trigger, setTrigger] = useState(0)  // bump to refetch
  const lastHitTriggerRef = useRef<number>(0)

  // AI search — two-phase: LLM builds formula → confirm → scan
  const { settings: sysSettings, refresh: refreshSettings } = useSystemSettings()
  const [aiDesc, setAiDesc] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiScanning, setAiScanning] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiExplanation, setAiExplanation] = useState<string | null>(null)
  const [aiFallback, setAiFallback] = useState<string | null>(null)
  const [aiTranslated, setAiTranslated] = useState<AiScreenResponse | null>(null)

  const buildLlmPayload = (s = sysSettings) => ({
    base_url: s.llm.baseUrl,
    model: s.llm.model,
    api_key: s.llm.apiKey,
    temperature: s.llm.temperature,
    max_tokens: Math.min(s.llm.maxTokens, s.llm.contextWindow),
    fallback: s.llm.fallback
      ? {
          enabled: s.llm.fallback.enabled,
          base_url: s.llm.fallback.baseUrl,
          model: s.llm.fallback.model,
          api_key: s.llm.fallback.apiKey,
        }
      : undefined,
  })

  const runAiTranslate = async () => {
    const desc = aiDesc.trim()
    if (!desc || aiLoading || aiScanning) return
    // 頁面長期開啟時設定可能過期 — 先從 ArangoDB 拉最新，再檢查 key 並發請求
    const latest = await refreshSettings()
    const fb = latest.llm.fallback
    const hasFallback = !!fb?.enabled && !!fb?.apiKey
    if (!latest.llm.apiKey && !hasFallback) {
      setAiError('尚未設定 LLM API Key，請先到「系統設定 → 一般設定」填入')
      return
    }
    setAiLoading(true)
    setAiError(null)
    setAiExplanation(null)
    setAiFallback(null)
    setAiTranslated(null)
    try {
      const res = await fetch('/api/strategy/ai-screen/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: desc, limit, llm: buildLlmPayload(latest) }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { detail?: string } | null
        throw new Error(body?.detail ?? `AI 生成條件失敗 (${res.status})`)
      }
      const json = (await res.json()) as AiScreenResponse
      setAiTranslated(json)
      setAiExplanation(json.explanation ?? null)
      setAiFallback(json.used_fallback ? (json.fallback_model ?? '本機 dllm') : null)
      setData(null)
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e))
    } finally {
      setAiLoading(false)
    }
  }

  const runAiScan = async () => {
    if (!aiTranslated || aiScanning) return
    const latest = await refreshSettings()
    setAiScanning(true)
    setAiError(null)
    try {
      const res = await fetch('/api/strategy/ai-screen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: aiTranslated.description,
          limit,
          llm: buildLlmPayload(latest),
          conditions: aiTranslated.conditions,
          scope,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { detail?: string } | null
        throw new Error(body?.detail ?? `AI 搜尋失敗 (${res.status})`)
      }
      const json = (await res.json()) as AiScreenResponse
      setData(json)
      onHit?.(json, 'ai')
      setAiTranslated(null)
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e))
    } finally {
      setAiScanning(false)
    }
  }

  const cancelAiTranslate = () => {
    setAiTranslated(null)
    setAiExplanation(null)
    setAiFallback(null)
  }

  // Table sorting — sortable columns: stock_id, price, score
  type SortKey = 'stock_id' | 'price' | 'score'
  const [sortKey, setSortKey] = useState<SortKey>('score')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const sortedResults = useMemo(() => {
    if (!data) return []
    const rows = [...data.results]
    rows.sort((a, b) => {
      const va = a[sortKey]
      const vb = b[sortKey]
      if (sortKey === 'stock_id') {
        const na = parseInt(a.stock_id, 10) || 0
        const nb = parseInt(b.stock_id, 10) || 0
        const cmp = na - nb
        return sortDir === 'asc' ? cmp : -cmp
      }
      const av = typeof va === 'number' ? va : -Infinity
      const bv = typeof vb === 'number' ? vb : -Infinity
      const cmp = av - bv
      return sortDir === 'asc' ? cmp : -cmp
    })
    return rows
  }, [data, sortKey, sortDir])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'stock_id' ? 'asc' : 'desc')
    }
  }

  const SortIndicator = ({ col }: { col: SortKey }) =>
    sortKey === col ? (
      sortDir === 'asc' ? <ArrowUp className="inline h-3 w-3" /> : <ArrowDown className="inline h-3 w-3" />
    ) : null

  // Manual scan on trigger bump
  useEffect(() => {
    if (trigger === 0) return
    let cancelled = false
    const params: Record<string, string | number | boolean | undefined> = {
      ma_bull, ma_slope, slope_min,
      kdj_golden, kdj_max,
      rsi_mid, rsi_min, rsi_max,
      macd_pos, above_offset, vol_expand, vol_ratio, limit,
      scope,
    }
    const run = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/strategy/screen?${buildQuery(params)}`)
        if (!res.ok) throw new Error(`篩選失敗 (${res.status})`)
        const json = (await res.json()) as ScreenResponse
        if (!cancelled) {
          setData(json)
          // Gated: only fire onHit when trigger actually changes (button click),
          // NOT on every switch toggle. Track previous trigger via ref.
          if (trigger !== lastHitTriggerRef.current) {
            lastHitTriggerRef.current = trigger
            onHit?.(json, 'manual')
          }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [trigger, ma_bull, ma_slope, slope_min, kdj_golden, kdj_max, rsi_mid, rsi_min, rsi_max, macd_pos, above_offset, vol_expand, vol_ratio, limit, scope])

  // Dynamic columns: one per condition in the active formula.
  const conditionColumns = data?.conditions ?? []

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4" />
            篩選條件
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 lg:grid-cols-10 gap-4">
            {/* Left: manual common strategies (7/10) */}
            <div className="lg:col-span-7 space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-3 gap-y-2">
                <ConditionSwitch label="MA 多頭排列 (8>21>55)" checked={ma_bull} onChange={setMa_bull} />
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <Switch id="ma_slope" checked={ma_slope} onCheckedChange={setMa_slope} />
                    <Label htmlFor="ma_slope" className="text-xs">MA8 斜率 &gt; 門檻</Label>
                  </div>
                  {ma_slope && (
                    <Input
                      type="number"
                      step={0.01}
                      value={slope_min}
                      onChange={(e) => setSlope_min(parseFloat(e.target.value) || 0)}
                      className="h-6 text-xs w-20"
                    />
                  )}
                </div>
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <Switch id="kdj_golden" checked={kdj_golden} onCheckedChange={setKdj_golden} />
                    <Label htmlFor="kdj_golden" className="text-xs">KDJ 金叉且未超買</Label>
                  </div>
                  {kdj_golden && (
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={kdj_max}
                      onChange={(e) => setKdj_max(parseInt(e.target.value, 10) || 80)}
                      className="h-6 text-xs w-20"
                    />
                  )}
                </div>
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <Switch id="rsi_mid" checked={rsi_mid} onCheckedChange={setRsi_mid} />
                    <Label htmlFor="rsi_mid" className="text-xs">RSI 區間偏多</Label>
                  </div>
                  {rsi_mid && (
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={rsi_min}
                        onChange={(e) => setRsi_min(parseInt(e.target.value, 10) || 50)}
                        className="h-6 text-xs w-16"
                      />
                      <span className="text-[10px] text-muted-foreground">~</span>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={rsi_max}
                        onChange={(e) => setRsi_max(parseInt(e.target.value, 10) || 70)}
                        className="h-6 text-xs w-16"
                      />
                    </div>
                  )}
                </div>
                <ConditionSwitch label="MACD 柱為正" checked={macd_pos} onChange={setMacd_pos} />
                <ConditionSwitch label="收盤 > 扣抵" checked={above_offset} onChange={setAbove_offset} />
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <Switch id="vol_expand" checked={vol_expand} onCheckedChange={setVol_expand} />
                    <Label htmlFor="vol_expand" className="text-xs">近5日均量放大</Label>
                  </div>
                  {vol_expand && (
                    <Input
                      type="number"
                      step={0.1}
                      min={1}
                      value={vol_ratio}
                      onChange={(e) => setVol_ratio(parseFloat(e.target.value) || 1.2)}
                      className="h-6 text-xs w-20"
                    />
                  )}
                </div>
                <div className="flex flex-col gap-0.5">
                  <Label className="text-xs text-muted-foreground">回傳筆數</Label>
                  <Input
                    type="number"
                    min={1}
                    max={200}
                    value={limit}
                    onChange={(e) => setLimit(parseInt(e.target.value, 10) || 50)}
                    className="h-6 text-xs w-20"
                  />
                </div>
              </div>
              <Button size="sm" onClick={() => setTrigger((n) => n + 1)} disabled={isLoading}>
                <TrendingUp className="h-3.5 w-3.5" />
                {isLoading ? '掃描中…' : '執行掃描'}
              </Button>
            </div>

            {/* Right: AI search (3/10) */}
            <div className="lg:col-span-3 space-y-2 lg:border-l lg:border-border lg:pl-4">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5" />
                AI 選股（兩階段）
              </div>
              <Input
                className="h-7 text-xs w-full"
                value={aiDesc}
                onChange={(e) => setAiDesc(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') runAiTranslate() }}
                placeholder="用一句話描述想找的股票，例如：RSI從超賣區回升"
              />
              <Button
                size="sm"
                className="w-full"
                onClick={runAiTranslate}
                disabled={aiLoading || aiScanning || !aiDesc.trim()}
              >
                {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {aiLoading ? '生成條件中…' : aiTranslated ? '重新生成' : 'AI 生成條件'}
              </Button>

              {aiTranslated && (
                <div className="rounded-md border border-border bg-muted/20 p-2 space-y-2">
                  <p className="text-[10px] text-muted-foreground">
                    AI 理解：<b>{aiExplanation}</b>
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {aiTranslated.conditions.map((c, idx) => (
                      <span
                        key={`${c.metric}-${idx}`}
                        className="inline-flex items-center gap-0.5 rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary"
                      >
                        ✓ {c.note}
                      </span>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    確認條件無誤後開始掃描；翻譯不對可重新輸入描述。
                  </p>
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      className="h-6 text-[11px] flex-1"
                      onClick={runAiScan}
                      disabled={aiScanning}
                    >
                      {aiScanning ? <Loader2 className="h-3 w-3 animate-spin" /> : <TrendingUp className="h-3 w-3" />}
                      {aiScanning ? '掃描中…' : '✓ 確認並搜索'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[11px]"
                      onClick={cancelAiTranslate}
                      disabled={aiScanning}
                    >
                      取消
                    </Button>
                  </div>
                </div>
              )}

              {!aiTranslated && aiExplanation && (
                <p className="text-[10px] text-muted-foreground px-0.5">
                  AI 理解：<b>{aiExplanation}</b>
                </p>
              )}
              {aiFallback && (
                <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600">
                  ⚠️ 主要 LLM 連線失敗，已自動改用本機 dllm（{aiFallback}）
                </p>
              )}
              {aiError && (
                <p className="text-[10px] text-destructive px-0.5">錯誤：{aiError}</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {data && (
        <p className="text-xs text-muted-foreground px-1">
          掃描 <b>{data.scanned}</b> 檔，符合條件 <b>{data.total}</b> 檔
        </p>
      )}

      {error && (
        <p className="text-xs text-destructive px-1">錯誤：{error}</p>
      )}

      {isLoading && <Skeleton className="h-32 w-full" />}
      {aiScanning && <Skeleton className="h-32 w-full" />}

      {data && data.results.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="max-h-[60vh] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-background">
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="px-2 py-1 text-left font-medium cursor-pointer select-none hover:text-foreground" onClick={() => toggleSort('stock_id')}>
                      股票 <SortIndicator col="stock_id" />
                    </th>
                    <th className="px-2 py-1 text-right font-medium cursor-pointer select-none hover:text-foreground" onClick={() => toggleSort('price')}>
                      <span className="inline-flex items-center gap-0.5 justify-end">價格 <SortIndicator col="price" /></span>
                    </th>
                    <th className="px-2 py-1 text-right font-medium cursor-pointer select-none hover:text-foreground" onClick={() => toggleSort('score')}>
                      <span className="inline-flex items-center gap-0.5 justify-end">分數 <SortIndicator col="score" /></span>
                    </th>
                    {conditionColumns.map((c, idx) => (
                      <th key={`${c.metric}-${idx}`} className="px-2 py-1 text-right font-medium" title={c.metric}>
                        {c.note}
                      </th>
                    ))}
                    <th className="px-2 py-1 text-right font-medium">命中</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedResults.map((r) => (
                    <tr key={r.stock_id} className="border-b border-border/40 hover:bg-muted/30">
                      <td className="px-2 py-1">
                        <div className="font-mono leading-tight">
                          <a href={`/stock/${r.stock_id}`} className="text-primary hover:underline">{r.stock_id}</a>
                        </div>
                        <div className="leading-tight text-[10px] text-muted-foreground">
                          {r.name}
                        </div>
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">{r.price ?? '-'}</td>
                      <td className="px-2 py-1 text-right tabular-nums font-bold">{r.score}</td>
                      {conditionColumns.map((c, idx) => {
                        const cr = r.condition_results.find((x) => x.metric === c.metric && x.op === c.op)
                        const passed = cr?.passed ?? false
                        return (
                          <td
                            key={`${c.metric}-${idx}`}
                            className={`px-2 py-1 text-right tabular-nums ${passed ? 'text-foreground' : 'text-muted-foreground'}`}
                          >
                            <span className={passed ? '' : 'line-through decoration-muted-foreground/40'}>
                              {cr ? formatActual(cr.actual) : '-'}
                            </span>
                            <span className="ml-0.5">{passed ? '✓' : '✗'}</span>
                          </td>
                        )
                      })}
                      <td className="px-2 py-1 text-right tabular-nums">
                        {r.passed_count}/{r.total_conditions}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {data && data.results.length === 0 && (
        <p className="text-xs text-muted-foreground px-1">無符合條件的股票，請調整條件或降低門檻。</p>
      )}
    </div>
  )
}

function ConditionSwitch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Switch id={label} checked={checked} onCheckedChange={onChange} />
      <Label htmlFor={label} className="text-xs">{label}</Label>
    </div>
  )
}
