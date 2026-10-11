'use client'

import React from 'react'
import type { IndicatorSettings, MaAccuracy } from '@/types/stock'
import { Button } from '@/components/ui/button'
import { IndicatorSettingsPopup } from './IndicatorSettingsPopup'

interface IndicatorToolbarProps {
  settings: IndicatorSettings
  onUpdateSetting: <K extends keyof Omit<IndicatorSettings, 'version'>>(
    indicator: K,
    values: Partial<IndicatorSettings[K]>
  ) => void
  onResetSetting: (indicator: keyof Omit<IndicatorSettings, 'version'>) => void
  accuracy?: MaAccuracy
}

const INDICATORS = [
  { key: 'ma', label: 'Daniel MA', hasSettings: true },
  { key: 'bollinger', label: '布林通道', hasSettings: true },
  { key: 'volume', label: '成交量', hasSettings: false },
  { key: 'volume_ma', label: '量 MA', hasSettings: false },
  { key: 'kdj', label: 'KDJ', hasSettings: true },
  { key: 'macd', label: 'MACD', hasSettings: true },
  { key: 'rsi', label: 'RSI', hasSettings: true },
] as const

export function IndicatorToolbar({
  settings,
  onUpdateSetting,
  onResetSetting,
  accuracy,
}: IndicatorToolbarProps) {
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => { setMounted(true) }, [])
  if (!mounted) return <div className="flex gap-1.5 flex-wrap items-center" />

  return (
    <div className="flex gap-1.5 flex-wrap items-center">
      {INDICATORS.map(({ key, label, hasSettings }) => {
        const indicatorKey = key as keyof Omit<IndicatorSettings, 'version'>
        const setting = settings[indicatorKey]
        const isEnabled = 'enabled' in setting ? setting.enabled : false

        return (
          <div key={key} className="flex items-center gap-0.5">
            <Button
              variant={isEnabled ? 'default' : 'outline'}
              onClick={() => {
                const values = { enabled: !isEnabled } as unknown as Partial<IndicatorSettings[typeof indicatorKey]>
                onUpdateSetting(indicatorKey, values)
              }}
              className="h-7 px-2 text-xs"
            >
              {label}
            </Button>
            {hasSettings && (
              <IndicatorSettingsPopup
                indicator={indicatorKey}
                settings={settings}
                onUpdate={onUpdateSetting}
                onReset={onResetSetting}
              />
            )}
          </div>
        )
      })}
      {accuracy && (
        <span className="ml-auto text-[11px] text-muted-foreground whitespace-nowrap">
          買準確率 <span className="text-red-500">{accuracy.buy_accuracy != null ? accuracy.buy_accuracy + '%' : '—'}</span>
          {' / '}
          賣準確率 <span className="text-green-500">{accuracy.sell_accuracy != null ? accuracy.sell_accuracy + '%' : '—'}</span>
          <span className="text-muted-foreground/70"> ({accuracy.horizon}根)</span>
        </span>
      )}
    </div>
  )
}
