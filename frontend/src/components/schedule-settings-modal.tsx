'use client'

import { useEffect, useState } from 'react'
import { Loader2, Play, Save, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'

const JOB_ICONS: Record<string, string> = {
  data_download: '📥',
  vp_calculation: '📊',
  tech_indicators: '📈',
  history_cleanup: '🗑️',
}

interface ScheduleSettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

export function ScheduleSettingsModal({ isOpen, onClose }: ScheduleSettingsModalProps) {
  const [jobs, setJobs] = useState<any[]>([])
  const [selected, setSelected] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState<string | null>(null)

  const fetchJobs = async () => {
    try {
      const res = await fetch('/api/schedule/jobs')
      if (res.ok) {
        const data = await res.json()
        setJobs(data)
        if (!selected && data.length > 0) setSelected(data[0])
      }
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }

  useEffect(() => {
    if (isOpen) {
      setLoading(true)
      fetchJobs()
    }
  }, [isOpen])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  const handleSave = async () => {
    if (!selected) return
    setSaving(true)
    try {
      await fetch(`/api/schedule/jobs/${selected._key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: selected.enabled, cron: selected.cron, params: selected.params }),
      })
      await fetchJobs()
    } catch { /* ignore */ }
    finally { setSaving(false) }
  }

  const handleRun = async (key: string) => {
    setRunning(key)
    try {
      await fetch(`/api/schedule/jobs/${key}/run`, { method: 'POST' })
      await fetchJobs()
    } catch { /* ignore */ }
    finally { setRunning(null) }
  }

  const formatRun = (job: any) => {
    if (!job.last_run) return '尚未執行'
    return new Date(job.last_run * 1000).toLocaleString('zh-TW')
  }

  return (
    <Dialog open={isOpen} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="w-[80vw] sm:max-w-[80vw] max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            排程設置
          </DialogTitle>
          <DialogDescription>管理自動化排程任務</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex gap-4 min-h-[300px]">
            {/* Left: job list (30%) */}
            <div className="w-[30%] shrink-0 space-y-1.5 overflow-y-auto">
              {jobs.map((job) => {
                const active = selected?._key === job._key
                return (
                  <button
                    key={job._key}
                    onClick={() => setSelected(job)}
                    className={`w-full text-left p-2.5 rounded-lg border text-xs transition-colors ${
                      active ? 'bg-primary/10 border-primary' : 'bg-card border-border hover:bg-muted/50'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span>{JOB_ICONS[job.type] || '📋'}</span>
                      <span className="font-medium truncate flex-1">{job.name}</span>
                      {job.last_status === 'success' ? <span className="text-green-500">✓</span> :
                       job.last_status === 'failed' ? <span className="text-red-500">✗</span> : null}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5 font-mono">{job.cron}</div>
                  </button>
                )
              })}
            </div>

            {/* Right: detail */}
            <div className="flex-1 min-w-0">
              {selected ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{JOB_ICONS[selected.type]}</span>
                      <div>
                        <div className="text-sm font-semibold">{selected.name}</div>
                        <div className="text-[11px] text-muted-foreground">{selected.description}</div>
                      </div>
                    </div>
                    <Badge variant={selected.enabled ? 'default' : 'secondary'} className="text-[10px]">
                      {selected.enabled ? '啟用' : '停用'}
                    </Badge>
                  </div>

                  <div className="flex items-center gap-2">
                    <Switch checked={selected.enabled} onCheckedChange={(v) => setSelected({ ...selected, enabled: v })} />
                    <span className="text-xs text-muted-foreground">啟用排程</span>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Cron 表達式</Label>
                    <Input value={selected.cron || ''} onChange={(e) => setSelected({ ...selected, cron: e.target.value })} className="text-xs font-mono h-8" />
                  </div>

                  <div className="text-xs text-muted-foreground">
                    上次執行: <span className="text-foreground font-medium">{formatRun(selected)}</span>
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t">
                    <Button size="sm" className="h-7 text-xs" onClick={handleSave} disabled={saving}>
                      <Save className="h-3 w-3 mr-1" />{saving ? '儲存中...' : '儲存'}
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleRun(selected._key)} disabled={running === selected._key}>
                      <Play className="h-3 w-3 mr-1" />{running === selected._key ? '執行中...' : '立即執行'}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-xs text-muted-foreground">選擇一個任務</div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
