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
import { BlockTitle, HelpButton } from '@/components/tx-rl/HelpButton'
import {
  ACTION_SPACE_MD, REWARD_FUNCTION_MD, STATE_FEATURES_MD,
  ALGORITHM_MD, DATA_RANGE_MD, WALK_FORWARD_MD,
  WARNING_MD,
} from '@/components/tx-rl/help-content'

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
              <Button onClick={onStart} disabled={submitting} size="sm">
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

            <Card>
              <CardHeader className="pb-3">
                <BlockTitle title="資料區間" helpContent={DATA_RANGE_MD}>
                  <CardDescription className="text-xs">使用已下載的 TWII 資料（495 筆）</CardDescription>
                </BlockTitle>
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
