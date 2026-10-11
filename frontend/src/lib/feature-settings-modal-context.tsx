'use client'

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

interface FeatureSettingsModalContextType {
  isOpen: boolean
  open: () => void
  close: () => void
}

const FeatureSettingsModalContext = createContext<FeatureSettingsModalContextType | null>(null)

export function FeatureSettingsModalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])

  return (
    <FeatureSettingsModalContext.Provider value={{ isOpen, open, close }}>
      {children}
    </FeatureSettingsModalContext.Provider>
  )
}

export function useFeatureSettingsModal(): FeatureSettingsModalContextType {
  const ctx = useContext(FeatureSettingsModalContext)
  if (!ctx) throw new Error('useFeatureSettingsModal must be used within FeatureSettingsModalProvider')
  return ctx
}
