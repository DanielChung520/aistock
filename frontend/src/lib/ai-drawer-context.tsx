'use client'

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

interface AIDrawerContextType {
  isOpen: boolean
  open: () => void
  close: () => void
  toggle: () => void
}

const AIDrawerContext = createContext<AIDrawerContextType | null>(null)

export function AIDrawerProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])
  const toggle = useCallback(() => setIsOpen((v) => !v), [])
  return <AIDrawerContext.Provider value={{ isOpen, open, close, toggle }}>{children}</AIDrawerContext.Provider>
}

export function useAIDrawer() {
  const ctx = useContext(AIDrawerContext)
  if (!ctx) throw new Error('useAIDrawer must be used within AIDrawerProvider')
  return ctx
}
