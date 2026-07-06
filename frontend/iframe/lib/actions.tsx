'use client'

import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react'
import { useTabs } from './tabs'
import type { SidebarItem, HeaderRightItem, TabItem, ActionBehavior, ModalPayload } from '../types'

interface ActionsContextType {
  sidebar: SidebarItem[]
  headerRight: HeaderRightItem[]
  registerSidebar: (items: SidebarItem[]) => void
  registerHeaderRight: (items: HeaderRightItem[]) => void

  activeModal: ModalPayload | null
  activeLeftDrawer: SidebarItem | null
  activeRightDrawer: SidebarItem | null

  trigger: (item: SidebarItem | HeaderRightItem | { id: string }) => void
  closeModal: () => void
  closeLeftDrawer: () => void
  closeRightDrawer: () => void
}

const ActionsContext = createContext<ActionsContextType | null>(null)

export function ActionsProvider({ children }: { children: ReactNode }) {
  const tabs = useTabs()
  const [sidebar, setSidebar] = useState<SidebarItem[]>([])
  const [headerRight, setHeaderRight] = useState<HeaderRightItem[]>([])
  const [activeModal, setActiveModal] = useState<ModalPayload | null>(null)
  const [activeLeftDrawer, setActiveLeftDrawer] = useState<SidebarItem | null>(null)
  const [activeRightDrawer, setActiveRightDrawer] = useState<SidebarItem | null>(null)

  const registerSidebar = useCallback((items: SidebarItem[]) => {
    setSidebar(items)
  }, [])

  const registerHeaderRight = useCallback((items: HeaderRightItem[]) => {
    setHeaderRight(items)
  }, [])

  const trigger = useCallback(
    (input: SidebarItem | HeaderRightItem | { id: string }) => {
      const all = [...sidebar, ...headerRight]
      const item = 'route' in input
        ? input
        : all.find((s) => s.id === input.id)
      if (!item) return

      const behavior: ActionBehavior = item.behavior

      switch (behavior) {
        case 'switch':
        case 'newTab': {
          const route = 'route' in item && item.route ? item.route : item.id
          const tab: Omit<TabItem, 'id'> & { id?: string } = {
            id: item.id,
            title: item.title,
            route,
            icon: item.icon,
            meta: item.meta,
          }
          tabs.openTab(tab, behavior)
          break
        }
        case 'modal': {
          setActiveModal({
            id: item.id,
            title: item.title,
            component: item.id,
            props: item.meta,
          })
          break
        }
        case 'drawer-left': {
          setActiveLeftDrawer(item as SidebarItem)
          break
        }
        case 'drawer-right': {
          setActiveRightDrawer(item as SidebarItem)
          break
        }
      }
    },
    [sidebar, headerRight, tabs],
  )

  const closeModal = useCallback(() => setActiveModal(null), [])
  const closeLeftDrawer = useCallback(() => setActiveLeftDrawer(null), [])
  const closeRightDrawer = useCallback(() => setActiveRightDrawer(null), [])

  const value = useMemo(
    () => ({
      sidebar,
      headerRight,
      registerSidebar,
      registerHeaderRight,
      activeModal,
      activeLeftDrawer,
      activeRightDrawer,
      trigger,
      closeModal,
      closeLeftDrawer,
      closeRightDrawer,
    }),
    [
      sidebar,
      headerRight,
      registerSidebar,
      registerHeaderRight,
      activeModal,
      activeLeftDrawer,
      activeRightDrawer,
      trigger,
      closeModal,
      closeLeftDrawer,
      closeRightDrawer,
    ],
  )

  return <ActionsContext.Provider value={value}>{children}</ActionsContext.Provider>
}

export function useActions(): ActionsContextType {
  const ctx = useContext(ActionsContext)
  if (!ctx) throw new Error('useActions must be used within ActionsProvider')
  return ctx
}
