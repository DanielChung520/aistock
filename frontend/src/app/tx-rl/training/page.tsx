'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AppShell } from '@/components/app-shell'
import { Toaster } from '@/components/ui/sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { AlertTriangle, Bot, Loader2, Check, StopCircle, Activity } from 'lucide-react'

type Status = 'idle' | 'running' | 'completed' | 'failed'

export default function TXRLTrainingPage() {
  const router = useRouter()
  const [status, setStatus] = useState<Status>('idle')
  const [currentStep, setCurrentStep] = useState(0)
  const [totalSteps] = useState(50000)
  const [elapsed, setElapsed] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  const jobId = typeof window !== 'undefined' ? sessionStorage.getItem('tx_rl_job_id') : null

  useEffect(() => {
    if (!jobId) return
    let cancelled = false
    const start = Date.now()
    const tick = async () => {
      if (cancelled) return
      try {
        const r = await fetch(`/api/tx-rl/jobs/${jobId}`)
        if (r.ok) {
          const d = await r.json()
          setStatus(d.status as Status)
          setCurrentStep(d.progress?.current_step ?? 0)
          setElapsed(Math.floor((Date.now() - start) / 1000))
          if (d.status === 'completed' || d.status === 'failed' || d.status === 'stopped') {
            if (timerRef.current) clearInterval(timerRef.current)
            if (d.status === 'completed') toast.success('訓練完成', { description: '可前往回測頁查看結果' })
            if (d.status === 'failed') toast.error('訓練失敗', { description: d.error })
            return
          }
        }
      } catch { /* network blip — keep polling */ }
    }
    tick()  // immediate
    timerRef.current = setInterval(tick, 2000)
    return () => {
      cancelled = true
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [jobId, totalSteps])

  const onStart = () => {
    if (!jobId) {
      toast.error('找不到訓練 job', { description: '請從環境定義頁啟動訓練' })
      router.push('/tx-rl')
      return
    }
    setStatus('running')
    setCurrentStep(0)
    setElapsed(0)
    toast.info('訓練監控中', { description: '每 2 秒 poll job 狀態' })
  }

  const onStop = () => {
    if (timerRef.current) clearInterval(timerRef.current)
    setStatus('idle')
    toast.warning('已停止（mock）')
  }

  const pct = totalSteps > 0 ? Math.round((currentStep / totalSteps) * 100) : 0
  const isRunning = status === 'running'
  const isCompleted = status === 'completed'

  return (
    <>
      <Toaster richColors position="top-center" />
      <AppShell title="台指期 RL — 訓練監控">
        <div className="flex flex-col h-full min-h-0 gap-4 p-4 lg:p-6">
          {/* 警告 Banner */}
          <Card className="shrink-0 border-amber-500/40 bg-amber-500/5">
            <CardContent className="pt-4 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <div className="text-xs">
                <div className="font-semibold text-amber-700 dark:text-amber-400">
                  這個功能的目的是「學 RL」而非「賺錢」
                </div>
                <div className="text-amber-700/80 dark:text-amber-400/80 mt-1">
                  目前顯示為 mock 數據。Backend Celery + stable-baselines3 待 SPEC 確認後實作。
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 標題 */}
          <div className="shrink-0 flex items-center justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold flex items-center gap-2">
                <Bot className="h-5 w-5 text-muted-foreground" />
                台指期 RL — 訓練監控
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                觀察 PPO/A2C/DQN 訓練進度與 reward 曲線
              </p>
            </div>
            <div className="flex gap-2">
              {status === 'idle' && (
                <Button onClick={onStart}>
                  <Activity className="h-4 w-4 mr-1" />
                  開始訓練
                </Button>
              )}
              {isRunning && (
                <>
                  <Button variant="outline" size="sm" onClick={onStop}>
                    <StopCircle className="h-3.5 w-3.5 mr-1" />
                    停止
                  </Button>
                </>
              )}
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto grid grid-cols-1 lg:grid-cols-3 gap-4 pb-4">
            {/* 狀態卡片 */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">狀態</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2">
                  {status === 'idle' && <Badge variant="outline">待開始</Badge>}
                  {isRunning && <Badge className="bg-blue-500 text-white"><Loader2 className="h-3 w-3 mr-1 animate-spin" />訓練中</Badge>}
                  {isCompleted && <Badge className="bg-emerald-500 text-white"><Check className="h-3 w-3 mr-1" />已完成</Badge>}
                  {status === 'failed' && <Badge variant="destructive">失敗</Badge>}
                </div>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Step</span>
                    <span className="font-mono">{currentStep.toLocaleString()} / {totalSteps.toLocaleString()}</span>
                  </div>
                  <Progress value={pct} className="h-2" />
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>{pct}%</span>
                    <span>耗時 {elapsed}s</span>
                  </div>
                </div>
                <div className="pt-3 border-t border-border/50 space-y-1.5 text-[10px] text-muted-foreground">
                  <div>演算法: PPO (預設)</div>
                  <div>Action: discrete_3</div>
                  <div>Reward: pure_pnl</div>
                  <div>State features: 12 維</div>
                </div>
              </CardContent>
            </Card>

            {/* 即時狀態摘要 */}
            <Card className="lg:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">訓練進度</CardTitle>
                <CardDescription className="text-xs">
                  {status === 'running' ? '訓練進行中，每 2 秒更新' : status === 'completed' ? '訓練已完成，可至回測頁看結果' : '等待啟動'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-3">
                  <Stat label="當前 Step" value={currentStep > 0 ? currentStep.toLocaleString() : '—'} />
                  <Stat label="總步數" value={totalSteps.toLocaleString()} />
                  <Stat label="耗時" value={elapsed > 0 ? `${elapsed}s` : '—'} />
                </div>
                <div className="text-[10px] text-muted-foreground mt-3 pt-3 border-t border-border/50">
                  演算法: PPO (預設) · Action: discrete_3 · Reward: pure_pnl · State features: 12 維
                </div>
              </CardContent>
            </Card>
          </div>

          {/* 完成後的下一步 */}
          {isCompleted && (
            <div className="shrink-0 flex gap-2">
              <Button onClick={() => router.push('/tx-rl/backtest')}>
                查看回測結果 →
              </Button>
              <Button variant="outline" onClick={() => router.push('/tx-rl/evaluation')}>
                與 Buy & Hold 對照 →
              </Button>
            </div>
          )}
        </div>
      </AppShell>
    </>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2 text-center">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-sm font-bold tabular-nums mt-0.5">{value}</div>
    </div>
  )
}
