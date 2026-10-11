'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AppShell } from '@/components/app-shell'
import { Toaster } from '@/components/ui/sonner'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Bot, Loader2, Check, StopCircle, Activity } from 'lucide-react'
import { WarningChart } from '@/components/tx-rl/WarningChart'
import { BlockTitle } from '@/components/tx-rl/HelpButton'
import { TRAINING_STATUS_MD, TRAINING_PROGRESS_MD } from '@/components/tx-rl/help-content'

type Status = 'idle' | 'running' | 'completed' | 'failed'

const STORED_CONFIG = typeof window !== 'undefined'
  ? (() => { try { return JSON.parse(sessionStorage.getItem('tx_rl_config') || 'null') } catch { return null } })()
  : null
const INITIAL_TOTAL_STEPS = STORED_CONFIG?.model?.total_timesteps ?? 50000

export default function TXRLTrainingPage() {
  const router = useRouter()
  const [status, setStatus] = useState<Status>('idle')
  const [currentStep, setCurrentStep] = useState(0)
  const [totalSteps, setTotalSteps] = useState<number>(INITIAL_TOTAL_STEPS)
  const [accumulatedSteps, setAccumulatedSteps] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null)
  const [foldIdx, setFoldIdx] = useState(1)
  const [nFolds, setNFolds] = useState(1)
  const [currentReward, setCurrentReward] = useState(0)
  const [lastUpdateTs, setLastUpdateTs] = useState(0)
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
          setTotalSteps(d.progress?.total_steps ?? INITIAL_TOTAL_STEPS)
          setAccumulatedSteps(d.progress?.accumulated_steps ?? 0)
          setElapsed(d.elapsed_seconds ?? Math.floor((Date.now() - start) / 1000))
          setEtaSeconds(d.eta_seconds ?? null)
          setFoldIdx(d.progress?.fold_idx ?? 1)
          setNFolds(d.progress?.n_folds ?? 1)
          setCurrentReward(d.progress?.current_reward ?? 0)
          setLastUpdateTs(d.progress?.last_update_ts ?? 0)
          if (d.status === 'completed' || d.status === 'failed' || d.status === 'stopped') {
            if (timerRef.current) clearInterval(timerRef.current)
            if (d.status === 'completed') toast.success('訓練完成', { description: '可前往回測頁查看結果' })
            if (d.status === 'failed') toast.error('訓練失敗', { description: d.error })
            if (d.status === 'stopped') toast.warning('訓練已停止', { description: '可從環境定義頁重新啟動' })
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

  const pct = accumulatedSteps > 0 && totalSteps > 0
    ? Math.round((accumulatedSteps / totalSteps) * 100)
    : (totalSteps > 0 ? Math.round((currentStep / totalSteps) * 100) : 0)
  const foldPct = currentStep > 0 && totalSteps > 0 && nFolds > 1
    ? Math.round((currentStep / (totalSteps / nFolds)) * 100)
    : pct
  const isRunning = status === 'running'
  const isCompleted = status === 'completed'
  const isStuck = isRunning && lastUpdateTs > 0 && (Math.floor(Date.now() / 1000) - lastUpdateTs > 60)
  const fmtDuration = (s: number | null | undefined) => {
    if (s === null || s === undefined) return '—'
    const m = Math.floor(s / 60)
    const sec = s % 60
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`
  }

  return (
    <>
      <Toaster richColors position="top-center" />
      <AppShell title="台指期 RL — 訓練監控">
        <div className="flex flex-col h-full min-h-0 gap-4 p-4 lg:p-6">
          <WarningChart />

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
                <BlockTitle title="狀態" helpContent={TRAINING_STATUS_MD} />
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
                <BlockTitle title="訓練進度" helpContent={TRAINING_PROGRESS_MD}>
                  <CardDescription className="text-xs">
                    {status === 'running'
                      ? (isStuck ? '⚠️ 訓練卡住（超過 60s 沒更新）' : `訓練進行中，每 2 秒更新 · fold ${foldIdx}/${nFolds}`)
                      : status === 'completed'
                        ? '訓練已完成，可至回測頁看結果'
                        : '等待啟動'}
                  </CardDescription>
                </BlockTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Stat label="當前 Fold Step" value={currentStep > 0 ? currentStep.toLocaleString() : '—'} mono />
                  <Stat label="Fold X / N" value={`${foldIdx} / ${nFolds}`} mono />
                  <Stat label="累計 Step" value={accumulatedSteps > 0 ? accumulatedSteps.toLocaleString() : '—'} mono />
                  <Stat label="總步數" value={totalSteps > 0 ? totalSteps.toLocaleString() : '—'} mono />
                </div>

                <div>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                    <span>總進度</span>
                    <span className="font-mono">{pct}%</span>
                  </div>
                  <Progress value={pct} className="h-2" />
                </div>

                {nFolds > 1 && (
                  <div>
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                      <span>當前 Fold 進度</span>
                      <span className="font-mono">{Math.min(100, foldPct)}%</span>
                    </div>
                    <Progress value={Math.min(100, foldPct)} className="h-1.5 bg-muted [&>div]:bg-blue-500" />
                  </div>
                )}

                <div className="grid grid-cols-3 gap-2 text-xs">
                  <Stat label="耗時" value={fmtDuration(elapsed)} />
                  <Stat label="ETA" value={fmtDuration(etaSeconds)} />
                  <Stat label="Reward" value={currentReward !== 0 ? currentReward.toFixed(2) : '—'} mono />
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

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2 text-center">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`text-sm font-bold tabular-nums mt-0.5 ${mono ? 'font-mono text-xs' : ''}`}>{value}</div>
    </div>
  )
}
