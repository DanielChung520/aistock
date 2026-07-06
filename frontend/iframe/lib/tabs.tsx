'use client'

import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react'

export type TabBehavior = 'switch' | 'newTab'

export interface TabItem {
  id: string
  title: string
  subtitle?: string
  route: string
  icon?: string
  meta?: Record<string, unknown>
}

interface TabsContextType {
  tabs: TabItem[]
  activeTabId: string | null
  homeRoute: string
  homeTitle: string

  openTab: (item: Omit<TabItem, 'id'> & { id?: string }, behavior?: TabBehavior) => string
  closeTab: (id: string) => void
  setActiveTab: (id: string | null) => void
  switchTo: (route: string) => boolean
  getTab: (id: string) => TabItem | undefined
}

const TabsContext = createContext<TabsContextType | null>(null)

export interface TabsProviderProps {
  children: ReactNode
  homeRoute?: string
  homeTitle?: string
}

export function TabsProvider({ children, homeRoute = '/', homeTitle = '首頁' }: TabsProviderProps) {
  const [tabs, setTabs] = useState<TabItem[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)

  const openTab = useCallback(
    (item: Omit<TabItem, 'id'> & { id?: string }, behavior: TabBehavior = 'newTab') => {
      const id = item.id ?? item.route

      if (behavior === 'switch') {
        const existing = tabs.find((t) => t.id === id)
        if (existing) {
          setActiveTabId(id)
          return id
        }
        setTabs((prev) => [...prev, { ...item, id }])
        setActiveTabId(id)
        return id
      }

      const existing = tabs.find((t) => t.id === id)
      if (existing) {
        setActiveTabId(id)
        return id
      }
      setTabs((prev) => [...prev, { ...item, id }])
      setActiveTabId(id)
      return id
    },
    [tabs],
  )

  const closeTab = useCallback(
    (id: string) => {
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === id)
        if (idx < 0) return prev
        const next = prev.filter((t) => t.id !== id)
        if (next.length === 0) {
          setActiveTabId(null)
        } else if (activeTabId === id) {
          setActiveTabId(next[Math.min(idx, next.length - 1)].id)
        }
        return next
      })
    },
    [activeTabId],
  )

  const setActiveTab = useCallback((id: string | null) => {
    setActiveTabId(id)
  }, [])

  const switchTo = useCallback(
    (route: string) => {
      const found = tabs.find((t) => t.route === route)
      if (found) {
        setActiveTabId(found.id)
        return true
      }
      return false
    },
    [tabs],
  )

  const getTab = useCallback((id: string) => tabs.find((t) => t.id === id), [tabs])

  const value = useMemo(
    () => ({
      tabs,
      activeTabId,
      homeRoute,
      homeTitle,
      openTab,
      closeTab,
      setActiveTab,
      switchTo,
      getTab,
    }),
    [tabs, activeTabId, homeRoute, homeTitle, openTab, closeTab, setActiveTab, switchTo, getTab],
  )

  return <TabsContext.Provider value={value}>{children}</TabsContext.Provider>
}

export function useTabs(): TabsContextType {
  const ctx = useContext(TabsContext)
  if (!ctx) throw new Error('useTabs must be used within TabsProvider')
  return ctx
}
