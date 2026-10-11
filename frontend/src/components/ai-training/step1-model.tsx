'use client'

import { useEffect, useState } from 'react'
import { Brain, Trees, Sparkles, Clock, Cpu, Zap } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export type ModelType = 'xgboost' | 'lightgbm' | 'randomforest' | 'mlp' | 'lstm'
export type DeviceChoice = 'auto' | 'cuda' | 'cpu'

export interface ModelOption {
  id: ModelType
  group: 'ml' | 'nn'
  name: string
  tagline: string
  description: string
  estimatedMinutes: string
  recommended?: boolean
}

interface HardwareInfo {
  gpu: {
    available: boolean
    name?: string | null
    capability?: string | null
    memory_total_mb?: number | null
    memory_free_mb?: number | null
    torch_version?: string
    cuda_version?: string | null
  }
  opencl: { available: boolean; platform?: string[] | null }
  recommended: string
}

const DEVICE_OPTIONS: { id: DeviceChoice; label: string; hint: string }[] = [
  { id: 'auto', label: '自動', hint: '有 GPU 用 GPU，否則 CPU' },
  { id: 'cuda', label: 'GPU', hint: '強制使用 CUDA GPU（不可用會報錯）' },
  { id: 'cpu', label: 'CPU', hint: '強制使用 CPU（省電、可攜）' },
]

const MODELS: ModelOption[] = [
  {
    id: 'xgboost',
    group: 'ml',
    name: 'XGBoost',
    tagline: '表格資料常用基線',
    description: '89 欄特徵通常表現穩定，訓練快、參數成熟',
    estimatedMinutes: '1~3 分鐘',
    recommended: true,
  },
  {
    id: 'lightgbm',
    group: 'ml',
    name: 'LightGBM',
    tagline: '大資料更快',
    description: '記憶體友善，類別特徵支援佳，適合多股票批次',
    estimatedMinutes: '1~3 分鐘',
  },
  {
    id: 'randomforest',
    group: 'ml',
    name: 'RandomForest',
    tagline: '簡單、抗噪音',
    description: '集成多棵決策樹，作為穩定基線對照',
    estimatedMinutes: '2~4 分鐘',
  },
  {
    id: 'mlp',
    group: 'nn',
    name: 'MLP',
    tagline: '特徵交叉學習',
    description: '多層感知器，可學習非線性特徵組合',
    estimatedMinutes: '2~5 分鐘',
  },
  {
    id: 'lstm',
    group: 'nn',
    name: 'LSTM',
    tagline: '時序依賴',
    description: '可捕捉序列關係，需設定 sequence_length',
    estimatedMinutes: '10~30 分鐘',
  },
]

export function Step1ModelSelection({
  value,
  onChange,
  device,
  onDeviceChange,
}: {
  value: ModelType | null
  onChange: (m: ModelType) => void
  device: DeviceChoice
  onDeviceChange: (d: DeviceChoice) => void
}) {
  const [hardware, setHardware] = useState<HardwareInfo | null>(null)
  const [hwLoading, setHwLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch('/api/ai-training/hardware')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: HardwareInfo) => {
        if (!cancelled) setHardware(d)
      })
      .catch(() => {
        if (!cancelled) setHardware(null)
      })
      .finally(() => {
        if (!cancelled) setHwLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const gpuOk = hardware?.gpu.available ?? false
  const gpuName = hardware?.gpu.name ?? 'GPU'
  const gpuMem = hardware?.gpu.memory_total_mb
  const cudaVer = hardware?.gpu.cuda_version

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Step 1 / 6：選擇訓練方式</h2>
        <p className="text-xs text-muted-foreground mt-1">
          選擇「機器學習」或「類神經網路」後，挑選具體模型。每個模型卡含簡介與訓練時間預估。
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* ── 機器學習 ── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Trees className="h-4 w-4 text-muted-foreground" />
              機器學習（樹模型）
            </CardTitle>
            <CardDescription className="text-xs">不需要標準化，訓練快速</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {MODELS.filter((m) => m.group === 'ml').map((m) => (
              <ModelCard key={m.id} model={m} selected={value === m.id} onSelect={() => onChange(m.id)} />
            ))}
          </CardContent>
        </Card>

        {/* ── 類神經網路 ── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Brain className="h-4 w-4 text-muted-foreground" />
              類神經網路
            </CardTitle>
            <CardDescription className="text-xs">需要標準化，可捕捉複雜模式</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {MODELS.filter((m) => m.group === 'nn').map((m) => (
              <ModelCard key={m.id} model={m} selected={value === m.id} onSelect={() => onChange(m.id)} />
            ))}
          </CardContent>
        </Card>
      </div>

      {/* ── 運算裝置（硬體檢查） ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Cpu className="h-4 w-4 text-muted-foreground" />
            運算裝置
          </CardTitle>
          <CardDescription className="text-xs">
            硬體檢查結果與訓練加速方式（模型較大時 GPU 可明顯縮短時間）
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* 硬體狀態列 */}
          <div className="flex items-center gap-2 flex-wrap text-xs">
            {hwLoading ? (
              <span className="text-muted-foreground flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-full bg-muted animate-pulse" />
                檢查硬體中…
              </span>
            ) : gpuOk ? (
              <Badge variant="secondary" className="text-[11px] gap-1">
                <Zap className="h-3 w-3 text-amber-500" />
                {gpuName} {gpuMem ? `· ${(gpuMem / 1024).toFixed(0)} GB` : ''}{' '}
                {cudaVer ? `· CUDA ${cudaVer}` : ''}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[11px] gap-1">
                <Cpu className="h-3 w-3" />
                未偵測到 GPU — 僅 CPU 可用
              </Badge>
            )}
            {!hwLoading && (
              <span className="text-muted-foreground">
                {gpuOk ? 'GPU 加速可用' : '建議使用 CPU'}
              </span>
            )}
          </div>

          {/* 三選 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {DEVICE_OPTIONS.map((o) => {
              const unavailable = o.id === 'cuda' && !gpuOk && !hwLoading
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => !unavailable && onDeviceChange(o.id)}
                  disabled={unavailable}
                  className={
                    'text-left rounded-md border px-3 py-2 transition-colors disabled:opacity-40 ' +
                    (device === o.id
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                      : 'border-border bg-card hover:bg-muted/40')
                  }
                >
                  <div className="text-sm font-medium">
                    {o.label}
                    {o.id === 'auto' && (
                      <Badge variant="secondary" className="text-[10px] h-4 px-1.5 ml-1.5">
                        ⭐ 推薦
                      </Badge>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {o.id === 'cuda' && !gpuOk && !hwLoading ? '此主機不可用' : o.hint}
                  </div>
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <p className="text-[11px] text-muted-foreground">ⓘ v1 範圍含以上 5 個模型；之後可加 Transformer、集成等。</p>
    </div>
  )
}

function ModelCard({
  model,
  selected,
  onSelect,
}: {
  model: ModelOption
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={
        'w-full text-left rounded-md border px-3 py-2.5 transition-colors ' +
        (selected
          ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
          : 'border-border bg-card hover:bg-muted/40')
      }
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium">{model.name}</span>
            {model.recommended && (
              <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                ⭐ 基線推薦
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">{model.tagline}</div>
          <div className="text-[11px] text-muted-foreground mt-1">{model.description}</div>
        </div>
        <div className="shrink-0 flex items-center gap-1 text-[10px] text-muted-foreground whitespace-nowrap">
          <Clock className="h-3 w-3" />
          {model.estimatedMinutes}
        </div>
      </div>
    </button>
  )
}
