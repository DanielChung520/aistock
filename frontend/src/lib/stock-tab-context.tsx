'use client'

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

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

const StockTabContext = createContext<StockTabContextType | null>(null)

export function StockTabProvider({ children }: { children: ReactNode }) {
  const [tabs, setTabs] = useState<StockTab[]>([])
  const [activeTab, setActiveTab] = useState<string | null>(null)

  const openTab = useCallback((symbol: string, name: string) => {
    setTabs((prev) => {
      const existing = prev.find((t) => t.symbol === symbol)
      if (existing) {
        setActiveTab(symbol)
        return prev
      }
      setActiveTab(symbol)
      return [...prev, { symbol, name }]
    })
  }, [])

  const closeTab = useCallback((symbol: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.symbol === symbol)
      if (idx < 0) return prev
      const next = prev.filter((_, i) => i !== idx)
      if (next.length === 0) {
        setActiveTab(null)
      } else if (activeTab === symbol) {
        setActiveTab(next[Math.min(idx, next.length - 1)].symbol)
      }
      return next
    })
  }, [activeTab])

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
