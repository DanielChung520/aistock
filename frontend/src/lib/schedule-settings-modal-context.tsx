'use client'

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

interface ScheduleSettingsModalContextType {
  isOpen: boolean
  open: () => void
  close: () => void
}

const ScheduleSettingsModalContext = createContext<ScheduleSettingsModalContextType | null>(null)

export function ScheduleSettingsModalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])

  return (
    <ScheduleSettingsModalContext.Provider value={{ isOpen, open, close }}>
      {children}
    </ScheduleSettingsModalContext.Provider>
  )
}

export function useScheduleSettingsModal(): ScheduleSettingsModalContextType {
  const ctx = useContext(ScheduleSettingsModalContext)
  if (!ctx) throw new Error('useScheduleSettingsModal must be used within ScheduleSettingsModalProvider')
  return ctx
}
