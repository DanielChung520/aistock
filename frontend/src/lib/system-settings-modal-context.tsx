'use client'

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

interface SystemSettingsModalContextType {
  isOpen: boolean
  open: () => void
  close: () => void
}

const SystemSettingsModalContext = createContext<SystemSettingsModalContextType | null>(null)

export function SystemSettingsModalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])

  return (
    <SystemSettingsModalContext.Provider value={{ isOpen, open, close }}>
      {children}
    </SystemSettingsModalContext.Provider>
  )
}

export function useSystemSettingsModal(): SystemSettingsModalContextType {
  const ctx = useContext(SystemSettingsModalContext)
  if (!ctx) throw new Error('useSystemSettingsModal must be used within SystemSettingsModalProvider')
  return ctx
}
