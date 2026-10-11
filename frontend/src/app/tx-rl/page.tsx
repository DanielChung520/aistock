'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AppShell } from '@/components/app-shell'
import { Toaster } from '@/components/ui/sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Bot, Play, Sparkles, AlertTriangle, BarChart3, Activity } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { RefreshCw, Database, HelpCircle } from 'lucide-react'
import { BlockTitle, HelpButton } from '@/components/tx-rl/HelpButton'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  ACTION_SPACE_MD, REWARD_FUNCTION_MD, STATE_FEATURES_MD,
  ALGORITHM_MD, DATA_RANGE_MD, WALK_FORWARD_MD,
  WARNING_MD,
} from '@/components/tx-rl/help-content'

type ActionMode = 'discrete_3' | 'discrete_5' | 'continuous'
type RewardMode = 'pure_pnl' | 'sharpe' | 'multi_objective' | 'sparse_pnl'
type Algorithm = 'ppo' | 'a2c' | 'dqn'

interface TXConfig {
  data: { start_date: string; end_date: string; eval_start_date: string; eval_end_date: string }
  env: {
    action_mode: ActionMode
    reward_mode: RewardMode
    reward_params: { lambda_dd: number; mu_trade: number }
    state_features: Record<string, boolean>
    fees: { slippage_pct: number; commission_pct: number }
    hard_limits: {
      stop_loss_pct: number   // 單筆虧虧損%強制平倉（<0, 0=禁用）
      take_profit_pct: number // 單筆停利%強制平倉（>0, 0=禁用）
      max_hold_bars: number   // 持有超過N根K棒強制平倉（0=不限）
    }
  }
  model: { algorithm: Algorithm; learning_rate: number; n_steps: number; batch_size: number; gamma: number; seed: number; total_timesteps: number }
  walk_forward: { enabled: boolean; train_window: number; val_window: number; test_window: number; roll_step: number }
}

const DEFAULT_CONFIG: TXConfig = {
  data: { start_date: '2006-09-01', end_date: '2026-08-21', eval_start_date: '2024-01-01', eval_end_date: '2026-08-21' },
  env: {
    action_mode: 'discrete_3',
    reward_mode: 'pure_pnl',
    reward_params: { lambda_dd: 0.5, mu_trade: 0.001 },
    state_features: { price: true, tech: true, vol: true, position: true, calendar: false },
    fees: { slippage_pct: 0.3, commission_pct: 0.15 },
    hard_limits: { stop_loss_pct: -0.03, take_profit_pct: 0.05, max_hold_bars: 0 },
  },
  model: { algorithm: 'ppo', learning_rate: 3e-4, n_steps: 2048, batch_size: 64, gamma: 0.99, seed: 42, total_timesteps: 50000 },
  walk_forward: { enabled: true, train_window: 2520, val_window: 0, test_window: 504, roll_step: 504 },
}

const ACTION_OPTIONS: { value: ActionMode; label: string; hint: string }[] = [
  { value: 'discrete_3', label: '3 動作 (Buy/Hold/Sell)', hint: '最簡單、適合 DQN' },
  { value: 'discrete_5', label: '5 動作 (Strong/Weak Buy/Hold/Weak/Strong Sell)', hint: '控制部位大小' },
  { value: 'continuous', label: '連續 (-1~+1)', hint: '彈性最高但訓練難' },
]

const REWARD_OPTIONS: { value: RewardMode; label: string; hint: string }[] = [
  { value: 'pure_pnl', label: '純 PnL', hint: '簡單但易過擬合高風險策略' },
  { value: 'sharpe', label: '風險調整 (Sharpe-like)', hint: 'PnL/波動率，鼓勵穩定' },
  { value: 'multi_objective', label: '多目標 (PnL - λ·DD - μ·trades)', hint: '最真實、需調 λ/μ' },
  { value: 'sparse_pnl', label: '稀疏 PnL（業界最佳實務）', hint: '中間步 reward=0、只在進出場/episode 結束時結算 — 不鼓勵 agent 學短線雜訊' },
]

const ALGO_OPTIONS: { value: Algorithm; label: string }[] = [
  { value: 'ppo', label: 'PPO（推薦）' },
  { value: 'a2c', label: 'A2C' },
  { value: 'dqn', label: 'DQN（僅 discrete）' },
]

const FEATURE_GROUPS = [
  { key: 'price', label: '價格', desc: 'close/high/low/volume 正規化' },
  { key: 'tech', label: '技術指標', desc: 'MA5/MA20 ratio, RSI14' },
  { key: 'vol', label: '波動', desc: 'ret_1d, ret_5d, vol_5d' },
  { key: 'position', label: '持倉狀態', desc: 'position, days_held, unrealized PnL, drawdown' },
  { key: 'calendar', label: '日曆', desc: 'day_of_week, month' },
]

export default function TXRLEnvironmentPage() {
  const router = useRouter()
  const [config, setConfig] = useState<TXConfig>(DEFAULT_CONFIG)
  const [submitting, setSubmitting] = useState(false)
  const [dsRows, setDsRows] = useState<Record<string, unknown>[]>([])
  const [dsColumns, setDsColumns] = useState<string[]>([])
  const [dsTotal, setDsTotal] = useState(0)
  const [dsLoading, setDsLoading] = useState(false)
  const [dsError, setDsError] = useState('')

  const fetchDataset = async (limit = 100) => {
    setDsLoading(true)
    setDsError('')
    try {
      const r = await fetch(`/api/tx-rl/dataset?limit=${limit}`)
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        throw new Error(d.detail ?? d.error ?? `HTTP ${r.status}`)
      }
      const d = await r.json()
      setDsRows(d.rows ?? [])
      setDsColumns(d.columns ?? [])
      setDsTotal(d.total_rows ?? 0)
    } catch (e) {
      setDsError(e instanceof Error ? e.message : String(e))
      setDsRows([])
    } finally {
      setDsLoading(false)
    }
  }

  const updateEnv = <K extends keyof TXConfig['env']>(k: K, v: TXConfig['env'][K]) =>
    setConfig((p) => ({ ...p, env: { ...p.env, [k]: v } }))
  const updateModel = <K extends keyof TXConfig['model']>(k: K, v: TXConfig['model'][K]) =>
    setConfig((p) => ({ ...p, model: { ...p.model, [k]: v } }))
  const toggleFeature = (k: string, v: boolean) =>
    updateEnv('state_features', { ...config.env.state_features, [k]: v })

  const wfValidation = (() => {
    if (!config.walk_forward.enabled) return { ok: true, msg: '' }
    const train = config.walk_forward.train_window
    const test = config.walk_forward.test_window
    const needed = train + test
    const startMs = new Date(config.data.start_date).getTime()
    const endMs = new Date(config.data.end_date).getTime()
    const calendarDays = Math.floor((endMs - startMs) / 86400000)
    const tradingDays = Math.floor(calendarDays * 5 / 7)
    if (calendarDays < needed) {
      return {
        ok: false,
        msg: `資料區間太短：目前 ${calendarDays} 天曆日（約 ${tradingDays} 交易日）< walk_forward 需要 ${needed} 天（train ${test} + test_window ${test}）。請延長 data 區間或縮短 walk_forward 參數。`,
      }
    }
    return { ok: true, msg: '' }
  })()

  const onStart = async () => {
    if (!wfValidation.ok) {
      toast.error('設定錯誤', { description: wfValidation.msg })
      return
    }
    setSubmitting(true)
    setSubmitting(true)
    try {
      const r = await fetch('/api/tx-rl/train', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        throw new Error(err.detail ?? `HTTP ${r.status}`)
      }
      const { job_id } = await r.json()
      sessionStorage.setItem('tx_rl_job_id', job_id)
      sessionStorage.setItem('tx_rl_config', JSON.stringify(config))
      toast.success('訓練已啟動', { description: `Job ID: ${job_id.slice(0, 12)}…` })
      router.push('/tx-rl/training')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      toast.error('啟動訓練失敗', { description: msg })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Toaster richColors position="top-center" />
      <AppShell title="台指期 RL">
        <div className="flex flex-col h-full min-h-0 gap-4 p-4 lg:p-6">
          <div className="shrink-0 flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border/60">
            <div className="flex items-center gap-2 min-w-0">
              <Bot className="h-5 w-5 text-muted-foreground shrink-0" />
              <h1 className="text-lg font-semibold whitespace-nowrap">台指期 RL — 環境定義</h1>
              <WarningIconButton />
              <InlineLatestStatus />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <LatestResultButtons />
              <Button onClick={onStart} disabled={submitting || !wfValidation.ok} size="sm">
                {submitting ? <Sparkles className="h-4 w-4 mr-1 animate-spin" /> : <Play className="h-4 w-4 mr-1" />}
                開始訓練
              </Button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto grid grid-cols-1 lg:grid-cols-2 gap-4 pb-4">
            <Card>
              <CardHeader className="pb-3">
                <BlockTitle title="Action Space（可調參）" helpContent={ACTION_SPACE_MD}>
                  <CardDescription className="text-xs">RL agent 每次可採取的動作</CardDescription>
                </BlockTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {ACTION_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => updateEnv('action_mode', o.value)}
                    className={
                      'w-full text-left rounded-md border px-3 py-2 text-xs transition-colors ' +
                      (config.env.action_mode === o.value
                        ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                        : 'border-border bg-card hover:bg-muted/40')
                    }
                  >
                    <div className="font-medium">{o.label}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{o.hint}</div>
                  </button>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <BlockTitle title="Reward Function（可調參）" helpContent={REWARD_FUNCTION_MD}>
                  <CardDescription className="text-xs">訓練時 agent 嘗試最大化的目標</CardDescription>
                </BlockTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {REWARD_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => updateEnv('reward_mode', o.value)}
                    className={
                      'w-full text-left rounded-md border px-3 py-2 text-xs transition-colors ' +
                      (config.env.reward_mode === o.value
                        ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                        : 'border-border bg-card hover:bg-muted/40')
                    }
                  >
                    <div className="font-medium">{o.label}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{o.hint}</div>
                  </button>
                ))}
                {config.env.reward_mode === 'multi_objective' && (
                  <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border/50">
                    <div>
                      <ParamLabel docKey="lambda_dd" />
                      <Input
                        type="number" step="0.05" min="0" max="2"
                        value={config.env.reward_params.lambda_dd}
                        onChange={(e) => updateEnv('reward_params', { ...config.env.reward_params, lambda_dd: parseFloat(e.target.value) || 0 })}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div>
                      <ParamLabel docKey="mu_trade" />
                      <Input
                        type="number" step="0.001" min="0" max="0.01"
                        value={config.env.reward_params.mu_trade}
                        onChange={(e) => updateEnv('reward_params', { ...config.env.reward_params, mu_trade: parseFloat(e.target.value) || 0 })}
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>
)}
               </CardContent>
             </Card>

             {/* 硬性風控底線（Hard Limits） */}
             <Card>
               <CardHeader className="pb-3">
                 <BlockTitle title="硬性風控底線（Hard Limits）" helpContent={REWARD_FUNCTION_MD}>
                   <CardDescription className="text-xs">
                     López de Prado 業界最佳實務：寫死在 Gym 底層的保命網（與 max_drawdown 帳戶層級獨立）。設 0 = 禁用該規則
                   </CardDescription>
                 </BlockTitle>
               </CardHeader>
               <CardContent className="space-y-3">
                 <div className="grid grid-cols-3 gap-3">
<div>
                      <ParamLabel docKey="stop_loss_pct" />
                      <Input type="number" step="0.005" min="-1" max="0"
                        value={config.env.hard_limits.stop_loss_pct}
                        onChange={(e) => setConfig((p) => ({ ...p, env: { ...p.env, hard_limits: { ...p.env.hard_limits, stop_loss_pct: parseFloat(e.target.value) || 0 } } }))}
                        className="h-8 text-xs" />
                    </div>
                  <div>
                    <ParamLabel docKey="take_profit_pct" />
                    <Input type="number" step="0.005" min="0" max="1"
                      value={config.env.hard_limits.take_profit_pct}
                      onChange={(e) => setConfig((p) => ({ ...p, env: { ...p.env, hard_limits: { ...p.env.hard_limits, take_profit_pct: parseFloat(e.target.value) || 0 } } }))}
                      className="h-8 text-xs" />
                  </div>
                  <div>
                    <ParamLabel docKey="max_hold_bars" />
                    <Input type="number" step="1" min="0" max="5000"
                      value={config.env.hard_limits.max_hold_bars}
                      onChange={(e) => setConfig((p) => ({ ...p, env: { ...p.env, hard_limits: { ...p.env.hard_limits, max_hold_bars: parseInt(e.target.value) || 0 } } }))}
                      className="h-8 text-xs" />
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  例：-3% / +5% / 0 預設 = 單筆虧 3% 強制平倉 / 賺 5% 強制停利 / 不限持有時間
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <BlockTitle title="State Features" helpContent={STATE_FEATURES_MD}>
                  <CardDescription className="text-xs">Agent 觀察的特徵集合</CardDescription>
                </BlockTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {FEATURE_GROUPS.map((g) => (
                  <label key={g.key} className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-muted/40 cursor-pointer">
                    <Checkbox
                      checked={config.env.state_features[g.key] ?? false}
                      onCheckedChange={(c) => toggleFeature(g.key, !!c)}
                      className="mt-0.5"
                    />
                    <div className="flex-1">
                      <div className="text-xs font-medium">{g.label}</div>
                      <div className="text-[10px] text-muted-foreground">{g.desc}</div>
                    </div>
                  </label>
                ))}
                <div className="text-[10px] text-muted-foreground pt-2 border-t border-border/50">
                  ⚠️ 預設 12 維。TWII 缺個股欄位（營收/法人），僅用 OHLCV+技術指標。
                  v0.2 計畫加 cross-sectional 特徵（上漲家數等）。
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <BlockTitle title="Algorithm 與超參數" helpContent={ALGORITHM_MD}>
                  <CardDescription className="text-xs">stable-baselines3 預設值，可調</CardDescription>
                </BlockTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Algorithm</Label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {ALGO_OPTIONS.map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() => updateModel('algorithm', o.value)}
                        className={
                          'rounded-md border px-2 py-1.5 text-xs transition-colors ' +
                          (config.model.algorithm === o.value
                            ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                            : 'border-border bg-card hover:bg-muted/40')
                        }
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <ParamLabel docKey="learning_rate" />
                    <Input type="number" step="0.0001" value={config.model.learning_rate}
                      onChange={(e) => updateModel('learning_rate', parseFloat(e.target.value) || 3e-4)}
                      className="h-8 text-xs" />
                  </div>
                  <div>
                    <ParamLabel docKey="gamma" />
                    <Input type="number" step="0.01" min="0.9" max="0.999" value={config.model.gamma}
                      onChange={(e) => updateModel('gamma', parseFloat(e.target.value) || 0.99)}
                      className="h-8 text-xs" />
                  </div>
                  <div>
                    <ParamLabel docKey="n_steps" />
                    <Input type="number" step="256" min="256" max="8192" value={config.model.n_steps}
                      onChange={(e) => updateModel('n_steps', parseInt(e.target.value) || 2048)}
                      className="h-8 text-xs" />
                  </div>
                  <div>
                    <ParamLabel docKey="batch_size" />
                    <Input type="number" step="16" min="16" max="256" value={config.model.batch_size}
                      onChange={(e) => updateModel('batch_size', parseInt(e.target.value) || 64)}
                      className="h-8 text-xs" />
                  </div>
                  <div>
                    <ParamLabel docKey="seed" />
                    <Input type="number" step="1" min="0" value={config.model.seed}
                      onChange={(e) => updateModel('seed', parseInt(e.target.value) || 42)}
                      className="h-8 text-xs" />
                  </div>
                  <div>
                    <ParamLabel docKey="total_timesteps" />
                    <Input type="number" step="10000" min="1000" max="500000" value={config.model.total_timesteps}
                      onChange={(e) => updateModel('total_timesteps', parseInt(e.target.value) || 50000)}
                      className="h-8 text-xs" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <BlockTitle title="資料區間" helpContent={DATA_RANGE_MD}>
                  <CardDescription className="text-xs">使用已下載的 TWII 資料（495 筆）</CardDescription>
                </BlockTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <ParamLabel docKey="start_date" />
                    <Input type="date" value={config.data.start_date}
                      onChange={(e) => setConfig((p) => ({ ...p, data: { ...p.data, start_date: e.target.value } }))}
                      className="h-8 text-xs" />
                  </div>
                  <div>
                    <ParamLabel docKey="end_date" />
                    <Input type="date" value={config.data.end_date}
                      onChange={(e) => setConfig((p) => ({ ...p, data: { ...p.data, end_date: e.target.value } }))}
                      className="h-8 text-xs" />
                  </div>
                  <div>
                    <ParamLabel docKey="eval_start_date" />
                    <Input type="date" value={config.data.eval_start_date}
                      onChange={(e) => setConfig((p) => ({ ...p, data: { ...p.data, eval_start_date: e.target.value } }))}
                      className="h-8 text-xs" />
                  </div>
                  <div>
                    <ParamLabel docKey="eval_end_date" />
                    <Input type="date" value={config.data.eval_end_date}
                      onChange={(e) => setConfig((p) => ({ ...p, data: { ...p.data, eval_end_date: e.target.value } }))}
                      className="h-8 text-xs" />
                  </div>
                </div>
                <p className="mt-2 text-[10px] text-muted-foreground">
                  OOS = out-of-sample：模型只用 &lt; OOS 起始 的資料訓練，評估只跑 &ge; OOS 起始（避免 in-sample 假象）
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <BlockTitle title="Walk-Forward" helpContent={WALK_FORWARD_MD}>
                  <CardDescription className="text-xs">強制啟用（避免 overfitting）</CardDescription>
                </BlockTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={config.walk_forward.enabled}
                    onCheckedChange={(c) => setConfig((p) => ({ ...p, walk_forward: { ...p.walk_forward, enabled: !!c } }))}
                  />
                  <span className="text-xs">啟用 walk-forward（建議勾選）</span>
                </label>
                <div className="grid grid-cols-2 gap-3">
{(['train_window', 'val_window', 'test_window', 'roll_step'] as const).map((k) => (
                    <div key={k}>
                      <ParamLabel docKey={k} />
                      <Input type="number" min="10" max="5000" value={config.walk_forward[k]}
                        onChange={(e) => setConfig((p) => ({ ...p, walk_forward: { ...p.walk_forward, [k]: parseInt(e.target.value) || 50 } }))}
                        className="h-8 text-xs" />
                    </div>
                  ))}
                 </div>
                 {!wfValidation.ok && (
                   <div className="text-xs text-destructive bg-destructive/10 px-3 py-2 border border-destructive/30 rounded">
                     {wfValidation.msg}
                   </div>
                 )}
               </CardContent>
             </Card>

             {/* 資料集瀏覽 */}
             <Card className="lg:col-span-2">
               <CardHeader className="pb-3">
                 <div className="flex items-center justify-between">
                   <BlockTitle title="資料集瀏覽（前 100 筆）" helpContent={DATA_RANGE_MD}>
                     <CardDescription className="text-xs">
                       {dsTotal > 0 ? `特徵矩陣共 ${dsTotal.toLocaleString()} 根 15 分 K · 37 欄` : '載入台指期特徵矩陣預覽'}
                     </CardDescription>
                   </BlockTitle>
                   <Button variant="outline" size="sm" onClick={() => fetchDataset(100)} disabled={dsLoading}>
                     <RefreshCw className={`h-3.5 w-3.5 mr-1 ${dsLoading ? 'animate-spin' : ''}`} />
                     {dsLoading ? '載入中' : '重新載入'}
                   </Button>
                 </div>
               </CardHeader>
               <CardContent>
                 {dsError && (
                   <div className="text-xs text-destructive bg-destructive/10 px-3 py-2 border border-destructive/30 rounded mb-3">
                     {dsError}
                   </div>
                 )}
                 {dsRows.length === 0 && !dsError && !dsLoading && (
                   <div className="text-xs text-muted-foreground py-6 text-center">
                     <Database className="h-5 w-5 mx-auto mb-2 opacity-40" />
                     尚未載入資料集，點「重新載入」查看前 100 筆
                   </div>
                 )}
{dsRows.length > 0 && (
                  <ScrollArea className="h-64 max-w-full rounded-md border">
                    <Table className="min-w-max">
                      <TableHeader>
                        <TableRow>
                          {dsColumns.map((c) => (
                            <TableHead key={c} className="text-[10px] whitespace-nowrap font-mono px-3">{c}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {dsRows.map((row, i) => (
                          <TableRow key={i}>
                            {dsColumns.map((c) => (
                              <TableCell key={c} className="text-[10px] font-mono whitespace-nowrap px-3">
                                {fmtCell(row[c])}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                )}
               </CardContent>
             </Card>
           </div>
         </div>
       </AppShell>
     </>
   )
}

function fmtCell(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return v.toLocaleString()
    return v.toFixed(4)
  }
  return String(v)
}

function useLatestJob() {
  const [latest, setLatest] = useState<{
    job_id: string; status: string; total_timesteps: number; created_at?: number
  } | null>(null)
  useEffect(() => {
    fetch('/api/tx-rl/jobs/latest')
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.job_id) setLatest(d) })
      .catch(() => {})
  }, [])
  return latest
}

function WarningIconButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 hover:bg-amber-500/25 transition-colors shrink-0"
        aria-label="學術預期結果警示"
        title="點擊看警示說明"
      >
        <AlertTriangle className="h-3.5 w-3.5" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] p-0 gap-0">
          <DialogHeader className="px-6 pt-5 pb-3 border-b border-amber-500/30 bg-amber-500/5">
            <DialogTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <span className="text-amber-700 dark:text-amber-400">學術預期結果（必讀）</span>
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="px-6 py-4 max-h-[70vh]">
            <div className="text-foreground">
              {renderMarkdown(WARNING_MD)}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  )
}

function InlineLatestStatus() {
  const latest = useLatestJob()
  if (!latest) return null
  const ts = latest.created_at ? new Date(latest.created_at * 1000) : null
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded-full shrink-0">
      <Activity className="h-3 w-3" />
      最新：{latest.total_timesteps?.toLocaleString() ?? '?'} steps
      {ts && <span className="text-emerald-700/60">· {ts.toLocaleString('zh-TW', { hour12: false })}</span>}
    </span>
  )
}

function LatestResultButtons() {
  const router = useRouter()
  const latest = useLatestJob()
  if (!latest) return null
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => router.push('/tx-rl/backtest')}>
        查看回測
      </Button>
      <Button size="sm" onClick={() => router.push('/tx-rl/evaluation')}>
        <BarChart3 className="h-3.5 w-3.5 mr-1" />
        可視化
      </Button>
    </>
  )
}

function renderMarkdown(md: string): React.ReactNode {
  const out: React.ReactNode[] = []
  const lines = md.split('\n')
  let k = 0
  const renderInline = (text: string): React.ReactNode => {
    const parts: React.ReactNode[] = []
    let remaining = text
    let i = 0
    while (remaining.length > 0) {
      const boldMatch = remaining.match(/\*\*(.+?)\*\*/)
      const codeMatch = remaining.match(/`([^`]+)`/)
      const matches = [
        boldMatch ? { type: 'b', m: boldMatch, len: boldMatch[0].length } : null,
        codeMatch ? { type: 'c', m: codeMatch, len: codeMatch[0].length } : null,
      ].filter(Boolean).sort((a, b) => (a!.m.index! - b!.m.index!))
      if (matches.length === 0) { parts.push(<span key={i++}>{remaining}</span>); break }
      const first = matches[0]!
      if (first.m.index! > 0) parts.push(<span key={i++}>{remaining.slice(0, first.m.index!)}</span>)
      if (first.type === 'b') parts.push(<strong key={i++} className="font-semibold">{first.m[1]}</strong>)
      else parts.push(<code key={i++} className="px-1 py-0.5 rounded bg-muted text-[11px] font-mono">{first.m[1]}</code>)
      remaining = remaining.slice(first.m.index! + first.len)
    }
    return <>{parts}</>
  }
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]
    if (line.startsWith('### ')) out.push(<h3 key={k++} className="text-sm font-semibold mt-3 mb-1.5">{renderInline(line.slice(4))}</h3>)
    else if (line.startsWith('## ')) out.push(<h2 key={k++} className="text-base font-bold mt-4 mb-2 border-b border-border/50 pb-1">{renderInline(line.slice(3))}</h2>)
    else if (line.trim().startsWith('- ')) {
      const items: React.ReactNode[] = []
      while (li < lines.length && lines[li].trim().startsWith('- ')) {
        items.push(<li key={k++} className="ml-4 list-disc text-xs leading-relaxed">{renderInline(lines[li].trim().slice(2))}</li>)
        li++
      }
      out.push(<ul key={k++} className="my-1.5 space-y-0.5">{items}</ul>)
      li--
    }
    else if (line.trim().startsWith('|') && li + 1 < lines.length && /^\s*\|[\s\-:|]+\|\s*$/.test(lines[li + 1])) {
      const parseRow = (s: string) => s.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim())
      const headerCells = parseRow(line)
      li += 2
      const bodyRows: string[][] = []
      while (li < lines.length && lines[li].trim().startsWith('|')) {
        bodyRows.push(parseRow(lines[li]))
        li++
      }
      out.push(
        <div key={k++} className="my-2 overflow-x-auto rounded border border-border/60">
          <table className="w-full text-xs">
            <thead className="bg-muted/40">
              <tr>{headerCells.map((h, j) => <th key={j} className="text-left px-2 py-1.5 font-semibold border-b border-border/60">{renderInline(h)}</th>)}</tr>
            </thead>
            <tbody>{bodyRows.map((row, ri) => (
              <tr key={ri} className="border-b border-border/30 last:border-b-0">
                {row.map((c, j) => <td key={j} className="px-2 py-1.5 align-top">{renderInline(c)}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>,
      )
      li--
    }
    else if (line.trim() === '') {}
    else out.push(<p key={k++} className="text-xs leading-relaxed my-1.5">{renderInline(line)}</p>)
  }
  return <div>{out}</div>
}

// ── 超參數說明（hover tooltip）───────────────────────────────────
type ParamDoc = {
  meaning: string     // 這是什麼
  range: string       // 合理範圍
  impact: string      // 影響行為
}

const PARAM_DOCS: Record<string, ParamDoc> = {
  lambda_dd: {
    meaning: 'Reward 中對最大回撤的懲罰係數（multi_objective 模式專用）',
    range: '常用 0.1 ~ 1.0，預設 0.5。>1.0 過度保守、<0.1 幾乎不避險',
    impact: '愈大 agent 愈保守（縮短持倉、降低曝險）；愈小愈激進',
  },
  mu_trade: {
    meaning: 'Reward 中對每次交易的懲罰（手續費/磨損成本近似）',
    range: '0.0001 ~ 0.01，預設 0.001。>0.01 會幾乎不交易',
    impact: '抑制過度交易（高頻翻單）；太大會讓 agent 不敢進場',
  },
  stop_loss_pct: {
    meaning: '單筆虧損達此比例時強制平倉（Hard Limit，安全網）',
    range: '-0.10 ~ 0（0=禁用）。預設 -0.03 = -3%',
    impact: '過小易被正常波動洗出去；過大虧損失控',
  },
  take_profit_pct: {
    meaning: '單筆獲利達此比例時強制平倉（Hard Limit，鎖利）',
    range: '0 ~ 0.50（0=禁用）。預設 0.05 = +5%',
    impact: '過小提早實現、浪費趨勢；過大回吐已得利潤',
  },
  max_hold_bars: {
    meaning: '持倉最長 K 棒數（Hard Limit，超時強制平倉）',
    range: '0 = 不限。預設 0；15 分 K 環境下常見 10~50',
    impact: '避免 agent 永遠抱著不放、累積風險',
  },
  slippage_pct: {
    meaning: '模擬成交滑價（單邊）',
    range: '0 ~ 0.01，預設 0.003 = 0.3%（實際 TX 滑價通常 0.5~2 tick）',
    impact: '降低交易期望值、讓 agent 更謹慎選時機',
  },
  commission_pct: {
    meaning: '模擬手續費（單邊）',
    range: '0 ~ 0.005，預設 0.0015 = 0.15%（期貨常見 NT$1~2/口/單邊）',
    impact: '增加交易成本、鼓勵長線持有減少 churn',
  },
  learning_rate: {
    meaning: 'PPO/A2C 學習率（Adam optimizer）',
    range: '1e-5 ~ 1e-3，預設 3e-4。>1e-3 易發散、<1e-5 收斂極慢',
    impact: '太大訓練不穩、loss 震盪；太小學很慢',
  },
  gamma: {
    meaning: '未來 reward 折扣因子（0~1）',
    range: '0.9 ~ 0.999，預設 0.99。期貨 RL 通常 0.95~0.99',
    impact: '愈大愈重視長期報酬（適合波段）；太小短視',
  },
  n_steps: {
    meaning: 'PPO rollout 步數（收集樣本的 horizon）',
    range: '256 ~ 8192，預設 2048。16 的倍數',
    impact: '太小 variance 大、太慢；太大 batch size 要跟著調',
  },
  batch_size: {
    meaning: 'PPO 每次梯度更新的 mini-batch 大小',
    range: '16 ~ 256，預設 64。n_steps 的因數',
    impact: '太小梯度雜訊大、太大會記憶體爆掉',
  },
  seed: {
    meaning: '隨機性種子（重現實驗）',
    range: '任何整數。預設 42',
    impact: '同 seed 同結果；不同 seed 結果會變動',
  },
  total_timesteps: {
    meaning: '總訓練步數（agent 對環境的互動次數）',
    range: '1000 ~ 500000，預設 50000。>=1.5×n_steps',
    impact: '太少收斂不足；太多過擬合且耗時',
  },
  start_date: {
    meaning: '資料起始日（最早 K 棒）',
    range: 'YYYY-MM-DD，需在特徵矩陣範圍內',
    impact: '影響訓練樣本數；太早可能含異常期',
  },
  end_date: {
    meaning: '資料結束日（最晚 K 棒）',
    range: 'YYYY-MM-DD，需在特徵矩陣範圍內',
    impact: '影響訓練 + 評估樣本分界',
  },
  eval_start_date: {
    meaning: 'OOS（樣本外）評估起始日',
    range: 'YYYY-MM-DD，應 > start_date 且 < end_date',
    impact: '區分「訓練用 vs 評估用」資料；評估前不讓 agent 看到此區間',
  },
  eval_end_date: {
    meaning: 'OOS 評估結束日',
    range: 'YYYY-MM-DD，應 > eval_start_date 且 ≤ end_date',
    impact: '太短統計不顯著、太長可能超出 walk-forward 視窗',
  },
  train_window: {
    meaning: 'Walk-forward 訓練視窗長度（天）',
    range: '10 ~ 5000 天，預設 2520 = 10 年',
    impact: '太短樣本不足、太長收斂慢且容易 overfit 老資料',
  },
  val_window: {
    meaning: 'Walk-forward 驗證視窗長度（天，0=無驗證）',
    range: '0 ~ 1000。預設 0（用 OOS 評估）',
    impact: '>0 可 early stopping；太大會擠壓測試集',
  },
  test_window: {
    meaning: 'Walk-forward OOS 測試視窗長度（天）',
    range: '10 ~ 5000 天，預設 504 = 2 年',
    impact: '太短指標不穩定；太長樣本數被吃掉',
  },
  roll_step: {
    meaning: 'Walk-forward 視窗滾動步數（天）',
    range: '10 ~ 5000，預設 504（每窗重疊）',
    impact: '小於 test_window → 視窗重疊、增加折數；等於 test_window → 無重疊',
  },
}

function ParamLabel({ htmlFor, docKey }: { htmlFor?: string; docKey: string }) {
  const doc = PARAM_DOCS[docKey]
  const labelText = doc?.meaning.split('（')[0] ?? docKey
  if (!doc) {
    return <Label htmlFor={htmlFor} className="text-xs text-muted-foreground">{labelText}</Label>
  }
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Label htmlFor={htmlFor} className="text-xs text-muted-foreground inline-flex items-center gap-1 cursor-help">
            {labelText}
            <HelpCircle className="h-3 w-3 opacity-60" />
          </Label>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[320px] text-xs leading-relaxed">
          <div className="space-y-1">
            <div><span className="font-semibold text-foreground">含義：</span>{doc.meaning}</div>
            <div><span className="font-semibold text-foreground">範圍：</span>{doc.range}</div>
            <div><span className="font-semibold text-foreground">影響：</span>{doc.impact}</div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
