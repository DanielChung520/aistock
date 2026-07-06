'use client'

import React, { useState, ChangeEvent } from 'react'
import type { IndicatorSettings } from '@/types/stock'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Settings } from 'lucide-react'

interface IndicatorSettingsPopupProps {
  indicator: keyof Omit<IndicatorSettings, 'version'>
  settings: IndicatorSettings
  onUpdate: <K extends keyof Omit<IndicatorSettings, 'version'>>(
    indicator: K,
    values: Partial<IndicatorSettings[K]>
  ) => void
  onReset: (indicator: keyof Omit<IndicatorSettings, 'version'>) => void
}

const INDICATOR_TITLES: Record<string, string> = {
  ma: 'MA均線',
  bollinger: '布林通道',
  kdj: 'KDJ',
  macd: 'MACD',
  rsi: 'RSI',
}

export function IndicatorSettingsPopup({
  indicator,
  settings,
  onUpdate,
  onReset,
}: IndicatorSettingsPopupProps) {
  const [open, setOpen] = useState(false)
  const [maPeriodsText, setMaPeriodsText] = useState('')

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen)
    if (newOpen && indicator === 'ma') {
      setMaPeriodsText(settings.ma.periods.join(','))
    }
  }

  const handleMaBlur = () => {
    const parsed = maPeriodsText
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n > 0 && n <= 250)

    if (parsed.length > 0) {
      onUpdate('ma', { periods: parsed })
    } else {
      setMaPeriodsText(settings.ma.periods.join(','))
    }
  }

  const handleNumberChange = (
    key: string,
    val: string,
    min: number,
    max: number,
    updateFn: (parsedVal: number) => void
  ) => {
    const num = parseFloat(val)
    if (!isNaN(num)) {
      const clamped = Math.max(min, Math.min(max, num))
      updateFn(clamped)
    }
  }

  const renderMaSettings = () => (
    <>
      <div className="space-y-2">
        <Label className="text-xs">週期 (逗號分隔)</Label>
        <Input
          value={maPeriodsText}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setMaPeriodsText(e.target.value)}
          onBlur={handleMaBlur}
          className="h-8"
        />
      </div>
      <div className="space-y-2">
        <Label className="text-xs">類型</Label>
        <Select
          value={settings.ma.type}
          onValueChange={(val: 'sma' | 'ema') => onUpdate('ma', { type: val })}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="選擇類型" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="sma" className="text-xs">SMA (簡單移動平均)</SelectItem>
            <SelectItem value="ema" className="text-xs">EMA (指數移動平均)</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </>
  )

  const renderBollingerSettings = () => (
    <>
      <div className="space-y-2">
        <Label className="text-xs">週期</Label>
        <Input
          type="number"
          min={2}
          max={250}
          value={settings.bollinger.period || ''}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            handleNumberChange('period', e.target.value, 2, 250, (val) =>
              onUpdate('bollinger', { period: val })
            )
          }
          className="h-8"
        />
      </div>
      <div className="space-y-2">
        <Label className="text-xs">標準差</Label>
        <Input
          type="number"
          min={0.5}
          max={5}
          step={0.5}
          value={settings.bollinger.stdDev || ''}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            handleNumberChange('stdDev', e.target.value, 0.5, 5, (val) =>
              onUpdate('bollinger', { stdDev: val })
            )
          }
          className="h-8"
        />
      </div>
    </>
  )

  const renderKdjSettings = () => (
    <>
      <div className="space-y-2">
        <Label className="text-xs">週期</Label>
        <Input
          type="number"
          min={2}
          max={250}
          value={settings.kdj.period || ''}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            handleNumberChange('period', e.target.value, 2, 250, (val) =>
              onUpdate('kdj', { period: val })
            )
          }
          className="h-8"
        />
      </div>
      <div className="space-y-2">
        <Label className="text-xs">K平滑</Label>
        <Input
          type="number"
          min={1}
          max={50}
          value={settings.kdj.kSmooth || ''}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            handleNumberChange('kSmooth', e.target.value, 1, 50, (val) =>
              onUpdate('kdj', { kSmooth: val })
            )
          }
          className="h-8"
        />
      </div>
      <div className="space-y-2">
        <Label className="text-xs">D平滑</Label>
        <Input
          type="number"
          min={1}
          max={50}
          value={settings.kdj.dSmooth || ''}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            handleNumberChange('dSmooth', e.target.value, 1, 50, (val) =>
              onUpdate('kdj', { dSmooth: val })
            )
          }
          className="h-8"
        />
      </div>
    </>
  )

  const renderMacdSettings = () => (
    <>
      <div className="space-y-2">
        <Label className="text-xs">快線週期</Label>
        <Input
          type="number"
          min={2}
          max={250}
          value={settings.macd.fast || ''}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            handleNumberChange('fast', e.target.value, 2, 250, (val) =>
              onUpdate('macd', { fast: val })
            )
          }
          className="h-8"
        />
      </div>
      <div className="space-y-2">
        <Label className="text-xs">慢線週期</Label>
        <Input
          type="number"
          min={2}
          max={250}
          value={settings.macd.slow || ''}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            const val = parseInt(e.target.value, 10)
            if (!isNaN(val)) {
              const clamped = Math.max(settings.macd.fast + 1, Math.min(250, val))
              onUpdate('macd', { slow: clamped })
            }
          }}
          className="h-8"
        />
      </div>
      <div className="space-y-2">
        <Label className="text-xs">訊號週期</Label>
        <Input
          type="number"
          min={2}
          max={250}
          value={settings.macd.signal || ''}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            handleNumberChange('signal', e.target.value, 2, 250, (val) =>
              onUpdate('macd', { signal: val })
            )
          }
          className="h-8"
        />
      </div>
    </>
  )

  const renderRsiSettings = () => (
    <div className="space-y-2">
      <Label className="text-xs">週期</Label>
      <Input
        type="number"
        min={2}
        max={250}
        value={settings.rsi.period || ''}
        onChange={(e: ChangeEvent<HTMLInputElement>) =>
          handleNumberChange('period', e.target.value, 2, 250, (val) =>
            onUpdate('rsi', { period: val })
          )
        }
        className="h-8"
      />
    </div>
  )

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
          <Settings className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72" align="start">
        <div className="space-y-4">
          <div className="font-bold text-sm">{INDICATOR_TITLES[indicator as string]}</div>
          
          <div className="space-y-3">
            {indicator === 'ma' && renderMaSettings()}
            {indicator === 'bollinger' && renderBollingerSettings()}
            {indicator === 'kdj' && renderKdjSettings()}
            {indicator === 'macd' && renderMacdSettings()}
            {indicator === 'rsi' && renderRsiSettings()}
          </div>

          <div className="pt-2 border-t mt-4">
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs h-8"
              onClick={() => {
                onReset(indicator)
                setOpen(false)
              }}
            >
              重設
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
