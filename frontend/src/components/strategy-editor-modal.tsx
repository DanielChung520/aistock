'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Sparkles, Loader2, Play, Plus, X } from 'lucide-react'
import { useSystemSettings } from '@/hooks/use-system-settings'

interface ConditionSpec {
  metric: string
  op: string
  value: number | string | null
  note: string
  tf?: string
}

interface IndicatorSpec {
  metric: string
  type: string
  name: string
}

export interface EditorStrategy {
  id: string
  name: string
  description: string
  conditions: ConditionSpec[]
}

interface TestResult {
  total: number
  scanned: number
  results: { stock_id: string; name?: string | null; score: number }[]
}

interface StrategyEditorModalProps {
  open: boolean
  strategy: EditorStrategy | null
  onClose: () => void
  onSaved?: () => void
}

const TABS = [
  { id: 'script', label: '腳本' },
  { id: 'conditions', label: '條件' },
  { id: 'explain', label: 'AI 解釋' },
  { id: 'test', label: '測試' },
] as const

type TabId = (typeof TABS)[number]['id']

function renderCondition(cond: ConditionSpec): string {
  const expr = cond.op === 'is_true' ? cond.metric : `${cond.metric} ${cond.op} ${cond.value}`
  if (cond.tf === 'w') return `weekly(${expr})`
  if (cond.tf === '15m') return `m15(${expr})`
  return expr
}

function conditionNote(cond: ConditionSpec): string {
  return cond.op === 'is_true' ? cond.metric : `${cond.metric} ${cond.op} ${cond.value}`
}

interface MermaidApi {
  initialize: (config: Record<string, unknown>) => void
  render: (id: string, code: string) => Promise<{ svg: string }>
}

let mermaidLoader: Promise<MermaidApi> | null = null

function loadMermaid(): Promise<MermaidApi> {
  if (mermaidLoader) return mermaidLoader
  mermaidLoader = new Promise<MermaidApi>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://cdn.jsdelivr.net/npm/mermaid@10.9.8/dist/mermaid.min.js'
    script.onload = () => {
      const api = (window as unknown as { mermaid?: MermaidApi }).mermaid
      if (!api) {
        reject(new Error('mermaid 載入失敗'))
        return
      }
      api.initialize({ startOnLoad: false, theme: 'dark' })
      resolve(api)
    }
    script.onerror = () => reject(new Error('mermaid 載入失敗'))
    document.head.appendChild(script)
  })
  return mermaidLoader
}

function Mermaid({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let cancelled = false
    void loadMermaid()
      .then((api) => {
        const id = `mermaid-${Math.random().toString(36).slice(2)}`
        return api.render(id, code).then(({ svg }) => {
          if (!cancelled && ref.current) ref.current.innerHTML = svg
        })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [code])
  return <div ref={ref} className="my-2 overflow-x-auto" />
}

function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={idx}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={idx} className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
          {part.slice(1, -1)}
        </code>
      )
    }
    return part
  })
}

function MarkdownLite({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  const lines = text.split('\n')
  let i = 0
  let key = 0
  while (i < lines.length) {
    const line = lines[i]
    const fence = line.match(/^```(\w*)/)
    if (fence) {
      const lang = fence[1]
      const buf: string[] = []
      i += 1
      while (i < lines.length && !lines[i].startsWith('```')) {
        buf.push(lines[i])
        i += 1
      }
      i += 1
      const code = buf.join('\n')
      blocks.push(
        lang === 'mermaid' ? (
          <Mermaid key={key++} code={code} />
        ) : (
          <pre
            key={key++}
            className="my-2 overflow-x-auto rounded bg-muted p-2 font-mono text-[11px]"
          >
            {code}
          </pre>
        )
      )
      continue
    }
    const heading = line.match(/^(#{1,3})\s+(.*)$/)
    if (heading) {
      const level = heading[1].length
      const cls =
        level <= 2 ? 'mt-2 mb-1 text-sm font-semibold' : 'mt-1 mb-0.5 text-xs font-semibold'
      blocks.push(
        <p key={key++} className={cls}>
          {renderInline(heading[2])}
        </p>
      )
      i += 1
      continue
    }
    const item = line.match(/^\s*[-*]\s+(.*)$/)
    if (item) {
      blocks.push(
        <p key={key++} className="my-0.5 pl-4">
          • {renderInline(item[1])}
        </p>
      )
      i += 1
      continue
    }
    if (line.trim() === '') {
      i += 1
      continue
    }
    blocks.push(
      <p key={key++} className="my-1 leading-relaxed">
        {renderInline(line)}
      </p>
    )
    i += 1
  }
  return <div className="text-xs">{blocks}</div>
}

function renderScript(conditions: ConditionSpec[]): string {
  const body = conditions.map(renderCondition).join(' and ')
  return `buy = ${body || 'False'}`
}

export function StrategyEditorModal({ open, strategy, onClose, onSaved }: StrategyEditorModalProps) {
  const [tab, setTab] = useState<TabId>('script')
  const [name, setName] = useState(() => strategy?.name ?? '')
  const [description, setDescription] = useState(() => strategy?.description ?? '')
  const [script, setScript] = useState(() => renderScript(strategy?.conditions ?? []))
  const [conditions, setConditions] = useState<ConditionSpec[]>(() => strategy?.conditions ?? [])
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiExplanation, setAiExplanation] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [testScope, setTestScope] = useState('all')
  const [testLoading, setTestLoading] = useState(false)
  const [testError, setTestError] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [explainLoading, setExplainLoading] = useState(false)
  const [explainError, setExplainError] = useState<string | null>(null)
  const [explainMarkdown, setExplainMarkdown] = useState<string | null>(null)
  const [indicators, setIndicators] = useState<IndicatorSpec[]>([])
  const [ops, setOps] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    fetch('/api/strategy/indicators')
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: { indicators?: IndicatorSpec[]; ops?: string[] }) => {
        if (!cancelled) {
          setIndicators(d.indicators ?? [])
          setOps(d.ops ?? [])
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const { settings, refresh } = useSystemSettings()

  const buildLlmPayload = (s = settings) => ({
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

  const generateScript = async () => {
    const desc = aiPrompt.trim()
    if (!desc || aiLoading) return
    const latest = await refresh()
    const fb = latest.llm.fallback
    if (!latest.llm.apiKey && !(fb?.enabled && fb?.apiKey)) {
      setAiError('尚未設定 LLM API Key，請先到「系統設定 → 一般設定」填入')
      return
    }
    setAiLoading(true)
    setAiError(null)
    setAiExplanation(null)
    try {
      const res = await fetch('/api/strategy/generate-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: desc, llm: buildLlmPayload(latest) }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { detail?: string } | null
        throw new Error(body?.detail ?? `生成失敗 (${res.status})`)
      }
      const json = (await res.json()) as {
        script: string
        conditions: ConditionSpec[]
        explanation?: string
      }
      setScript(json.script)
      setConditions(json.conditions ?? [])
      setAiExplanation(json.explanation ?? null)
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e))
    } finally {
      setAiLoading(false)
    }
  }

  const save = async () => {
    if (saving) return
    if (!name.trim()) {
      setSaveError('請輸入策略名稱')
      return
    }
    if (conditions.length === 0) {
      setSaveError('請至少有一個條件（可用 AI 生成，或於「條件」頁新增）')
      return
    }
    const isNew = strategy?.id === '__new__'
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch(isNew ? '/api/strategies' : `/api/strategies/${strategy?.id}`, {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: description.trim(), conditions }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { detail?: string } | null
        throw new Error(body?.detail ?? `儲存失敗 (${res.status})`)
      }
      onSaved?.()
      onClose()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const runTest = async () => {
    if (testLoading) return
    setTestLoading(true)
    setTestError(null)
    try {
      const res = await fetch('/api/strategy/run-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script, limit: 20, scope: testScope }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { detail?: string } | null
        throw new Error(body?.detail ?? `測試失敗 (${res.status})`)
      }
      const json = (await res.json()) as TestResult
      setTestResult({ total: json.total, scanned: json.scanned, results: json.results ?? [] })
    } catch (e) {
      setTestError(e instanceof Error ? e.message : String(e))
    } finally {
      setTestLoading(false)
    }
  }

  const generateExplain = async () => {
    if (explainLoading) return
    if (conditions.length === 0) {
      setExplainError('沒有條件可解釋')
      return
    }
    const latest = await refresh()
    setExplainLoading(true)
    setExplainError(null)
    try {
      const res = await fetch('/api/strategy/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, conditions, llm: buildLlmPayload(latest) }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { detail?: string } | null
        throw new Error(body?.detail ?? `生成失敗 (${res.status})`)
      }
      const json = (await res.json()) as { markdown: string }
      setExplainMarkdown(json.markdown ?? '')
    } catch (e) {
      setExplainError(e instanceof Error ? e.message : String(e))
    } finally {
      setExplainLoading(false)
    }
  }

  const updateConditions = (next: ConditionSpec[]) => {
    setConditions(next)
    setScript(renderScript(next))
  }

  const patchCondition = (index: number, patch: Partial<ConditionSpec>) => {
    updateConditions(
      conditions.map((c, i) => {
        if (i !== index) return c
        const merged = { ...c, ...patch }
        return { ...merged, note: conditionNote(merged) }
      })
    )
  }

  const parseScriptNow = async () => {
    try {
      const res = await fetch('/api/strategy/parse-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script }),
      })
      if (!res.ok) return
      const json = (await res.json()) as { conditions: ConditionSpec[]; script: string }
      setConditions(json.conditions ?? [])
      setScript(json.script)
      setAiError(null)
    } catch {
      return
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>編輯策略</DialogTitle>
          <DialogDescription>
            以自然語言生成策略腳本與條件；腳本可執行掃描。（腳本可編輯）
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="策略名稱"
          />
          <Input
            className="md:col-span-2"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="簡述"
          />
        </div>

        <div className="flex gap-1 border-b border-border">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`-mb-px border-b-2 px-3 py-1.5 text-sm transition-colors ${
                tab === t.id
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="min-h-[300px]">
          {tab === 'script' && (
            <div className="space-y-2">
              <Textarea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="用一句話描述策略，例如：外資與投信同步買超、且股價站上季線的權值股"
                className="min-h-[56px] text-sm"
              />
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={generateScript} disabled={aiLoading || !aiPrompt.trim()}>
                  {aiLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  {aiLoading ? '生成中…' : 'AI 生成腳本'}
                </Button>
                {aiExplanation && (
                  <span className="truncate text-[11px] text-muted-foreground">AI：{aiExplanation}</span>
                )}
              </div>
              {aiError && <p className="text-[11px] text-destructive">錯誤：{aiError}</p>}
              <Textarea
                value={script}
                onChange={(e) => setScript(e.target.value)}
                onBlur={() => {
                  void parseScriptNow()
                }}
                spellCheck={false}
                className="min-h-[180px] font-mono text-xs"
              />
            </div>
          )}

          {tab === 'conditions' && (
            <div className="space-y-2">
              {conditions.length === 0 && (
                <p className="text-sm text-muted-foreground">尚無條件，按下方「新增條件」。</p>
              )}
              {conditions.map((c, idx) => (
                <div key={idx} className="flex items-center gap-1.5">
                  <select
                    value={c.metric}
                    onChange={(e) => patchCondition(idx, { metric: e.target.value })}
                    className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs"
                  >
                    {indicators.map((ind) => (
                      <option key={ind.metric} value={ind.metric}>
                        {ind.metric}（{ind.name}）
                      </option>
                    ))}
                  </select>
                  <select
                    value={c.op}
                    onChange={(e) =>
                      patchCondition(idx, {
                        op: e.target.value,
                        value: e.target.value === 'is_true' ? null : c.value ?? 0,
                      })
                    }
                    className="h-8 w-24 rounded-md border border-border bg-background px-1 text-xs"
                  >
                    {ops.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                  <input
                    value={c.op === 'is_true' ? '' : String(c.value ?? '')}
                    disabled={c.op === 'is_true'}
                    onChange={(e) => {
                      const raw = e.target.value
                      const num = Number(raw)
                      patchCondition(idx, {
                        value: raw !== '' && !Number.isNaN(num) ? num : raw,
                      })
                    }}
                    placeholder="值/指標"
                    className="h-8 w-24 rounded-md border border-border bg-background px-2 text-xs disabled:opacity-40"
                  />
                  <select
                    value={c.tf ?? 'd'}
                    onChange={(e) => patchCondition(idx, { tf: e.target.value })}
                    className="h-8 w-20 rounded-md border border-border bg-background px-1 text-xs"
                  >
                    <option value="d">日K</option>
                    <option value="w">週K</option>
                    <option value="15m">15分</option>
                  </select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label="刪除條件"
                    onClick={() => updateConditions(conditions.filter((_, i) => i !== idx))}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  updateConditions([
                    ...conditions,
                    { metric: 'rsi', op: '>', value: 60, note: 'rsi > 60' },
                  ])
                }
              >
                <Plus className="h-3.5 w-3.5" />
                新增條件
              </Button>
            </div>
          )}

          {tab === 'explain' && (
            <div className="space-y-2">
              <Button
                size="sm"
                onClick={generateExplain}
                disabled={explainLoading || conditions.length === 0}
              >
                {explainLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                {explainLoading ? '生成中…' : '生成解釋'}
              </Button>
              {explainError && <p className="text-[11px] text-destructive">錯誤：{explainError}</p>}
              {explainMarkdown && (
                <div className="max-h-[360px] overflow-auto rounded border border-border p-3">
                  <MarkdownLite text={explainMarkdown} />
                </div>
              )}
            </div>
          )}

          {tab === 'test' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">掃描範圍</span>
                <select
                  value={testScope}
                  onChange={(e) => setTestScope(e.target.value)}
                  className="h-8 rounded-md border border-border bg-background px-2 text-sm"
                >
                  <option value="all">全部</option>
                  <option value="watchlist">自選股</option>
                </select>
                <Button size="sm" onClick={runTest} disabled={testLoading}>
                  {testLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                  執行測試
                </Button>
              </div>
              {testError && <p className="text-[11px] text-destructive">錯誤：{testError}</p>}
              {testResult && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    掃描 <b>{testResult.scanned}</b> 檔，命中 <b>{testResult.total}</b> 檔
                  </p>
                  <div className="max-h-[220px] overflow-auto rounded border border-border">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-background">
                        <tr className="border-b border-border text-muted-foreground">
                          <th className="px-2 py-1 text-left font-medium">股號 / 名稱</th>
                          <th className="px-2 py-1 text-right font-medium">評價分</th>
                        </tr>
                      </thead>
                      <tbody>
                        {testResult.results.map((r) => (
                          <tr key={r.stock_id} className="border-b border-border/40">
                            <td className="px-2 py-1">
                              <a href={`/stock/${r.stock_id}`} className="font-mono text-primary hover:underline">
                                {r.stock_id}
                              </a>
                              <span className="ml-2 text-muted-foreground">{r.name}</span>
                            </td>
                            <td className="px-2 py-1 text-right tabular-nums">{r.score}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {testResult.total > testResult.results.length && (
                    <p className="text-[10px] text-muted-foreground">
                      僅顯示前 {testResult.results.length} 檔
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          <span className="text-[11px] text-muted-foreground">
            {saveError ? (
              <span className="text-destructive">{saveError}</span>
            ) : (
              '腳本可執行：送入 /api/strategy/run-script'
            )}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              取消
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              儲存
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
