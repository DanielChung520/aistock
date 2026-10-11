'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import type { ModelType } from './step1-model'
import type { Target } from './step3-target'

export type SplitMethod = '60/20/20' | '70/15/15' | '80/10/10' | 'custom'
export type ScalerType = 'none' | 'standard' | 'robust' | 'minmax'

interface SplitOption {
  id: SplitMethod
  label: string
  ratios: [number, number, number]
}

const SPLIT_OPTIONS: SplitOption[] = [
  { id: '60/20/20', label: '60% / 20% / 20%', ratios: [60, 20, 20] },
  { id: '70/15/15', label: '70% / 15% / 15%（推薦）', ratios: [70, 15, 15] },
  { id: '80/10/10', label: '80% / 10% / 10%', ratios: [80, 10, 10] },
  { id: 'custom', label: '自訂比例', ratios: [0, 0, 0] },
]

const SCALER_OPTIONS: { value: ScalerType; label: string; hint: string }[] = [
  { value: 'none', label: 'none', hint: '不標準化' },
  { value: 'standard', label: 'standard', hint: '(x - mean) / std' },
  { value: 'robust', label: 'robust', hint: '(x - median) / IQR，適合離群值多' },
  { value: 'minmax', label: 'minmax', hint: '(x - min) / (max - min)，輸出 0~1' },
]

export function defaultScalerFor(model: ModelType): ScalerType {
  return model === 'mlp' || model === 'lstm' ? 'standard' : 'none'
}

export function Step4DataPrep({
  model,
  target,
  splitMethod,
  onSplitChange,
  customRatios,
  onCustomRatiosChange,
  scaler,
  onScalerChange,
  winsorize,
  onWinsorizeChange,
  winsorizeThreshold,
  onWinsorizeThresholdChange,
  preview,
}: {
  model: ModelType
  target: Target
  splitMethod: SplitMethod
  onSplitChange: (m: SplitMethod) => void
  customRatios: [number, number, number]
  onCustomRatiosChange: (r: [number, number, number]) => void
  scaler: ScalerType
  onScalerChange: (s: ScalerType) => void
  winsorize: boolean
  onWinsorizeChange: (b: boolean) => void
  winsorizeThreshold: '3sigma' | '5pct'
  onWinsorizeThresholdChange: (t: '3sigma' | '5pct') => void
  preview: { train: number; val: number; test: number; missing: number; anomalies: number }
}) {
  const isRegression = target === 'next_return' || target === 'next_5d_return'
  const sumCheck = customRatios[0] + customRatios[1] + customRatios[2]

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Step 4 / 6：資料準備</h2>
        <p className="text-xs text-muted-foreground mt-1">
          分割比例與標準化方式；資料預覽即時計算
        </p>
      </div>

      {/* ── 分割比例 ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">分割比例（時間序，不可隨機）</CardTitle>
          <CardDescription className="text-xs">訓練 / 驗證 / 測試</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {SPLIT_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => onSplitChange(opt.id)}
              className={
                'w-full text-left rounded-md border px-3 py-2 text-xs transition-colors ' +
                (splitMethod === opt.id
                  ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                  : 'border-border bg-card hover:bg-muted/40')
              }
            >
              {opt.label}
            </button>
          ))}
          {splitMethod === 'custom' && (
            <div className="grid grid-cols-3 gap-2 mt-2 max-w-md">
              {(['訓練', '驗證', '測試'] as const).map((label, i) => (
                <div key={label}>
                  <Label className="text-xs text-muted-foreground">{label} %</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={customRatios[i]}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10) || 0
                      const next = [...customRatios] as [number, number, number]
                      next[i] = v
                      onCustomRatiosChange(next)
                    }}
                    className="h-8 text-xs"
                  />
                </div>
              ))}
              <div className="col-span-3 text-xs">
                {sumCheck === 100 ? (
                  <span className="text-emerald-600 dark:text-emerald-400">✓ 總和 100%</span>
                ) : (
                  <span className="text-destructive">⚠ 總和 {sumCheck}%，需為 100%</span>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── 標準化 ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">標準化（依模型自動建議，可覆寫）</CardTitle>
          <CardDescription className="text-xs">
            樹模型建議 none；神經網路建議 standard
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {SCALER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onScalerChange(opt.value)}
                className={
                  'rounded-md border px-3 py-2 text-xs text-left transition-colors ' +
                  (scaler === opt.value
                    ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                    : 'border-border bg-card hover:bg-muted/40')
                }
              >
                <div className="font-medium">{opt.label}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">{opt.hint}</div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── 標籤處理（回歸才顯示） ── */}
      {isRegression && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">標籤處理</CardTitle>
            <CardDescription className="text-xs">Winsorize 處理肥尾極端值（僅回歸目標）</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <Checkbox id="winsorize" checked={winsorize} onCheckedChange={(c) => onWinsorizeChange(!!c)} />
              <Label htmlFor="winsorize" className="text-xs cursor-pointer">
                啟用 Winsorize
              </Label>
              {winsorize && (
                <div className="flex items-center gap-1.5">
                  <Label className="text-xs text-muted-foreground">閾值</Label>
                  <select
                    value={winsorizeThreshold}
                    onChange={(e) => onWinsorizeThresholdChange(e.target.value as '3sigma' | '5pct')}
                    className="h-7 rounded border border-border bg-card px-2 text-xs"
                  >
                    <option value="3sigma">±3σ</option>
                    <option value="5pct">±5%</option>
                  </select>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── 資料預覽 ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">資料預覽（即時計算）</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="訓練樣本" value={preview.train.toLocaleString()} tone="good" />
            <Stat label="驗證樣本" value={preview.val.toLocaleString()} />
            <Stat label="測試樣本" value={preview.test.toLocaleString()} tone="good" />
          </div>
          <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
            <Badge variant="outline" className="text-[10px]">缺值 {preview.missing}</Badge>
            <Badge variant="outline" className="text-[10px]">異常 {preview.anomalies}</Badge>
            <span>·</span>
            <span>基於 {preview.train + preview.val + preview.test} 筆可用資料</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2 text-center">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div
        className={
          'text-base font-bold tabular-nums mt-0.5 ' +
          (tone === 'good' ? 'text-emerald-600 dark:text-emerald-400' : '')
        }
      >
        {value}
      </div>
    </div>
  )
}
