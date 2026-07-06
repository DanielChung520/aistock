'use client'

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

interface WatchlistModalContextType {
  isOpen: boolean
  open: () => void
  close: () => void
  toggle: () => void
}

const WatchlistModalContext = createContext<WatchlistModalContextType | null>(null)

export function WatchlistModalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)

  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])
  const toggle = useCallback(() => setIsOpen((v) => !v), [])

  return (
    <WatchlistModalContext.Provider value={{ isOpen, open, close, toggle }}>
      {children}
    </WatchlistModalContext.Provider>
  )
}

export function useWatchlistModal(): WatchlistModalContextType {
  const ctx = useContext(WatchlistModalContext)
  if (!ctx) throw new Error('useWatchlistModal must be used within WatchlistModalProvider')
  return ctx
}
