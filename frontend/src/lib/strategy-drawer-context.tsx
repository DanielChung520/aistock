'use client'

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

interface StrategyDrawerContextType {
  isOpen: boolean
  open: () => void
  close: () => void
  toggle: () => void
}

const StrategyDrawerContext = createContext<StrategyDrawerContextType | null>(null)

export function StrategyDrawerProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])
  const toggle = useCallback(() => setIsOpen((v) => !v), [])
  return <StrategyDrawerContext.Provider value={{ isOpen, open, close, toggle }}>{children}</StrategyDrawerContext.Provider>
}

export function useStrategyDrawer() {
  const ctx = useContext(StrategyDrawerContext)
  if (!ctx) throw new Error('useStrategyDrawer must be used within StrategyDrawerProvider')
  return ctx
}
