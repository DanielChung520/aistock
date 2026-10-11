'use client'

import { useEffect, useState } from 'react'
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
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { Plus, X } from 'lucide-react'

const PRESET_TAGS = ['baseline', 'production', 'experimental', 'retired']
const NAME_PATTERN = /^\d{8}-\d{4}-\d{3}$/

function defaultName(): string {
  const d = new Date()
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  const hm = `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`
  return `${ymd}-${hm}-001`
}

interface Props {
  isOpen: boolean
  onClose: () => void
  onCreated: (jobId: string) => void
}

export function CreateProjectDialog({ isOpen, onClose, onCreated }: Props) {
  const [name, setName] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [customTag, setCustomTag] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setName(defaultName())
      setTags([])
      setCustomTag('')
      setDescription('')
    }
  }, [isOpen])

  const toggleTag = (t: string) => {
    setTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))
  }

  const addCustomTag = () => {
    const t = customTag.trim()
    if (!t) return
    if (!tags.includes(t)) setTags((prev) => [...prev, t])
    setCustomTag('')
  }

  const submit = async () => {
    if (!name.trim()) {
      toast.error('請輸入訓練名稱')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/ai-training/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          tags,
          description: description.trim(),
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        throw new Error(err?.detail ?? `HTTP ${res.status}`)
      }
      const data = await res.json()
      toast.success('訓練項目已建立', { description: data.job_id })
      onCreated(data.job_id)
    } catch (e) {
      toast.error('建立失敗', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新建訓練</DialogTitle>
          <DialogDescription>
            建立訓練項目，設定名稱與標籤後進入 wizard 完成訓練設定。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-xs">名稱 <span className="text-destructive">*</span></Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="20260809-1500-001"
              className="h-8 text-xs font-mono"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              預設 {NAME_PATTERN.test(name) ? '' : '格式 '}<code className="bg-muted px-1 rounded">YYYYMMDD-HHmm-NNN</code>；同名不阻擋。
            </p>
          </div>

          <div>
            <Label className="text-xs">標籤</Label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {PRESET_TAGS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleTag(t)}
                  className={
                    'px-2 py-0.5 rounded text-[11px] border transition-colors ' +
                    (tags.includes(t)
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-card border-border hover:bg-muted')
                  }
                >
                  {t}
                </button>
              ))}
              {tags.filter((t) => !PRESET_TAGS.includes(t)).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleTag(t)}
                  className="px-2 py-0.5 rounded text-[11px] border bg-primary text-primary-foreground border-primary inline-flex items-center gap-1"
                >
                  {t}
                  <X className="h-2.5 w-2.5" />
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 mt-2">
              <Input
                value={customTag}
                onChange={(e) => setCustomTag(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCustomTag())}
                placeholder="自訂標籤後按 Enter"
                className="h-7 text-xs flex-1"
              />
              <Button size="sm" variant="outline" onClick={addCustomTag} className="h-7 px-2">
                <Plus className="h-3 w-3" />
              </Button>
            </div>
          </div>

          <div>
            <Label className="text-xs">描述（選填）</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="XGBoost 基線，89 欄特徵…"
              className="text-xs min-h-[60px] resize-none"
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button size="sm" onClick={submit} disabled={submitting || !name.trim()}>
            {submitting ? '建立中…' : '建立並開始設定'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
