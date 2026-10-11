'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { IndicatorSettings } from '@/types/stock'

const STORAGE_KEY = 'aistock-indicator-settings'
const CURRENT_VERSION = 4

export const DEFAULT_SETTINGS: IndicatorSettings = {
  version: CURRENT_VERSION,
  ma: {
    enabled: true,
    periods: [8, 21, 55, 89],
    lookback: 8,
    cooldown: 1,
    buySlopeMin: 0.05,
    sellSlopeMax: 0.02,
  },
  bollinger: { enabled: false, period: 20, stdDev: 2 },
  volume: { enabled: true },
  volume_ma: { enabled: false, periods: [5, 10] },
  kdj: { enabled: false, period: 9, kSmooth: 3, dSmooth: 3 },
  macd: { enabled: false, fast: 12, slow: 26, signal: 9 },
  rsi: { enabled: false, period: 14 },
}

function loadSettings(): IndicatorSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      if (parsed.version === CURRENT_VERSION) {
        return parsed as IndicatorSettings
      }
      if (parsed.version === 3) {
        // v3 → v4: volume moving averages (MV5/MV10) added on the volume pane.
        const migrated: IndicatorSettings = {
          ...DEFAULT_SETTINGS,
          ...parsed,
          version: 4,
          volume_ma: { enabled: false, periods: [5, 10] },
        }
        return migrated
      }
      if (parsed.version === 1 || parsed.version === 2) {
        // Migrate v1/v2 → v4 in one step: MA gained signal parameters
        // (cooldown, slope thresholds); volume_ma added.
        const migrated: IndicatorSettings = {
          ...DEFAULT_SETTINGS,
          ...parsed,
          version: 4,
          ma: {
            enabled: parsed.ma?.enabled ?? true,
            periods: parsed.ma?.periods?.length ? parsed.ma.periods : [8, 21, 55, 89],
            lookback: parsed.ma?.lookback ?? 8,
            cooldown: 1,
            buySlopeMin: 0.05,
            sellSlopeMax: 0.02,
          },
          volume_ma: { enabled: false, periods: [5, 10] },
        }
        return migrated
      }
    }
  } catch (e) {
    console.error('Failed to parse indicator settings from localStorage', e)
  }
  return DEFAULT_SETTINGS
}

interface UseIndicatorSettingsReturn {
  settings: IndicatorSettings
  updateSetting: <K extends keyof Omit<IndicatorSettings, 'version'>>(
    indicator: K,
    values: Partial<IndicatorSettings[K]>
  ) => void
  resetSetting: (indicator: keyof Omit<IndicatorSettings, 'version'>) => void
  resetAll: () => void
}

export function useIndicatorSettings(): UseIndicatorSettingsReturn {
  const [settings, setSettings] = useState<IndicatorSettings>(loadSettings)
  const isInitialMount = useRef(true)

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false
      return
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  }, [settings])

  const updateSetting = useCallback(
    <K extends keyof Omit<IndicatorSettings, 'version'>>(
      indicator: K,
      values: Partial<IndicatorSettings[K]>
    ) => {
      setSettings((prev) => {
        const merged = { ...prev[indicator], ...values }

        if (indicator === 'ma') {
          const ma = merged as IndicatorSettings['ma']
          if (ma.periods) {
            const validPeriods = ma.periods.filter(
              (p: number) => p >= 2 && p <= 250
            )
            ma.periods = validPeriods.length > 0 ? validPeriods : [8]
          }
          if (ma.lookback !== undefined) {
            ma.lookback = Math.min(Math.max(ma.lookback, 1), 250)
          }
          if (ma.cooldown !== undefined) {
            ma.cooldown = Math.min(Math.max(ma.cooldown, 0), 50)
          }
          if (ma.buySlopeMin !== undefined) {
            ma.buySlopeMin = Math.min(Math.max(ma.buySlopeMin, 0), 10)
          }
          if (ma.sellSlopeMax !== undefined) {
            ma.sellSlopeMax = Math.min(Math.max(ma.sellSlopeMax, 0), 10)
          }
          return { ...prev, ma }
        }

        if (indicator === 'macd') {
          const macd = merged as IndicatorSettings['macd']
          if (macd.fast >= macd.slow) {
            return prev
          }
          return { ...prev, macd }
        }

        if (indicator === 'bollinger') {
          const bb = merged as IndicatorSettings['bollinger']
          if (bb.stdDev !== undefined) {
            bb.stdDev = Math.min(Math.max(bb.stdDev, 0.5), 5.0)
          }
          return { ...prev, bollinger: bb }
        }

        return { ...prev, [indicator]: merged }
      })
    },
    []
  )

  const resetSetting = useCallback(
    (indicator: keyof Omit<IndicatorSettings, 'version'>) => {
      setSettings((prev) => ({
        ...prev,
        [indicator]: DEFAULT_SETTINGS[indicator],
      }))
    },
    []
  )

  const resetAll = useCallback(() => {
    setSettings(DEFAULT_SETTINGS)
  }, [])

  return {
    settings,
    updateSetting,
    resetSetting,
    resetAll,
  }
}
