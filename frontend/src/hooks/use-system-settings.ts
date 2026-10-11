'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  DEFAULT_SYSTEM_SETTINGS,
  STORAGE_KEY,
  CURRENT_VERSION,
  migrateSettings,
  type SystemSettings,
} from '@/lib/system-settings-defaults'

const API_URL = '/api/system-settings'

function loadLocalCache(): SystemSettings | null {
  if (typeof window === 'undefined') return null
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return null
    return migrateSettings(JSON.parse(stored))
  } catch {
    return null
  }
}

function saveLocalCache(settings: SystemSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // ignore
  }
}

async function fetchRemoteSettings(): Promise<SystemSettings | null> {
  try {
    const res = await fetch(API_URL)
    if (!res.ok) return null
    const json = (await res.json()) as { settings?: unknown }
    return migrateSettings(json.settings)
  } catch {
    return null
  }
}

async function pushRemoteSettings(settings: SystemSettings): Promise<boolean> {
  try {
    const res = await fetch(API_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    })
    return res.ok
  } catch {
    return false
  }
}

export function useSystemSettings() {
  const [settings, setSettings] = useState<SystemSettings>(
    () => loadLocalCache() ?? DEFAULT_SYSTEM_SETTINGS
  )
  const [loaded, setLoaded] = useState(false)
  const hydrated = useRef(false)

  // 初始載入：以 ArangoDB（/api/system-settings）為準覆蓋本機快取
  useEffect(() => {
    let cancelled = false
    fetchRemoteSettings().then((remote) => {
      if (cancelled) return
      if (remote) {
        setSettings(remote)
        saveLocalCache(remote)
      } else {
        // 本機快取存在但後端無資料 → 推上後端建立文件
        const cached = loadLocalCache()
        if (cached) pushRemoteSettings(cached)
        else pushRemoteSettings(DEFAULT_SYSTEM_SETTINGS)
      }
      setLoaded(true)
      hydrated.current = true
    })
    return () => {
      cancelled = true
    }
  }, [])

  const updateSetting = useCallback(<K extends keyof Omit<SystemSettings, 'version'>>(
    key: K,
    value: SystemSettings[K],
  ) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value } as SystemSettings
      next.version = CURRENT_VERSION
      return next
    })
  }, [])

  // 設定變更後統一寫入 localStorage + ArangoDB
  useEffect(() => {
    if (!hydrated.current || !loaded) return
    saveLocalCache(settings)
    pushRemoteSettings(settings)
  }, [settings, loaded])

  const resetSettings = useCallback(() => {
    const next = { ...DEFAULT_SYSTEM_SETTINGS, version: CURRENT_VERSION }
    setSettings(next)
  }, [])

  // 重新從 ArangoDB 拉取最新設定（AI 搜索前呼叫，避免頁面長期開啟時持舊值）
  const refresh = useCallback(async (): Promise<SystemSettings> => {
    const remote = await fetchRemoteSettings()
    if (remote) {
      setSettings(remote)
      saveLocalCache(remote)
      return remote
    }
    return settings
  }, [settings])

  return { settings, loaded, updateSetting, resetSettings, refresh }
}
