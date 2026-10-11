'use client'

import { useState } from 'react'
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
import { Loader2 } from 'lucide-react'

interface Props {
  target: { job_id: string; name: string } | null
  onClose: () => void
  onDeleted: (jobId: string) => void
}

export function DeleteProjectDialog({ target, onClose, onDeleted }: Props) {
  const [deleting, setDeleting] = useState(false)

  const confirm = async () => {
    if (!target) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/ai-training/projects/${target.job_id}`, {
        method: 'DELETE',
      })
      if (!res.ok && res.status !== 204) {
        const err = await res.json().catch(() => null)
        throw new Error(err?.detail ?? `HTTP ${res.status}`)
      }
      toast.success('已刪除', { description: target.name })
      onDeleted(target.job_id)
    } catch (e) {
      toast.error('刪除失敗', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <AlertDialog open={target !== null} onOpenChange={(open) => !open && !deleting && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>確定要刪除此訓練項目？</AlertDialogTitle>
          <AlertDialogDescription>
            將永久刪除 <span className="font-mono font-semibold text-foreground">{target?.name}</span>，
            無法復原。
            {target && target.name !== '' && <br />}
            <span className="text-xs">（訓練結果、設定快照、評估指標都會一併刪除）</span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault()
              confirm()
            }}
            disabled={deleting}
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
