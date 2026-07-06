'use client'

import React from 'react'
import type { IndicatorSettings } from '@/types/stock'
import { Button } from '@/components/ui/button'
import { IndicatorSettingsPopup } from './IndicatorSettingsPopup'

interface IndicatorToolbarProps {
  settings: IndicatorSettings
  onUpdateSetting: <K extends keyof Omit<IndicatorSettings, 'version'>>(
    indicator: K,
    values: Partial<IndicatorSettings[K]>
  ) => void
  onResetSetting: (indicator: keyof Omit<IndicatorSettings, 'version'>) => void
}

const INDICATORS = [
  { key: 'ma', label: 'MA均線', hasSettings: true },
  { key: 'bollinger', label: '布林通道', hasSettings: true },
  { key: 'volume', label: '成交量', hasSettings: false },
  { key: 'kdj', label: 'KDJ', hasSettings: true },
  { key: 'macd', label: 'MACD', hasSettings: true },
  { key: 'rsi', label: 'RSI', hasSettings: true },
] as const

export function IndicatorToolbar({
  settings,
  onUpdateSetting,
  onResetSetting,
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
    </div>
  )
}
