'use client'

import { useState, useMemo } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from 'sonner'
import { Loader2, AlertTriangle } from 'lucide-react'

interface BatchItem {
  job_id: string
  name: string
  status: string
}

interface BatchResult {
  deleted: string[]
  not_found: string[]
  blocked: { job_id: string; name: string; reason: string }[]
}

interface Props {
  items: BatchItem[]
  open: boolean
  onClose: () => void
  onDeleted: () => void
}

export function DeleteBatchDialog({ items, open, onClose, onDeleted }: Props) {
  const [deleting, setDeleting] = useState(false)

  const runningCount = useMemo(
    () => items.filter((i) => i.status === 'running').length,
    [items],
  )

  const confirm = async () => {
    if (items.length === 0) return
    setDeleting(true)
    try {
      const res = await fetch('/api/ai-training/projects/batch-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_ids: items.map((i) => i.job_id) }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        throw new Error(err?.detail ?? `HTTP ${res.status}`)
      }
      const result: BatchResult = await res.json()
      const parts: string[] = []
      if (result.deleted.length) parts.push(`已刪除 ${result.deleted.length} 筆`)
      if (result.blocked.length) parts.push(`${result.blocked.length} 筆訓練中需先停止`)
      if (result.not_found.length) parts.push(`${result.not_found.length} 筆已不存在`)
      toast.success('批量刪除完成', { description: parts.join('、') || '無變更' })
      onDeleted()
    } catch (e) {
      toast.error('批量刪除失敗', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && !deleting && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>確定批量刪除 {items.length} 筆訓練項目？</AlertDialogTitle>
          <AlertDialogDescription>
            將永久刪除以下項目，無法復原。
            <br />
            <span className="text-xs">（訓練結果、設定快照、評估指標都會一併刪除）</span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {runningCount > 0 && (
          <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              其中 <span className="font-semibold">{runningCount}</span> 筆正在訓練中，
              會被自動跳過。請先至該項目停止訓練，再重新刪除。
            </div>
          </div>
        )}
        <div className="max-h-40 overflow-y-auto rounded border border-border/60 bg-muted/30 px-3 py-2 text-xs">
          {items.map((i) => (
            <div key={i.job_id} className="flex items-center gap-2 py-0.5">
              <span className="font-mono truncate flex-1">{i.name}</span>
              {i.status === 'running' && (
                <span className="text-[10px] text-amber-600 dark:text-amber-400">
                  training → 跳過
                </span>
              )}
            </div>
          ))}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault()
              confirm()
            }}
            disabled={deleting || items.length === 0}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleting && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
            {deleting ? '刪除中…' : '確定刪除'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}