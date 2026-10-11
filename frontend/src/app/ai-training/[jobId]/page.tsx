'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AppShell } from '@/components/app-shell'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Toaster } from '@/components/ui/sonner'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Brain,
  Clock,
  Database,
  ArrowLeft,
  Loader2,
} from 'lucide-react'
import { Step1ModelSelection, type ModelType, type DeviceChoice } from '@/components/ai-training/step1-model'
import { Step2Params, type ModelParams, DEFAULT_PARAMS } from '@/components/ai-training/step2-params'
import {
  Step3Target,
  type Target,
  type StockScope,
} from '@/components/ai-training/step3-target'
import {
  Step4DataPrep,
  defaultScalerFor,
  type SplitMethod,
  type ScalerType,
} from '@/components/ai-training/step4-data'
import { Step5Training, type TrainStatus } from '@/components/ai-training/step5-training'
import { Step6Evaluation } from '@/components/ai-training/step6-eval'
import { EditableName } from '@/components/ai-training/editable-name'
import universeData from '@/lib/data/research-universe-ai-memory-passive.json'

const STEPS = [
  { n: 1, label: '訓練方式' },
  { n: 2, label: '參數' },
  { n: 3, label: '目標' },
  { n: 4, label: '資料準備' },
  { n: 5, label: '訓練' },
  { n: 6, label: '評估' },
] as const

type StepNum = 1 | 2 | 3 | 4 | 5 | 6

interface Project {
  job_id: string
  name: string
  tags: string[]
  description: string
  model_type: string | null
  status: string
  current_epoch?: number
  total_epochs?: number
  train_loss?: number | null
  val_loss?: number | null
  loss_history?: { epoch: number; train: number | null; val: number | null }[]
  metrics?: Metrics | null
  backtest_results?: BacktestResults | null
  error?: string | null
  started_at?: number | null
  finished_at?: number | null
  config_snapshot?: {
    model_type?: string
    model_params?: Record<string, number>
    data?: { target?: string; stock_ids?: string[]; universe?: string; start_date?: string; end_date?: string }
    split?: { ratios?: [number, number, number] }
    preprocessing?: { scaler?: string; winsorize_threshold?: string | null }
    device?: string
  } | null
  n_samples?: number | null
}

interface SplitMetrics {
  mae?: number
  rmse?: number
  r2?: number
  win_rate?: number
  accuracy?: number
  auc?: number | null
  f1?: number
}

interface Metrics {
  train: SplitMetrics
  val: SplitMetrics
  test: SplitMetrics
}

interface BacktestSplit {
  days?: number
  total_return_pct?: number
  win_rate_pct?: number
  max_drawdown_pct?: number
  trades?: number
  buys?: number
  sells?: number
  profit_factor?: number | null
  series?: { date: string; y: number; pred: number }[]
}

interface BacktestResults {
  val: BacktestSplit
  test: BacktestSplit
  thresholds?: { buy_pct?: number; sell_pct?: number }
}

const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-slate-500',
  running: 'bg-blue-500',
  completed: 'bg-emerald-500',
  failed: 'bg-red-500',
  stopped: 'bg-amber-500',
  saved: 'bg-purple-500',
}

const UNIVERSE: { stock_id: string; name: string }[] = universeData.stocks
const TOTAL_BARS = 490 // 預估;實作後由 backend 計算

export default function AiTrainingDetailPage() {
  const router = useRouter()
  const routeParams = useParams<{ jobId: string }>()
  const jobId = routeParams?.jobId ?? ''

  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (!jobId) return
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    fetch(`/api/ai-training/projects/${jobId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: Project) => {
        if (cancelled) return
        setProject(data)
        // 還原已完成訓練的狀態(頁面重新載入 / 外部跳轉回來)
        setCurrentEpoch(data.current_epoch ?? 0)
        setTotalEpochs(data.total_epochs ?? 0)
        setTrainLoss(data.train_loss ?? null)
        setValLoss(data.val_loss ?? null)
        setLossHistory(data.loss_history ?? [])
        setMetrics(data.metrics ?? null)
        setBacktestResults(data.backtest_results ?? null)
        setNSamples(data.n_samples ?? null)
        const snap = data.config_snapshot
        if (snap) {
          const m = (['xgboost', 'lightgbm', 'randomforest', 'mlp', 'lstm'] as const).find(
            (t) => t === snap.model_type
          )
          if (m) {
            setModel(m)
            const snapParams = snap.model_params
            if (snapParams && Object.keys(snapParams).length > 0) {
              setParams({ ...DEFAULT_PARAMS[m], ...snapParams })
            }
            const snapTarget = snap.data?.target
            if (snapTarget && (['next_return', 'next_5d_return', 'next_direction', 'next_5d_direction'] as const).includes(snapTarget as Target)) {
              setTarget(snapTarget as Target)
            }
            if (snap.data?.universe === 'all') {
              setStockScope('all')
            } else {
              const ids = snap.data?.stock_ids
              if (ids?.length) setStocks(new Set(ids))
            }
            if (snap.data?.start_date) setStartDate(snap.data.start_date)
            if (snap.data?.end_date) setEndDate(snap.data.end_date)
            const r = snap.split?.ratios
            if (r && r.length === 3) {
              const key = `${r[0]}/${r[1]}/${r[2]}` as SplitMethod
              if (key === '60/20/20' || key === '70/15/15' || key === '80/10/10') {
                setSplitMethod(key)
              } else {
                setSplitMethod('custom')
                setCustomRatios([r[0], r[1], r[2]])
              }
            }
            const snapScaler = snap.preprocessing?.scaler
            if (snapScaler && (['none', 'standard', 'robust', 'minmax'] as const).includes(snapScaler as ScalerType)) {
              setScaler(snapScaler as ScalerType)
            }
            const wt = snap.preprocessing?.winsorize_threshold
            if (wt === '3sigma' || wt === '5pct') {
              setWinsorize(true)
              setWinsorizeThreshold(wt)
            } else {
              setWinsorize(false)
            }
          }
        }
        const snapDevice = snap?.device
        if (snapDevice === 'cuda' || snapDevice === 'cpu' || snapDevice === 'auto') {
          setDevice(snapDevice)
        }
        if (data.status === 'completed' || data.status === 'saved') {
          setTrainStatus('completed')
          if (data.started_at && data.finished_at) setElapsed(data.finished_at - data.started_at)
        } else if (data.status === 'failed') {
          setTrainStatus('failed')
          setWarning(data.error ?? '訓練失敗')
        } else if (data.status === 'stopped') {
          setTrainStatus('failed')
          setWarning('訓練已停止(手動)— 僅完成部分 epoch')
        }
      })
      .catch((e) => {
        if (cancelled) return
        setLoadError(e instanceof Error ? e.message : String(e))
        toast.error('載入訓練項目失敗', { description: e instanceof Error ? e.message : String(e) })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [jobId])

  const [step, setStep] = useState<StepNum>(1)
  const [model, setModel] = useState<ModelType | null>(null)
  const [device, setDevice] = useState<DeviceChoice>('auto')
  const [params, setParams] = useState<ModelParams>(DEFAULT_PARAMS.xgboost)
  const [target, setTarget] = useState<Target>('next_return')
  const [stockScope, setStockScope] = useState<StockScope>('my')
  const [stocks, setStocks] = useState<Set<string>>(() => new Set(UNIVERSE.map((s) => s.stock_id)))
  const [startDate, setStartDate] = useState('2024-08-01')
  const [endDate, setEndDate] = useState('2026-08-07')
  const [featureMode, setFeatureMode] = useState<'all' | 'top_n'>('all')
  const [featureTopN, setFeatureTopN] = useState(30)
  const [latestSens, setLatestSens] = useState<{ finished_at: number | null; target: string | null } | null>(null)

  const [splitMethod, setSplitMethod] = useState<SplitMethod>('70/15/15')
  const [customRatios, setCustomRatios] = useState<[number, number, number]>([70, 15, 15])
  const [scaler, setScaler] = useState<ScalerType>('none')
  const [winsorize, setWinsorize] = useState(true)
  const [winsorizeThreshold, setWinsorizeThreshold] = useState<'3sigma' | '5pct'>('3sigma')

  const [trainStatus, setTrainStatus] = useState<TrainStatus>('idle')
  const [currentEpoch, setCurrentEpoch] = useState(0)
  const [totalEpochs, setTotalEpochs] = useState(0)
  const [trainLoss, setTrainLoss] = useState<number | null>(null)
  const [valLoss, setValLoss] = useState<number | null>(null)
  const [nSamples, setNSamples] = useState<number | null>(null)
  const [lossHistory, setLossHistory] = useState<{ epoch: number; train: number | null; val: number | null }[]>([])
  const [elapsed, setElapsed] = useState(0)
  const [remaining, setRemaining] = useState(0)
  const [warning, setWarning] = useState<string | null>(null)
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [backtestResults, setBacktestResults] = useState<BacktestResults | null>(null)
const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)


const handleRetry = async () => {
  if (!jobId) return
  
  if (!window.confirm('確定要重新訓練嗎？這將會啟動一個新的訓練任務，原有的訓練進度將會被清除。')) return
  
  setWarning('正在重新啟動訓練...')
  
  try {
    const r = await fetch(`/api/ai-training/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `retry-${jobId}`,
        model_type: model,
        target: target,
        data: {
          target: target,
          stock_ids: Array.from(stocks).slice(0, 5)
        }
      }),
      credentials: 'same-origin'
    })
    
    if (!r.ok) throw new Error('Failed to start training')
    
    const data = await r.json()
    const newJobId = data.job_id
    
    setTrainStatus('idle')
    setCurrentEpoch(0)
    setTotalEpochs(0)
    setTrainLoss(null)
    setValLoss(null)
    setLossHistory([])
    setNSamples(null)
    setElapsed(0)
    setRemaining(0)
    setWarning(null)
    
    toast.success('新訓練任務已啟動', {
      description: `新 Job ID: ${newJobId}`
    })
    
  } catch (e: any) {
    setWarning(`重新訓練失敗: ${e.message}`)
    toast.error('重新訓練失敗', { description: e.message })
  }
}

// 模型切換時同步預設 scaler + params
  const handleModelChange = (m: ModelType) => {
    setModel(m)
    setParams(DEFAULT_PARAMS[m])
    setScaler(defaultScalerFor(m))
  }

  const ratios = useMemo<[number, number, number]>(() => {
    if (splitMethod === 'custom') return customRatios
    if (splitMethod === '60/20/20') return [60, 20, 20]
    if (splitMethod === '80/10/10') return [80, 10, 10]
    return [70, 15, 15]
  }, [splitMethod, customRatios])

  // 模擬資料預覽(實際由 backend 計算)
  const preview = useMemo(() => {
    const usable = Math.round(TOTAL_BARS * stocks.size * (28641 / (59 * TOTAL_BARS))) // 簡化
    const train = Math.round((usable * ratios[0]) / 100)
    const val = Math.round((usable * ratios[1]) / 100)
    const test = usable - train - val
    return { train, val, test, missing: 0, anomalies: 0 }
  }, [stocks, ratios])

  const estimatedMinutes = useMemo(() => {
    if (!model) return '—'
    if (model === 'lstm') return '10~30 分鐘'
    if (model === 'mlp') return '2~5 分鐘'
    if (model === 'randomforest') return '2~4 分鐘'
    return '1~3 分鐘'
  }, [model])

  // ── 步驟完成判定(寬鬆：只驗證必要的選擇;參數/目標/股票皆有預設值) ──
  const isStepComplete = (n: StepNum): boolean => {
    if (n <= 1) return model !== null
    if (n === 2) return model !== null
    if (n === 3) return model !== null
    if (n === 4) {
      if (splitMethod !== 'custom') return true
      return ratios[0] + ratios[1] + ratios[2] === 100
    }
    if (n === 5) return trainStatus === 'completed'
    if (n === 6) return true
    return true
  }

  const firstIncompleteBefore = (target: StepNum): StepNum | null => {
    for (let i = 1; i < target; i++) {
      if (!isStepComplete(i as StepNum)) return i as StepNum
    }
    return null
  }

  const goToStep = (target: StepNum) => {
    if (target === step) return
    if (target < step) {
      setStep(target)
      return
    }
    const blocker = firstIncompleteBefore(target)
    if (blocker) {
      const blockerLabel = STEPS.find((s) => s.n === blocker)?.label ?? ''
      toast.warning(`請先完成 Step ${blocker}(${blockerLabel})`, {
        description: '依序完成前面的流程後才能進入此步驟。',
      })
      return
    }
    setStep(target)
  }

  const handleRename = async (newName: string) => {
    if (!project) return
    const res = await fetch(`/api/ai-training/projects/${project.job_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => null)
      throw new Error(err?.detail ?? `HTTP ${res.status}`)
    }
    setProject({ ...project, name: newName })
  }

  const next = () => {
    if (step === 5 && trainStatus !== 'completed') return
    if (step < 6) goToStep((step + 1) as StepNum)
  }
  const prev = () => goToStep(Math.max(1, step - 1) as StepNum)

  // ── 訓練控制(真實 API) ──
  const buildRunRequest = () => {
    if (!model) return null
    const modelParams: Record<string, number> = { ...params }
    // 只送模型相關參數(避免 0 值參數干擾)
    const relevant: Record<string, number> = {}
    if (model === 'mlp' || model === 'lstm') {
      relevant.epochs = params.epochs
      relevant.batch_size = params.batch_size
      relevant.lr = params.learning_rate
      if (model === 'mlp') relevant.hidden_layers = params.hidden_units
      if (model === 'lstm') {
        relevant.sequence_length = params.sequence_length
        relevant.hidden_units = params.hidden_units
      }
    } else {
      relevant.n_estimators = params.n_estimators
      if (params.max_depth > 0) relevant.max_depth = params.max_depth
      if (params.learning_rate > 0) relevant.learning_rate = params.learning_rate
      if (params.subsample > 0) relevant.subsample = params.subsample
      if (params.colsample_bytree > 0) relevant.colsample_bytree = params.colsample_bytree
    }
    return {
      job_id: jobId,
      model_type: model,
      model_params: relevant,
      data: {
        target,
        universe: stockScope === 'all' ? 'all' : undefined,
        stock_ids: stockScope === 'all' ? [] : [...stocks],
        start_date: startDate,
        end_date: endDate,
      },
      split: { method: 'time_sequential', ratios },
      preprocessing: {
        scaler,
        winsorize_threshold: winsorize ? winsorizeThreshold : null,
      },
      device,
      feature_selection:
        featureMode === 'top_n' && latestSens?.finished_at
          ? { mode: 'top_n', target, top_n: featureTopN }
          : { mode: 'all' },
    }
  }

  const pollJob = async () => {
    try {
      const res = await fetch(`/api/ai-training/projects/${jobId}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: Project = await res.json()
      setProject(data)
      setCurrentEpoch(data.current_epoch ?? 0)
      setTotalEpochs(data.total_epochs ?? 0)
      setTrainLoss(data.train_loss ?? null)
      setValLoss(data.val_loss ?? null)
      setLossHistory(data.loss_history ?? [])
      const started = data.started_at ?? Math.floor(Date.now() / 1000)
      setElapsed(Math.max(0, Math.floor(Date.now() / 1000) - started))
      const done = data.current_epoch ?? 0
      const total = data.total_epochs ?? 0
      if (total > 0 && done > 0) {
        setRemaining(Math.max(0, (Math.floor(Date.now() / 1000) - started) / done * (total - done)))
      }
      if (data.status === 'completed') {
        setTrainStatus('completed')
        setMetrics(data.metrics ?? null)
        setBacktestResults(data.backtest_results ?? null)
        setRemaining(0)
      } else if (data.status === 'failed') {
        setTrainStatus('failed')
        setWarning(data.error ?? '訓練失敗')
      } else if (data.status === 'stopped') {
        setTrainStatus('failed')
        setWarning('訓練已停止(手動)— 僅完成部分 epoch')
      } else if (data.status !== 'running') {
        setTrainStatus('idle')
      }
      return data.status
    } catch (e) {
      console.error('poll job failed', e)
      return null
    }
  }

  const startTraining = async () => {
    if (!model) return
    const body = buildRunRequest()
    if (!body) return
    setTotalEpochs(model === 'mlp' || model === 'lstm' ? params.epochs : params.n_estimators)
    setCurrentEpoch(0)
    setTrainLoss(null)
    setValLoss(null)
    setLossHistory([])
    setMetrics(null)
    setTrainStatus('running')
    setElapsed(0)
    setRemaining(0)
    setWarning(null)
    try {
      const res = await fetch('/api/ai-training/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        throw new Error(err?.detail ?? `HTTP ${res.status}`)
      }
      pollRef.current = setInterval(async () => {
        const status = await pollJob()
        if (status === 'completed' || status === 'failed' || status === 'stopped') {
          if (pollRef.current) clearInterval(pollRef.current)
          pollRef.current = null
        }
      }, 1500)
    } catch (e) {
      setTrainStatus('failed')
      setWarning(e instanceof Error ? e.message : String(e))
    }
  }

  const runBacktest = async (buyPct: number, sellPct: number) => {
    try {
      const res = await fetch(`/api/ai-training/jobs/${jobId}/backtest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ buy_thresh_pct: buyPct, sell_thresh_pct: sellPct }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        throw new Error(err?.detail ?? `HTTP ${res.status}`)
      }
      const data: BacktestResults = await res.json()
      setBacktestResults(data)
      return data
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      toast.error('回測重算失敗', { description: msg })
      throw e
    }
  }

  const saveModel = async (name: string, description: string, tags: string[]) => {
    try {
      const res = await fetch('/api/ai-training/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId, name, description, tags }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        throw new Error(err?.detail ?? `HTTP ${res.status}`)
      }
      const data = await res.json()
      setProject((p) => (p ? { ...p, status: 'saved' } : p))
      toast.success('模型已儲存', {
        description: `artifact: ${data.artifact_id ?? ''}`,
      })
      return data
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      toast.error('儲存模型失敗', { description: msg })
      throw e
    }
  }

  const stopTraining = async () => {    try {
      await fetch(`/api/ai-training/jobs/${jobId}/stop`, { method: 'POST' })
      setWarning('已送出停止請求，等待 worker 收斂…')
    } catch (e) {
      setWarning(e instanceof Error ? e.message : String(e))
    }
  }

  const forceCancel = async () => {
    try {
      await fetch(`/api/ai-training/jobs/${jobId}/stop`, { method: 'POST' })
      setWarning('已送出取消請求，訓練將於下個 epoch 中斷')
    } catch (e) {
      setWarning(e instanceof Error ? e.message : String(e))
    }
  }

  // Step 6「不儲存，重來」：停止輪詢、重置訓練狀態後回到參數設置(Step 2)，
  // 讓 Step 5 回到 idle 可重新點擊「開始訓練」。
  const handleRestart = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    setTrainStatus('idle')
    setCurrentEpoch(0)
    setTrainLoss(null)
    setValLoss(null)
    setLossHistory([])
    setMetrics(null)
    setBacktestResults(null)
    setWarning(null)
    setElapsed(0)
    setRemaining(0)
    goToStep(2)
  }

  // 離開頁面時停止輪詢
  useEffect(() => {
    let cancelled = false
    fetch(
      `/api/features/sensitivity/list?target=${encodeURIComponent(target)}&limit=1`,
    )
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data: { items?: Array<{ finished_at?: number; target?: string }> }) => {
        if (cancelled) return
        const top = data.items?.[0]
        setLatestSens(top ? { finished_at: top.finished_at ?? null, target: top.target ?? null } : null)
      })
      .catch(() => {
        if (!cancelled) setLatestSens(null)
      })
    return () => {
      cancelled = true
    }
  }, [target])

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  if (loading) {
    return (
      <>
        <Toaster richColors position="top-center" />
        <AppShell title="AI 資料訓練">
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            載入訓練項目…
          </div>
        </AppShell>
      </>
    )
  }
  if (loadError || !project) {
    return (
      <>
        <Toaster richColors position="top-center" />
        <AppShell title="AI 資料訓練">
          <div className="flex flex-col items-center justify-center h-full gap-3 text-sm">
            <p className="text-destructive">{loadError ?? '找不到此訓練項目'}</p>
            <Button size="sm" variant="outline" onClick={() => router.push('/ai-training')}>
              <ArrowLeft className="h-3.5 w-3.5 mr-1" />
              回到列表
            </Button>
          </div>
        </AppShell>
      </>
    )
  }

  return (
    <>
      <Toaster richColors position="top-center" />
      <AppShell title={`${project.name} | AI 資料訓練`}>
      <div className="flex flex-col h-full min-h-0 gap-4 p-4 lg:p-6">
        {/* ── 項目 header：返回 + 名稱 + 狀態徽章 + tags ── */}
        <div className="shrink-0 flex items-center gap-3 flex-wrap">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => router.push('/ai-training')}
            className="h-7 px-2"
          >
            <ArrowLeft className="h-3.5 w-3.5 mr-1" />
            列表
          </Button>
          <EditableName value={project.name} onSave={handleRename} />
          <Badge className={`${STATUS_COLOR[project.status] ?? 'bg-slate-500'} text-white text-[10px]`}>
            {project.status}
          </Badge>
          {project.tags?.length > 0 && (
            <div className="flex items-center gap-1">
              {project.tags.map((t) => (
                <Badge key={t} variant="secondary" className="text-[10px]">
                  {t}
                </Badge>
              ))}
            </div>
          )}
          {project.description && (
            <span className="text-xs text-muted-foreground truncate max-w-md" title={project.description}>
              {project.description}
            </span>
          )}
        </div>

        {/* ── Step Indicator(固定頂部，陰影 + 底邊提示黏住) ── */}
        <Card className="shrink-0 shadow-sm border-b">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between gap-2 overflow-x-auto">
              {STEPS.map((s, i) => (
                <div key={s.n} className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => goToStep(s.n)}
                    className={
                      'h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors ' +
                      (step === s.n
                        ? 'bg-primary text-primary-foreground'
                        : step > s.n
                          ? 'bg-emerald-500 text-white'
                          : 'bg-muted text-muted-foreground')
                    }
                  >
                    {step > s.n ? <Check className="h-4 w-4" /> : s.n}
                  </button>
                  <span
                    className={
                      'text-xs ' +
                      (step === s.n ? 'text-foreground font-medium' : 'text-muted-foreground')
                    }
                  >
                    {s.label}
                  </span>
                  {i < STEPS.length - 1 && <div className="w-6 h-px bg-border hidden md:block" />}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* ── 中段：主內容 + 右側摘要(flex-1 獨立捲動) ── */}
        <div className="flex-1 min-h-0 overflow-y-auto -mx-4 lg:-mx-6 px-4 lg:px-6">
          <div className="grid grid-cols-[1fr_220px] md:grid-cols-[1fr_240px] lg:grid-cols-[1fr_280px] gap-3 md:gap-4 pb-4 items-start">
            {/* 主內容(左側)— 與右側 Card 的 CardContent 頂部對齊 */}
            <div className="lg:pt-6">
              {step === 1 && (
                <Step1ModelSelection
                  value={model}
                  onChange={handleModelChange}
                  device={device}
                  onDeviceChange={setDevice}
                />
              )}
              {step === 2 && model && <Step2Params model={model} params={params} onChange={setParams} />}
              {step === 3 && (
                <Step3Target
                  target={target}
                  onTargetChange={setTarget}
                  stockScope={stockScope}
                  onStockScopeChange={setStockScope}
                  selectedStocks={stocks}
                  onStocksChange={setStocks}
                  startDate={startDate}
                  endDate={endDate}
                  onStartChange={setStartDate}
                  onEndChange={setEndDate}
                  featureMode={featureMode}
                  onFeatureModeChange={setFeatureMode}
                  featureTopN={featureTopN}
                  onFeatureTopNChange={setFeatureTopN}
                  latestSens={latestSens}
                  featureCount={null}
                />
              )}
              {step === 4 && model && (
                <Step4DataPrep
                  model={model}
                  target={target}
                  splitMethod={splitMethod}
                  onSplitChange={setSplitMethod}
                  customRatios={customRatios}
                  onCustomRatiosChange={setCustomRatios}
                  scaler={scaler}
                  onScalerChange={setScaler}
                  winsorize={winsorize}
                  onWinsorizeChange={setWinsorize}
                  winsorizeThreshold={winsorizeThreshold}
                  onWinsorizeThresholdChange={setWinsorizeThreshold}
                  preview={preview}
                />
              )}
              {step === 5 && model && (
                <Step5Training
                  model={model}
                  status={trainStatus}
                  currentEpoch={currentEpoch}
                  totalEpochs={totalEpochs}
                  trainLoss={trainLoss}
                  valLoss={valLoss}
                  nSamples={nSamples}
                  lossHistory={lossHistory}
                  elapsedSec={elapsed}
                  remainingSec={remaining}
                  warning={warning}
                  onStart={startTraining}
                  onStop={stopTraining}
                  onForceCancel={forceCancel}
                  onRetry={handleRetry}
                />
              )}
              {step === 6 && model && (
                <Step6Evaluation
                  model={model}
                  target={target}
                  metrics={metrics}
                  trainStatus={trainStatus}
                  backtestResults={backtestResults}
                  onRunBacktest={runBacktest}
                  onSaveModel={saveModel}
                  onRestart={handleRestart}
                  saved={project.status === 'saved'}
                />
              )}
            </div>

            {/* 右側設定摘要 */}
            <div className="lg:sticky lg:top-0 self-start">
              <Card>
                <CardContent className="pt-4 space-y-3">
                  <div className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                    📋 設定摘要
                  </div>
                  <SummaryRow
                    icon={<Brain className="h-3 w-3" />}
                    label="模型"
                    value={model ? model.toUpperCase() : '—'}
                  />
                  <SummaryRow label="運算裝置" value={device === 'auto' ? '自動' : device === 'cuda' ? 'GPU' : 'CPU'} />
                  <SummaryRow label="目標" value={targetLabel(target)} />
                  <SummaryRow label="股票" value={`${stocks.size} / ${UNIVERSE.length}`} />
                  <SummaryRow label="區間" value={`${startDate} ~ ${endDate}`} />
                  <SummaryRow
                    label="分割"
                    value={splitMethod === 'custom' ? `${ratios[0]}/${ratios[1]}/${ratios[2]}` : splitMethod}
                  />
                  <SummaryRow label="Scaler" value={scaler} />
                  <div className="border-t border-border/50 pt-3 mt-3 space-y-2">
                    <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      預估訓練時間
                    </div>
                    <div className="text-sm font-bold">{estimatedMinutes}</div>
                    <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Database className="h-3 w-3" />
                      預估樣本
                    </div>
                    <div className="text-sm font-bold tabular-nums">
                      {preview.train + preview.val + preview.test} 筆
                    </div>
                  </div>
                  <Badge variant="outline" className="w-full justify-center text-[10px]">
                    v0.1 視覺雛形 · 功能待實作
                  </Badge>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>

        {/* ── 控制列(固定底部) ── */}
        <div className="shrink-0 -mx-4 lg:-mx-6 px-4 lg:px-6 py-3 bg-background/95 backdrop-blur border-t border-border">
          <div className="flex items-center justify-between">
            <Button variant="outline" size="sm" onClick={prev} disabled={step === 1}>
              <ChevronLeft className="h-3.5 w-3.5 mr-1" />
              上一步
            </Button>
            {step < 6 ? (
              <Button
                size="sm"
                onClick={next}
                disabled={firstIncompleteBefore((step + 1) as StepNum) !== null}
              >
                下一步
                <ChevronRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            ) : (
              <Badge variant="secondary" className="text-xs">
                ✓ 所有步驟完成
              </Badge>
            )}
          </div>
        </div>
      </div>
    </AppShell>
    </>
  )
}

function SummaryRow({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-xs gap-2">
      <span className="text-muted-foreground flex items-center gap-1 shrink-0">
        {icon}
        {label}
      </span>
      <span className="font-medium truncate">{value}</span>
    </div>
  )
}

function targetLabel(t: Target): string {
  if (t === 'next_return') return '隔日漲跌幅'
  if (t === 'next_5d_return') return '5日總漲跌幅'
  if (t === 'next_direction') return '隔日漲跌分類'
  return '5日總漲跌分類'
}
