'use client'

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

interface NotificationsDrawerContextType {
  isOpen: boolean
  open: () => void
  close: () => void
  toggle: () => void
}

const NotificationsDrawerContext = createContext<NotificationsDrawerContextType | null>(null)

export function NotificationsDrawerProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])
  const toggle = useCallback(() => setIsOpen((v) => !v), [])
  return <NotificationsDrawerContext.Provider value={{ isOpen, open, close, toggle }}>{children}</NotificationsDrawerContext.Provider>
}

export function useNotificationsDrawer() {
  const ctx = useContext(NotificationsDrawerContext)
  if (!ctx) throw new Error('useNotificationsDrawer must be used within NotificationsDrawerProvider')
  return ctx
}
