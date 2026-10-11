'use client'

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'
import { FUNCTION_PAGES, HOME_ROUTE } from '@/lib/page-tabs'

const STORAGE_KEY = 'aistock-pinned-pages'
const STORAGE_VERSION = 1

interface PageTabContextType {
  pinnedRoutes: string[]
  pinPage: (route: string) => void
  unpinPage: (route: string) => void
}

interface StoredPinnedPages {
  version: number
  routes: string[]
}

const DEFAULT_PINNED = FUNCTION_PAGES.map((p) => p.route)

function loadPinnedRoutes(): string[] {
  if (typeof window === 'undefined') return DEFAULT_PINNED
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_PINNED
    const parsed = JSON.parse(raw) as StoredPinnedPages
    if (parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.routes)) return DEFAULT_PINNED
    const valid = parsed.routes.filter((r) => FUNCTION_PAGES.some((p) => p.route === r))
    const withHome = valid.includes(HOME_ROUTE) ? valid : [HOME_ROUTE, ...valid]
    return withHome.length > 0 ? withHome : DEFAULT_PINNED
  } catch {
    return DEFAULT_PINNED
  }
}

const PageTabContext = createContext<PageTabContextType | null>(null)

export function PageTabProvider({ children }: { children: ReactNode }) {
  const [pinnedRoutes, setPinnedRoutes] = useState<string[]>(DEFAULT_PINNED)

  useEffect(() => {
    setPinnedRoutes(loadPinnedRoutes())
  }, [])

  useEffect(() => {
    if (pinnedRoutes.length === 0) return
    const stored: StoredPinnedPages = { version: STORAGE_VERSION, routes: pinnedRoutes }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
  }, [pinnedRoutes])

  const pinPage = useCallback((route: string) => {
    setPinnedRoutes((prev) => (prev.includes(route) ? prev : [...prev, route]))
  }, [])

  const unpinPage = useCallback((route: string) => {
    if (route === HOME_ROUTE) return
    setPinnedRoutes((prev) => prev.filter((r) => r !== route))
  }, [])

  return (
    <PageTabContext.Provider value={{ pinnedRoutes, pinPage, unpinPage }}>
      {children}
    </PageTabContext.Provider>
  )
}

export function usePageTabs(): PageTabContextType {
  const ctx = useContext(PageTabContext)
  if (!ctx) throw new Error('usePageTabs must be used within PageTabProvider')
  return ctx
}
