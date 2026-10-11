'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import { AlertCircle, StopCircle, Loader2 } from 'lucide-react'
import type { ModelType } from './step1-model'

export type TrainStatus = 'idle' | 'running' | 'completed' | 'failed'

export type LossPoint = { epoch: number; train: number | null; val: number | null }

const chartConfig = {
  train: {
    label: 'train_loss',
    color: '#3b82f6',
  },
  val: {
    label: 'val_loss',
    color: '#f59e0b',
  },
} satisfies ChartConfig

export function Step5Training({
  model,
  status,
  currentEpoch,
  totalEpochs,
  trainLoss,
  valLoss,
  nSamples,
  lossHistory,
  elapsedSec,
  remainingSec,
  warning,
  onStart,
  onStop,
  onForceCancel,
  onRetry,
}: {
  model: ModelType
  status: TrainStatus
  currentEpoch: number
  totalEpochs: number
  trainLoss: number | null
  valLoss: number | null
  nSamples: number | null
  lossHistory: LossPoint[]
  elapsedSec: number
  remainingSec: number
  warning: string | null
  onStart: () => void
  onStop: () => void
  onForceCancel: () => void
  onRetry: () => void
}) {
  const pct = totalEpochs > 0 ? Math.round((currentEpoch / totalEpochs) * 100) : 0
  const isRunning = status === 'running'
  const hasCurve = lossHistory.length >= 2

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Step 5 / 6：訓練中...</h2>
        <p className="text-xs text-muted-foreground mt-1">
          模型：<b className="text-foreground">{model.toUpperCase()}</b> · 即時進度與損失曲線
        </p>
      </div>

      {/* ── 摘要 ── */}
      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div>
              <div className="text-muted-foreground">模型</div>
              <div className="font-medium">{model.toUpperCase()}</div>
            </div>
            <div>
              <div className="text-muted-foreground">樣本數</div>
              <div className="font-medium">{nSamples?.toLocaleString() ?? '— 筆'}</div>
            </div>
            <div>
              <div className="text-muted-foreground">分割</div>
              <div className="font-medium">70 / 15 / 15</div>
            </div>
            <div>
              <div className="text-muted-foreground">預估時間</div>
              <div className="font-medium">1~3 分鐘</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── 訓練進度 ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">訓練進度</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {status === 'idle' && (
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground mb-4">設定完成，按下「開始訓練」啟動</p>
              <Button onClick={onStart} size="lg">
                開始訓練
              </Button>
            </div>
          )}
          {isRunning && (
            <>
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
                  Epoch {currentEpoch} / {totalEpochs}
                </span>
                <span className="text-muted-foreground">
                  {pct}% · {formatTime(elapsedSec)} / 預估剩餘 {formatTime(remainingSec)}
                </span>
              </div>
              <Progress value={pct} className="h-2" />
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-md border bg-muted/30 px-3 py-2">
                  <div className="text-muted-foreground text-[10px]">train_loss</div>
                  <div className="font-mono font-bold">{trainLoss?.toFixed(4) ?? '—'}</div>
                </div>
                <div className="rounded-md border bg-muted/30 px-3 py-2">
                  <div className="text-muted-foreground text-[10px]">val_loss</div>
                  <div className="font-mono font-bold">{valLoss?.toFixed(4) ?? '—'}</div>
                </div>
              </div>
            </>
          )}
          {status === 'completed' && (
            <div className="text-center py-8 text-emerald-600 dark:text-emerald-400">
              <p className="text-sm">✓ 訓練完成</p>
              <p className="text-xs text-muted-foreground mt-1">最終 train_loss={trainLoss?.toFixed(4)} · val_loss={valLoss?.toFixed(4)}</p>
            </div>
          )}
{status === 'failed' && (
              <div className="text-center py-8 text-destructive">
                <p className="text-sm">訓練失敗</p>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={onRetry}
                  className="mt-2"
                >
                  重新訓練
                </Button>
              </div>
          )}
        </CardContent>
      </Card>

      {/* ── 損失曲線 ── */}
      {(isRunning || status === 'completed') && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">損失曲線</CardTitle>
            <CardDescription className="text-xs">
              train_loss / val_loss 隨 epoch 變化
            </CardDescription>
          </CardHeader>
          <CardContent>
            {hasCurve ? (
              <div className="[perspective:1000px]">
                <div className="transition-transform duration-500 [transform:rotateX(8deg)] [transform-style:preserve-3d] hover:[transform:rotateX(0deg)]">
                  <ChartContainer config={chartConfig} className="h-56 w-full">
                    <LineChart
                      data={lossHistory}
                      margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
                      accessibilityLayer
                    >
                      <CartesianGrid vertical={false} />
                      <XAxis
                        dataKey="epoch"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        label={{ value: 'epoch', position: 'insideBottomRight', offset: -4 }}
                      />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        width={45}
                        tickFormatter={(v: number) => v.toFixed(3)}
                      />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Line
                        dataKey="train"
                        type="monotone"
                        stroke="var(--color-train)"
                        strokeWidth={2}
                        dot={false}
                        connectNulls
                      />
                      <Line
                        dataKey="val"
                        type="monotone"
                        stroke="var(--color-val)"
                        strokeWidth={2}
                        dot={false}
                        connectNulls
                      />
                    </LineChart>
                  </ChartContainer>
                </div>
              </div>
            ) : (
              <div className="h-40 rounded border border-dashed bg-muted/20 flex items-center justify-center text-xs text-muted-foreground">
                {status === 'completed' ? '訓練完成 · 曲線資料不足' : '等待 epoch 累積 · 曲線繪製中...'}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── 警告 ── */}
      {warning && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="pt-4 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <div className="text-xs">{warning}</div>
          </CardContent>
        </Card>
      )}

      {/* ── 控制 ── */}
      {isRunning && (
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onStop}>
            <StopCircle className="h-3.5 w-3.5 mr-1" />
            停止訓練
          </Button>
          <Button variant="destructive" size="sm" onClick={onForceCancel}>
            強制取消
          </Button>
        </div>
      )}
    </div>
  )
}

function formatTime(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
