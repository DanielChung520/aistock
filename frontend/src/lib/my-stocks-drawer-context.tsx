'use client'

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

interface MyStocksDrawerContextType {
  isOpen: boolean
  open: () => void
  close: () => void
  toggle: () => void
}

const MyStocksDrawerContext = createContext<MyStocksDrawerContextType | null>(null)

export function MyStocksDrawerProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])
  const toggle = useCallback(() => setIsOpen((v) => !v), [])
  return <MyStocksDrawerContext.Provider value={{ isOpen, open, close, toggle }}>{children}</MyStocksDrawerContext.Provider>
}

export function useMyStocksDrawer() {
  const ctx = useContext(MyStocksDrawerContext)
  if (!ctx) throw new Error('useMyStocksDrawer must be used within MyStocksDrawerProvider')
  return ctx
}
