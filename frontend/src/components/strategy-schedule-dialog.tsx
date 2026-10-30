'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export interface ScheduleInfo {
  enabled: boolean
  cron: string
  notify?: boolean
  last_run: number | null
  last_status: string | null
}

interface StrategyScheduleDialogProps {
  strategyId: string
  strategyName: string
  initial: ScheduleInfo
  onClose: () => void
  onSaved: () => void
}

export const DEFAULT_CRON = '0 13 * * 1-5'

export function StrategyScheduleDialog({
  strategyId,
  strategyName,
  initial,
  onClose,
  onSaved,
}: StrategyScheduleDialogProps) {
  const [enabled, setEnabled] = useState(initial.enabled)
  const [notify, setNotify] = useState(Boolean(initial.notify))
  const [cron, setCron] = useState(initial.cron || DEFAULT_CRON)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const request = async (method: string, body?: unknown) => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/strategies/${strategyId}/schedule`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      })
      if (!res.ok) throw new Error(`操作失敗 (${res.status})`)
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>策略排程</DialogTitle>
          <DialogDescription>{strategyName}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            啟用自動執行（跑完寫入「執行記錄」）
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={notify}
              onChange={(e) => setNotify(e.target.checked)}
            />
            送出清單（排程跑完以 LINE 發送結果）
          </label>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Cron 運算式（時區 Asia/Taipei）</div>
            <Input
              value={cron}
              onChange={(e) => setCron(e.target.value)}
              placeholder={DEFAULT_CRON}
            />
            <div className="text-[11px] text-muted-foreground">
              例：<code>{DEFAULT_CRON}</code> = 週一至週五 13:00（收盤前 30 分鐘）
            </div>
          </div>
          {initial.last_run != null && (
            <div className="text-[11px] text-muted-foreground">
              上次執行：{new Date(initial.last_run * 1000).toLocaleString('zh-TW')}　狀態：
              {initial.last_status ?? '—'}
            </div>
          )}
          {error && <p className="text-xs text-destructive">錯誤：{error}</p>}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="ghost"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => request('DELETE')}
            disabled={saving}
          >
            移除排程
          </Button>
          <Button onClick={() => request('PUT', { enabled, cron, notify })} disabled={saving}>
            儲存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
