'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { ChevronDown, ChevronUp, Info, RotateCcw } from 'lucide-react'
import type { ModelType } from './step1-model'

export interface ModelParams {
  n_estimators: number
  max_depth: number
  learning_rate: number
  subsample: number
  colsample_bytree: number
  hidden_units: number
  epochs: number
  batch_size: number
  sequence_length: number
  reg_alpha: number
  reg_lambda: number
  min_child_weight: number
  gamma: number
  min_samples_split: number
  min_samples_leaf: number
  alpha: number
  validation_fraction: number
  n_iter_no_change: number
  early_stopping: number
  early_stopping_rounds: number
  dropout: number
  weight_decay: number
  layers: number
}

export const DEFAULT_PARAMS: Record<ModelType, ModelParams> = {
  xgboost: {
    n_estimators: 200,
    max_depth: 4,
    learning_rate: 0.03,
    subsample: 0.7,
    colsample_bytree: 0.6,
    reg_alpha: 0.5,
    reg_lambda: 5.0,
    min_child_weight: 10,
    gamma: 0.1,
    early_stopping_rounds: 30,
    hidden_units: 0,
    epochs: 0,
    batch_size: 0,
    sequence_length: 0,
    min_samples_split: 0,
    min_samples_leaf: 0,
    alpha: 0,
    validation_fraction: 0,
    n_iter_no_change: 0,
    early_stopping: 0,
    dropout: 0,
    weight_decay: 0,
    layers: 0,
  },
  lightgbm: {
    n_estimators: 200,
    max_depth: 0,
    learning_rate: 0.03,
    subsample: 0.7,
    colsample_bytree: 0.6,
    reg_alpha: 0.5,
    reg_lambda: 5.0,
    min_child_weight: 0,
    gamma: 0,
    early_stopping_rounds: 30,
    hidden_units: 0,
    epochs: 0,
    batch_size: 0,
    sequence_length: 0,
    min_samples_split: 0,
    min_samples_leaf: 0,
    alpha: 0,
    validation_fraction: 0,
    n_iter_no_change: 0,
    early_stopping: 0,
    dropout: 0,
    weight_decay: 0,
    layers: 0,
  },
  randomforest: {
    n_estimators: 200,
    max_depth: 8,
    min_samples_split: 5,
    min_samples_leaf: 2,
    learning_rate: 0,
    subsample: 0,
    colsample_bytree: 0,
    reg_alpha: 0,
    reg_lambda: 0,
    min_child_weight: 0,
    gamma: 0,
    early_stopping_rounds: 0,
    hidden_units: 0,
    epochs: 0,
    batch_size: 0,
    sequence_length: 0,
    alpha: 0,
    validation_fraction: 0,
    n_iter_no_change: 0,
    early_stopping: 0,
    dropout: 0,
    weight_decay: 0,
    layers: 0,
  },
  mlp: {
    n_estimators: 0,
    max_depth: 0,
    learning_rate: 0.001,
    alpha: 0.001,
    early_stopping: 1,
    validation_fraction: 0.1,
    n_iter_no_change: 10,
    subsample: 0,
    colsample_bytree: 0,
    reg_alpha: 0,
    reg_lambda: 0,
    min_child_weight: 0,
    gamma: 0,
    early_stopping_rounds: 0,
    hidden_units: 32,
    epochs: 60,
    batch_size: 64,
    sequence_length: 0,
    min_samples_split: 0,
    min_samples_leaf: 0,
    dropout: 0,
    weight_decay: 0,
    layers: 0,
  },
  lstm: {
    n_estimators: 0,
    max_depth: 0,
    learning_rate: 0.001,
    dropout: 0.2,
    weight_decay: 1e-4,
    layers: 1,
    subsample: 0,
    colsample_bytree: 0,
    reg_alpha: 0,
    reg_lambda: 0,
    min_child_weight: 0,
    gamma: 0,
    early_stopping_rounds: 0,
    hidden_units: 32,
    epochs: 30,
    batch_size: 64,
    sequence_length: 20,
    min_samples_split: 0,
    min_samples_leaf: 0,
    alpha: 0,
    validation_fraction: 0,
    n_iter_no_change: 0,
    early_stopping: 0,
  },
}

interface ParamField {
  key: keyof ModelParams
  label: string
  hint: string
  min: number
  max: number
  step: number
  group: 'basic' | 'advanced' | 'nn'
}

const FIELDS_BY_MODEL: Record<ModelType, ParamField[]> = {
  xgboost: [
    { key: 'n_estimators', label: 'n_estimators 樹的數量', hint: '範圍 50~2000 · 預設 200 · 影響:訓練時間與擬合能力', min: 50, max: 2000, step: 50, group: 'basic' },
    { key: 'max_depth', label: 'max_depth 樹最大深度', hint: '範圍 3~15 · 預設 4 · 影響:過擬合風險（越小越保守）', min: 3, max: 15, step: 1, group: 'basic' },
    { key: 'learning_rate', label: 'learning_rate 學習率', hint: '範圍 0.001~0.3 · 預設 0.03 · 影響:收斂速度', min: 0.001, max: 0.3, step: 0.005, group: 'basic' },
    { key: 'subsample', label: 'subsample 每棵樹樣本比例', hint: '範圍 0.5~1.0 · 預設 0.7 · 影響:多樣性', min: 0.5, max: 1, step: 0.05, group: 'advanced' },
    { key: 'colsample_bytree', label: 'colsample_bytree 每棵樹特徵比例', hint: '範圍 0.5~1.0 · 預設 0.6 · 影響:特徵多樣性', min: 0.5, max: 1, step: 0.05, group: 'advanced' },
    { key: 'reg_alpha', label: 'reg_alpha L1 正則化', hint: '範圍 0~10 · 預設 0.5 · 影響:稀疏化（特徵選擇）', min: 0, max: 10, step: 0.1, group: 'advanced' },
    { key: 'reg_lambda', label: 'reg_lambda L2 正則化', hint: '範圍 0~20 · 預設 5.0 · 影響:權重收縮（防止過擬合）', min: 0, max: 20, step: 0.5, group: 'advanced' },
    { key: 'min_child_weight', label: 'min_child_weight 最小葉子權重', hint: '範圍 1~50 · 預設 10 · 影響:防止過度擬合小樣本', min: 1, max: 50, step: 1, group: 'advanced' },
    { key: 'gamma', label: 'gamma 分裂最小損失', hint: '範圍 0~5 · 預設 0.1 · 影響:分裂門檻（值越大越保守）', min: 0, max: 5, step: 0.1, group: 'advanced' },
    { key: 'early_stopping_rounds', label: 'early_stopping_rounds 早停輪數', hint: '範圍 0~100 · 預設 30 · 0=關閉 · 影響:val 無改善 N 輪後停止', min: 0, max: 100, step: 5, group: 'advanced' },
  ],
  lightgbm: [
    { key: 'n_estimators', label: 'n_estimators 樹的數量', hint: '範圍 50~2000 · 預設 200', min: 50, max: 2000, step: 50, group: 'basic' },
    { key: 'learning_rate', label: 'learning_rate 學習率', hint: '範圍 0.001~0.3 · 預設 0.03', min: 0.001, max: 0.3, step: 0.005, group: 'basic' },
    { key: 'subsample', label: 'subsample 樣本比例', hint: '範圍 0.5~1.0 · 預設 0.7', min: 0.5, max: 1, step: 0.05, group: 'advanced' },
    { key: 'colsample_bytree', label: 'colsample_bytree 特徵比例', hint: '範圍 0.5~1.0 · 預設 0.6', min: 0.5, max: 1, step: 0.05, group: 'advanced' },
    { key: 'reg_alpha', label: 'reg_alpha L1 正則化', hint: '範圍 0~10 · 預設 0.5', min: 0, max: 10, step: 0.1, group: 'advanced' },
    { key: 'reg_lambda', label: 'reg_lambda L2 正則化', hint: '範圍 0~20 · 預設 5.0', min: 0, max: 20, step: 0.5, group: 'advanced' },
    { key: 'early_stopping_rounds', label: 'early_stopping_rounds 早停輪數', hint: '範圍 0~100 · 預設 30 · 0=關閉', min: 0, max: 100, step: 5, group: 'advanced' },
  ],
  randomforest: [
    { key: 'n_estimators', label: 'n_estimators 樹的數量', hint: '範圍 50~1000 · 預設 200', min: 50, max: 1000, step: 50, group: 'basic' },
    { key: 'max_depth', label: 'max_depth 樹最大深度', hint: '範圍 3~30 · 預設 8 · 影響:過擬合風險（越小越保守）', min: 3, max: 30, step: 1, group: 'basic' },
    { key: 'min_samples_split', label: 'min_samples_split 最小分裂樣本', hint: '範圍 2~50 · 預設 5 · 影響:防止過度分裂', min: 2, max: 50, step: 1, group: 'advanced' },
    { key: 'min_samples_leaf', label: 'min_samples_leaf 最小葉子樣本', hint: '範圍 1~20 · 預設 2 · 影響:防止過度擬合', min: 1, max: 20, step: 1, group: 'advanced' },
  ],
  mlp: [
    { key: 'hidden_units', label: 'hidden_units 神經元數', hint: '範圍 16~512 · 預設 32 · 影響:模型容量（越大越易過擬合）', min: 16, max: 512, step: 16, group: 'basic' },
    { key: 'epochs', label: 'epochs 訓練輪數', hint: '範圍 10~500 · 預設 60', min: 10, max: 500, step: 10, group: 'basic' },
    { key: 'batch_size', label: 'batch_size 批次大小', hint: '範圍 8~256 · 預設 64', min: 8, max: 256, step: 8, group: 'basic' },
    { key: 'learning_rate', label: 'learning_rate 學習率', hint: '範圍 0.0001~0.01 · 預設 0.001', min: 0.0001, max: 0.01, step: 0.0001, group: 'advanced' },
    { key: 'alpha', label: 'alpha L2 正則化', hint: '範圍 0~0.01 · 預設 0.001 · 影響:權重衰減（防止過擬合）', min: 0, max: 0.01, step: 0.0001, group: 'advanced' },
    { key: 'early_stopping', label: 'early_stopping 早停', hint: '0=關閉 · 1=啟用 · 預設 1（自動停止無改善的訓練）', min: 0, max: 1, step: 1, group: 'advanced' },
    { key: 'validation_fraction', label: 'validation_fraction 內部驗證比例', hint: '範圍 0.05~0.3 · 預設 0.1 · 影響:早停用的驗證集大小', min: 0.05, max: 0.3, step: 0.05, group: 'advanced' },
    { key: 'n_iter_no_change', label: 'n_iter_no_change 早停容忍輪數', hint: '範圍 5~50 · 預設 10', min: 5, max: 50, step: 1, group: 'advanced' },
  ],
  lstm: [
    { key: 'sequence_length', label: 'sequence_length 序列長度', hint: '範圍 5~60 · 預設 20 · 影響:輸入窗口', min: 5, max: 60, step: 1, group: 'basic' },
    { key: 'hidden_units', label: 'hidden_units LSTM 隱藏單元', hint: '範圍 16~256 · 預設 32 · 影響:模型容量', min: 16, max: 256, step: 16, group: 'basic' },
    { key: 'epochs', label: 'epochs 訓練輪數', hint: '範圍 10~200 · 預設 30', min: 10, max: 200, step: 5, group: 'basic' },
    { key: 'batch_size', label: 'batch_size 批次大小', hint: '範圍 8~128 · 預設 64', min: 8, max: 128, step: 8, group: 'basic' },
    { key: 'learning_rate', label: 'learning_rate 學習率', hint: '範圍 0.0001~0.01 · 預設 0.001', min: 0.0001, max: 0.01, step: 0.0001, group: 'advanced' },
    { key: 'dropout', label: 'dropout 丟棄率', hint: '範圍 0~0.5 · 預設 0.2 · 影響:防止過擬合', min: 0, max: 0.5, step: 0.05, group: 'advanced' },
    { key: 'weight_decay', label: 'weight_decay L2 正則化', hint: '範圍 0~0.001 · 預設 0.0001 · 影響:權重衰減', min: 0, max: 0.001, step: 0.0001, group: 'advanced' },
    { key: 'layers', label: 'layers LSTM 層數', hint: '範圍 1~3 · 預設 1 · 影響:模型深度', min: 1, max: 3, step: 1, group: 'advanced' },
  ],
}

export function Step2Params({
  model,
  params,
  onChange,
}: {
  model: ModelType
  params: ModelParams
  onChange: (p: ModelParams) => void
}) {
  const fields = FIELDS_BY_MODEL[model]
  const [showAdvanced, setShowAdvanced] = useState(false)
  const basicFields = fields.filter((f) => f.group !== 'advanced')
  const advancedFields = fields.filter((f) => f.group === 'advanced')

  const update = (key: keyof ModelParams, value: number) => {
    onChange({ ...params, [key]: value })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Step 2 / 6：訓練參數</h2>
          <p className="text-xs text-muted-foreground mt-1">
            模型：<b className="text-foreground">{model.toUpperCase()}</b> · 預設從經驗值帶入，可調整
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange(DEFAULT_PARAMS[model])}
          className="text-xs"
        >
          <RotateCcw className="h-3 w-3 mr-1" />
          重置為預設
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">基本參數</CardTitle>
          <CardDescription className="text-xs">每個欄位含說明 tooltip</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {basicFields.map((f) => (
            <ParamRow key={f.key} field={f} value={params[f.key]} onChange={(v) => update(f.key, v)} />
          ))}
        </CardContent>
      </Card>

      {advancedFields.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex items-center justify-between w-full text-left"
            >
              <CardTitle className="text-sm flex items-center gap-2">
                {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                進階參數
              </CardTitle>
              <span className="text-[11px] text-muted-foreground">{advancedFields.length} 項</span>
            </button>
          </CardHeader>
          {showAdvanced && (
            <CardContent className="space-y-3 pt-0">
              {advancedFields.map((f) => (
                <ParamRow key={f.key} field={f} value={params[f.key]} onChange={(v) => update(f.key, v)} />
              ))}
            </CardContent>
          )}
        </Card>
      )}
    </div>
  )
}

function ParamRow({
  field,
  value,
  onChange,
}: {
  field: ParamField
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_140px] gap-2 items-center">
      <div className="flex items-start gap-1.5">
        <Label className="text-xs">{field.label}</Label>
        <span title={field.hint} className="inline-flex">
          <Info className="h-3 w-3 text-muted-foreground cursor-help" />
        </span>
      </div>
      <Input
        type="number"
        min={field.min}
        max={field.max}
        step={field.step}
        value={value}
        onChange={(e) => {
          const v = parseFloat(e.target.value)
          if (!Number.isNaN(v)) onChange(v)
        }}
        className="h-8 text-xs"
      />
    </div>
  )
}
