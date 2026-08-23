'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AppShell } from '@/components/app-shell'
import { Toaster } from '@/components/ui/sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { AlertTriangle, Bot, Database, Settings, Play, Sparkles } from 'lucide-react'

type ActionMode = 'discrete_3' | 'discrete_5' | 'continuous'
type RewardMode = 'pure_pnl' | 'sharpe' | 'multi_objective'
type Algorithm = 'ppo' | 'a2c' | 'dqn'

interface TXConfig {
  data: { start_date: string; end_date: string }
  env: {
    action_mode: ActionMode
    reward_mode: RewardMode
    reward_params: { lambda_dd: number; mu_trade: number }
    state_features: Record<string, boolean>
    fees: { slippage_pct: number; commission_pct: number }
  }
  model: { algorithm: Algorithm; learning_rate: number; n_steps: number; batch_size: number; gamma: number; seed: number; total_timesteps: number }
  walk_forward: { enabled: boolean; train_window: number; val_window: number; test_window: number; roll_step: number }
}

const DEFAULT_CONFIG: TXConfig = {
  data: { start_date: '2024-08-08', end_date: '2026-08-21' },
  env: {
    action_mode: 'discrete_3',
    reward_mode: 'pure_pnl',
    reward_params: { lambda_dd: 0.5, mu_trade: 0.001 },
    state_features: { price: true, tech: true, vol: true, position: true, calendar: false },
    fees: { slippage_pct: 0.3, commission_pct: 0.15 },
  },
  model: { algorithm: 'ppo', learning_rate: 3e-4, n_steps: 2048, batch_size: 64, gamma: 0.99, seed: 42, total_timesteps: 50000 },
  walk_forward: { enabled: true, train_window: 250, val_window: 50, test_window: 50, roll_step: 50 },
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

  const updateEnv = <K extends keyof TXConfig['env']>(k: K, v: TXConfig['env'][K]) =>
    setConfig((p) => ({ ...p, env: { ...p.env, [k]: v } }))
  const updateModel = <K extends keyof TXConfig['model']>(k: K, v: TXConfig['model'][K]) =>
    setConfig((p) => ({ ...p, model: { ...p.model, [k]: v } }))
  const toggleFeature = (k: string, v: boolean) =>
    updateEnv('state_features', { ...config.env.state_features, [k]: v })

  const onStart = async () => {
    setSubmitting(true)
    // TODO: 接 backend POST /api/tx-rl/train
    toast.info('目前使用 mock — backend API 尚未實作', {
      description: 'SPEC 0.1 審查中。確認後再實作 Celery training。',
    })
    setTimeout(() => {
      setSubmitting(false)
      router.push('/tx-rl/training')
    }, 600)
  }

  return (
    <>
      <Toaster richColors position="top-center" />
      <AppShell title="台指期 RL">
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
                  RL 在台指期日頻的歷史實證效果有限。我們的 ML 測試：XGBoost OOS 勝率 56.9%（≈ 隨機）。
                  散戶劣勢：execution gap 0.3% × 2、單台電腦、無 co-location。
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 標題 */}
          <div className="shrink-0 flex items-center justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold flex items-center gap-2">
                <Bot className="h-5 w-5 text-muted-foreground" />
                台指期 RL — 環境定義
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                設定 Action Space、Reward Function、Algorithm 與超參數
              </p>
            </div>
            <Button onClick={onStart} disabled={submitting}>
              {submitting ? <Sparkles className="h-4 w-4 mr-1 animate-spin" /> : <Play className="h-4 w-4 mr-1" />}
              開始訓練
            </Button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto grid grid-cols-1 lg:grid-cols-2 gap-4 pb-4">
            {/* Action Space */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Action Space（可調參）</CardTitle>
                <CardDescription className="text-xs">RL agent 每次可採取的動作</CardDescription>
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

            {/* Reward Function */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Reward Function（可調參）</CardTitle>
                <CardDescription className="text-xs">訓練時 agent 嘗試最大化的目標</CardDescription>
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
                      <Label className="text-xs text-muted-foreground">λ (MDD 懲罰)</Label>
                      <Input
                        type="number" step="0.05" min="0" max="2"
                        value={config.env.reward_params.lambda_dd}
                        onChange={(e) => updateEnv('reward_params', { ...config.env.reward_params, lambda_dd: parseFloat(e.target.value) || 0 })}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">μ (交易懲罰)</Label>
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

            {/* State Features */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">State Features</CardTitle>
                <CardDescription className="text-xs">Agent 觀察的特徵集合</CardDescription>
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

            {/* Algorithm + 超參數 */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Algorithm 與超參數</CardTitle>
                <CardDescription className="text-xs">stable-baselines3 預設值，可調</CardDescription>
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
                    <Label className="text-xs text-muted-foreground">learning_rate</Label>
                    <Input type="number" step="0.0001" value={config.model.learning_rate}
                      onChange={(e) => updateModel('learning_rate', parseFloat(e.target.value) || 3e-4)}
                      className="h-8 text-xs" />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">gamma</Label>
                    <Input type="number" step="0.01" min="0.9" max="0.999" value={config.model.gamma}
                      onChange={(e) => updateModel('gamma', parseFloat(e.target.value) || 0.99)}
                      className="h-8 text-xs" />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">n_steps</Label>
                    <Input type="number" step="256" min="256" max="8192" value={config.model.n_steps}
                      onChange={(e) => updateModel('n_steps', parseInt(e.target.value) || 2048)}
                      className="h-8 text-xs" />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">batch_size</Label>
                    <Input type="number" step="16" min="16" max="256" value={config.model.batch_size}
                      onChange={(e) => updateModel('batch_size', parseInt(e.target.value) || 64)}
                      className="h-8 text-xs" />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">seed</Label>
                    <Input type="number" step="1" min="0" value={config.model.seed}
                      onChange={(e) => updateModel('seed', parseInt(e.target.value) || 42)}
                      className="h-8 text-xs" />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">total_timesteps</Label>
                    <Input type="number" step="10000" min="1000" max="500000" value={config.model.total_timesteps}
                      onChange={(e) => updateModel('total_timesteps', parseInt(e.target.value) || 50000)}
                      className="h-8 text-xs" />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 資料區間 + Walk-Forward */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Database className="h-4 w-4" /> 資料區間
                </CardTitle>
                <CardDescription className="text-xs">使用已下載的 TWII 資料（495 筆）</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">起始</Label>
                    <Input type="date" value={config.data.start_date}
                      onChange={(e) => setConfig((p) => ({ ...p, data: { ...p.data, start_date: e.target.value } }))}
                      className="h-8 text-xs" />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">結束</Label>
                    <Input type="date" value={config.data.end_date}
                      onChange={(e) => setConfig((p) => ({ ...p, data: { ...p.data, end_date: e.target.value } }))}
                      className="h-8 text-xs" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Settings className="h-4 w-4" /> Walk-Forward
                </CardTitle>
                <CardDescription className="text-xs">強制啟用（避免 overfitting）</CardDescription>
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
                      <Label className="text-xs text-muted-foreground">{k} (天)</Label>
                      <Input type="number" min="10" max="500" value={config.walk_forward[k]}
                        onChange={(e) => setConfig((p) => ({ ...p, walk_forward: { ...p.walk_forward, [k]: parseInt(e.target.value) || 50 } }))}
                        className="h-8 text-xs" />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </AppShell>
    </>
  )
}
