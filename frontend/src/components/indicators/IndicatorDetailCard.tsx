'use client'

import { useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  CircleCheck,
  CircleX,
  Info,
  Save,
  Pencil,
  X,
  Loader2,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { IndicatorKbDoc } from '@/app/api/indicators/route'

const CATEGORY_LABELS: Record<string, string> = {
  trend: '趨勢',
  momentum: '動能',
  volatility: '波動',
  volume: '量能',
  pattern: '型態',
  statistical: '統計',
}

interface IndicatorDetailCardProps {
  doc: IndicatorKbDoc
  defaultOpen?: boolean
  onSaved?: (updated: IndicatorKbDoc) => void
}

export function IndicatorDetailCard({ doc, defaultOpen = false, onSaved }: IndicatorDetailCardProps) {
  const [open, setOpen] = useState(defaultOpen)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<IndicatorKbDoc | null>(null)
  const [tagsText, setTagsText] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const current = draft ?? doc

  const beginEdit = () => {
    setDraft(doc)
    setTagsText((doc.tags ?? []).join(', '))
    setSaveError(null)
    setEditing(true)
  }

  const cancelEdit = () => {
    setDraft(null)
    setSaveError(null)
    setEditing(false)
  }

  const update = (patch: Partial<IndicatorKbDoc>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d))
  }

  const handleParamChange = (
    index: number,
    field: 'name' | 'default' | 'tw_convention',
    val: string,
  ) => {
    setDraft((d) => {
      if (!d) return d
      const parameters = d.parameters.map((p, i) => {
        if (i !== index) return p
        if (field === 'name') return { ...p, name: val }
        if (field === 'default') return { ...p, default: parseFloat(val) || 0 }
        return { ...p, tw_convention: val }
      })
      return { ...d, parameters }
    })
  }

  const handleSignalChange = (index: number, field: 'pattern' | 'condition', val: string) => {
    setDraft((d) => {
      if (!d) return d
      const signals = d.signals.map((s, i) => (i === index ? { ...s, [field]: val } : s))
      return { ...d, signals }
    })
  }

  const handleSave = async () => {
    if (!draft) return
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch(`/api/indicators/${draft.metric}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `儲存失敗（HTTP ${res.status}）`)
      }
      onSaved?.(draft)
      setEditing(false)
      setDraft(null)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : '儲存失敗')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-1 text-left hover:bg-muted/40 transition-colors"
      >
        <code className="font-mono text-xs font-medium text-foreground shrink-0">{current.metric}</code>
        <span className="text-xs truncate">{current.name}</span>
        {current.category && (
          <Badge variant="outline" className="shrink-0 text-[10px] py-0 leading-none">
            {CATEGORY_LABELS[current.category] ?? current.category}
          </Badge>
        )}
        {(current.tags ?? []).length > 0 && (
          <span className="hidden lg:flex items-center gap-1 flex-wrap min-w-0">
            {(current.tags ?? []).slice(0, 3).map((t) => (
              <Badge key={t} variant="secondary" className="shrink-0 text-[10px] py-0 leading-none">
                {t}
              </Badge>
            ))}
            {(current.tags ?? []).length > 3 && (
              <span className="text-[10px] text-muted-foreground shrink-0">
                +{(current.tags ?? []).length - 3}
              </span>
            )}
          </span>
        )}
        <Badge
          variant={current.implementation?.implemented ? 'default' : 'secondary'}
          className="shrink-0 text-[10px] py-0 leading-none"
        >
          {current.implementation?.implemented ? '已實作' : '知識庫收錄'}
        </Badge>
        <span className="ml-auto shrink-0">
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span>
      </button>

      {open && (
        <CardContent className="px-4 pb-4 pt-0 space-y-3">
          <div className="flex items-center gap-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              LLM 意圖
            </div>
            {!editing ? (
              <Button variant="outline" size="sm" className="h-6 px-2 text-xs ml-auto" onClick={beginEdit}>
                <Pencil className="h-3 w-3 mr-1" />
                編輯
              </Button>
            ) : (
              <div className="flex items-center gap-1 ml-auto">
                <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={cancelEdit}>
                  <X className="h-3 w-3 mr-1" />
                  取消
                </Button>
                <Button size="sm" className="h-6 px-2 text-xs" onClick={handleSave} disabled={saving}>
                  {saving ? (
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  ) : (
                    <Save className="h-3 w-3 mr-1" />
                  )}
                  儲存
                </Button>
              </div>
            )}
          </div>

          {saveError && <div className="text-xs text-red-500">{saveError}</div>}

          {editing ? (
            <Input
              value={current.llm_intent ?? ''}
              onChange={(e) => update({ llm_intent: e.target.value })}
              className="h-8 text-sm"
            />
          ) : (
            <div className="text-sm text-foreground">{current.llm_intent || '—'}</div>
          )}

          <div className="text-sm text-muted-foreground">{current.definition}</div>

          {current.formula && (
            <div className="rounded-md bg-muted/50 p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                公式
              </div>
              <code className="text-xs text-foreground whitespace-pre-wrap">{current.formula}</code>
            </div>
          )}

          {/* 參數設置 */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
              參數設置
            </div>
            <div className="space-y-1.5">
              {current.parameters.map((p, i) => (
                <div key={`${p.name}-${i}`} className="flex items-center gap-2 text-xs">
                  {editing ? (
                    <>
                      <Input
                        value={p.name}
                        onChange={(e) => handleParamChange(i, 'name', e.target.value)}
                        className="h-7 w-20 font-mono text-xs"
                      />
                      <Input
                        type="number"
                        value={p.default}
                        onChange={(e) => handleParamChange(i, 'default', e.target.value)}
                        className="h-7 w-20 text-xs"
                      />
                      <span className="text-muted-foreground shrink-0">
                        範圍 [{p.range?.[0]} – {p.range?.[1]}]
                      </span>
                      <Input
                        value={p.tw_convention ?? ''}
                        placeholder="台股慣例"
                        onChange={(e) => handleParamChange(i, 'tw_convention', e.target.value)}
                        className="h-7 flex-1 text-xs"
                      />
                    </>
                  ) : (
                    <>
                      <code className="font-mono text-foreground shrink-0">{p.name}</code>
                      <span className="text-muted-foreground">
                        預設 {p.default}，範圍 [{p.range?.[0]} – {p.range?.[1]}]
                      </span>
                      {p.tw_convention && (
                        <span className="text-muted-foreground/70 truncate">（{p.tw_convention}）</span>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* 訊號 */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
              訊號
            </div>
            {editing ? (
              <div className="space-y-1.5">
                {current.signals.map((s, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <Input
                      value={s.pattern}
                      onChange={(e) => handleSignalChange(i, 'pattern', e.target.value)}
                      className="h-7 w-32 text-xs"
                    />
                    <Input
                      value={s.condition}
                      onChange={(e) => handleSignalChange(i, 'condition', e.target.value)}
                      className="h-7 flex-1 text-xs font-mono"
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {current.signals.map((s) => (
                  <span
                    key={s.pattern}
                    title={s.condition}
                    className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 py-0.5 text-xs text-foreground"
                  >
                    {s.pattern}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* 標籤 */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
              標籤
            </div>
            {editing ? (
              <Input
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
                onBlur={() =>
                  update({
                    tags: tagsText.split(',').map((s) => s.trim()).filter(Boolean),
                  })
                }
                placeholder="以逗號分隔，如：超買, 動能, 反轉"
                className="h-8 text-sm"
              />
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {(current.tags ?? []).map((t) => (
                  <Badge key={t} variant="secondary" className="text-[10px]">
                    {t}
                  </Badge>
                ))}
                {(current.tags ?? []).length === 0 && (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </div>
            )}
          </div>

          {/* 備註 */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              備註
            </div>
            {editing ? (
              <Textarea
                value={current.notes ?? ''}
                onChange={(e) => update({ notes: e.target.value })}
                className="min-h-16 text-xs"
              />
            ) : (
              <div className="text-xs text-muted-foreground">{current.notes || '—'}</div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            {current.implementation && (
              <span className="inline-flex items-center gap-1">
                {current.implementation.implemented ? (
                  <CircleCheck className="h-3 w-3 text-red-500" />
                ) : (
                  <CircleX className="h-3 w-3 text-muted-foreground/60" />
                )}
                後端可執行{!current.implementation.implemented && '：否'}
                {current.implementation.function && `（${current.implementation.function}）`}
              </span>
            )}
            {current.inputs && current.inputs.length > 0 && (
              <span>輸入：{current.inputs.join(' / ')}</span>
            )}
            {current.depends_on && current.depends_on.length > 0 && (
              <span>依賴：{current.depends_on.join('、')}</span>
            )}
            {current.combines_with && current.combines_with.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <Info className="h-3 w-3" />
                常搭配：{current.combines_with.join('、')}
              </span>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  )
}
