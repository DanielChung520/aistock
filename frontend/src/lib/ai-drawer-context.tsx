'use client'

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

export type AIMode = 'drawer' | 'modal'

/** Width (px) of the docked AI drawer; AppShell reserves this much space when it is open. */
export const AI_DRAWER_WIDTH = 630

interface AIDrawerContextType {
  isOpen: boolean
  /** Active container (mutually exclusive): side drawer or draggable modal. */
  mode: AIMode
  open: (mode?: AIMode) => void
  close: () => void
  toggle: () => void
}

const AIDrawerContext = createContext<AIDrawerContextType | null>(null)

export function AIDrawerProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [mode, setMode] = useState<AIMode>('drawer')
  const open = useCallback((next?: AIMode) => {
    setMode(next ?? 'drawer')
    setIsOpen(true)
  }, [])
  const close = useCallback(() => setIsOpen(false), [])
  const toggle = useCallback(() => setIsOpen((v) => !v), [])
  return (
    <AIDrawerContext.Provider value={{ isOpen, mode, open, close, toggle }}>
      {children}
    </AIDrawerContext.Provider>
  )
}

export function useAIDrawer() {
  const ctx = useContext(AIDrawerContext)
  if (!ctx) throw new Error('useAIDrawer must be used within AIDrawerProvider')
  return ctx
}
