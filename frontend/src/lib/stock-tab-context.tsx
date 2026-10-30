'use client'

import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from 'react'

export interface StockTab {
  symbol: string
  name: string
}

interface StockTabContextType {
  tabs: StockTab[]
  activeTab: string | null
  openTab: (symbol: string, name: string) => void
  closeTab: (symbol: string) => void
  setActiveTab: (symbol: string | null) => void
}

const STORAGE_KEY = 'aistock-stock-tabs'
const STORAGE_VERSION = 2

interface StoredStockTabs {
  version: number
  tabs: StockTab[]
  activeTab: string | null
}

function loadStored(): StoredStockTabs | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredStockTabs
    if (parsed.version !== STORAGE_VERSION) return null
    if (!Array.isArray(parsed.tabs)) return null
    const active = parsed.activeTab
    if (active !== null && active !== undefined && !parsed.tabs.some((t) => t.symbol === active)) {
      return { version: STORAGE_VERSION, tabs: parsed.tabs, activeTab: null }
    }
    return parsed
  } catch {
    return null
  }
}

// sessionStorage is client-only, so the store exposes an empty snapshot during
// SSR and hydration and switches to the persisted tabs afterwards. useSyncExternalStore
// keeps the server HTML and the first client render identical (no hydration mismatch).
const SERVER_SNAPSHOT: StoredStockTabs = { version: STORAGE_VERSION, tabs: [], activeTab: null }
let currentSnapshot: StoredStockTabs = SERVER_SNAPSHOT
let hasLoaded = false
const listeners = new Set<() => void>()

function getSnapshot(): StoredStockTabs {
  if (!hasLoaded) {
    currentSnapshot = loadStored() ?? SERVER_SNAPSHOT
    hasLoaded = true
  }
  return currentSnapshot
}

function getServerSnapshot(): StoredStockTabs {
  return SERVER_SNAPSHOT
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function commit(next: StoredStockTabs): void {
  currentSnapshot = next
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // sessionStorage unavailable — persistence is best-effort only
  }
  for (const listener of listeners) listener()
}

const StockTabContext = createContext<StockTabContextType | null>(null)

export function StockTabProvider({ children }: { children: ReactNode }) {
  const { tabs, activeTab } = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const openTab = useCallback((symbol: string, name: string) => {
    const prev = getSnapshot()
    const exists = prev.tabs.some((t) => t.symbol === symbol)
    commit({
      version: STORAGE_VERSION,
      tabs: exists ? prev.tabs : [...prev.tabs, { symbol, name }],
      activeTab: symbol,
    })
  }, [])

  const closeTab = useCallback((symbol: string) => {
    const prev = getSnapshot()
    const idx = prev.tabs.findIndex((t) => t.symbol === symbol)
    if (idx < 0) return
    const nextTabs = prev.tabs.filter((_, i) => i !== idx)
    let active = prev.activeTab
    if (nextTabs.length === 0) {
      active = null
    } else if (active === symbol) {
      active = nextTabs[Math.min(idx, nextTabs.length - 1)].symbol
    }
    commit({ version: STORAGE_VERSION, tabs: nextTabs, activeTab: active })
  }, [])

  const setActiveTab = useCallback((symbol: string | null) => {
    commit({ version: STORAGE_VERSION, tabs: getSnapshot().tabs, activeTab: symbol })
  }, [])

  return (
    <StockTabContext.Provider value={{ tabs, activeTab, openTab, closeTab, setActiveTab }}>
      {children}
    </StockTabContext.Provider>
  )
}

export function useStockTabs(): StockTabContextType {
  const ctx = useContext(StockTabContext)
  if (!ctx) throw new Error('useStockTabs must be used within StockTabProvider')
  return ctx
}
