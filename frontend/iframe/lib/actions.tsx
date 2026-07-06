'use client'

import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react'
import { useTabs, type TabItem } from './tabs'

export type ActionBehavior = 'switch' | 'newTab' | 'modal' | 'drawer-left' | 'drawer-right'

export interface SidebarItem {
  id: string
  title: string
  icon: string
  route: string
  behavior?: ActionBehavior
  tooltip?: string
  meta?: Record<string, unknown>
}

export interface ModalPayload {
  id: string
  title: string
  component: string
  props?: Record<string, unknown>
}

interface ActionsContextType {
  sidebar: SidebarItem[]
  registerSidebar: (items: SidebarItem[]) => void

  activeModal: ModalPayload | null
  activeLeftDrawer: SidebarItem | null
  activeRightDrawer: SidebarItem | null

  trigger: (item: SidebarItem | { id: string }) => void
  closeModal: () => void
  closeLeftDrawer: () => void
  closeRightDrawer: () => void
}

const ActionsContext = createContext<ActionsContextType | null>(null)

export function ActionsProvider({ children }: { children: ReactNode }) {
  const tabs = useTabs()
  const [sidebar, setSidebar] = useState<SidebarItem[]>([])
  const [activeModal, setActiveModal] = useState<ModalPayload | null>(null)
  const [activeLeftDrawer, setActiveLeftDrawer] = useState<SidebarItem | null>(null)
  const [activeRightDrawer, setActiveRightDrawer] = useState<SidebarItem | null>(null)

  const registerSidebar = useCallback((items: SidebarItem[]) => {
    setSidebar(items)
  }, [])

  const trigger = useCallback(
    (input: SidebarItem | { id: string }) => {
      const item = 'route' in input
        ? input
        : sidebar.find((s) => s.id === input.id)
      if (!item) return

      const behavior: ActionBehavior = item.behavior ?? 'newTab'

      switch (behavior) {
        case 'switch':
        case 'newTab': {
          const tab: Omit<TabItem, 'id'> & { id?: string } = {
            id: item.id,
            title: item.title,
            route: item.route,
            icon: item.icon,
            meta: item.meta,
          }
          tabs.openTab(tab, behavior === 'switch' ? 'switch' : 'newTab')
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
          setActiveLeftDrawer(item)
          break
        }
        case 'drawer-right': {
          setActiveRightDrawer(item)
          break
        }
      }
    },
    [sidebar, tabs],
  )

  const closeModal = useCallback(() => setActiveModal(null), [])
  const closeLeftDrawer = useCallback(() => setActiveLeftDrawer(null), [])
  const closeRightDrawer = useCallback(() => setActiveRightDrawer(null), [])

  const value = useMemo(
    () => ({
      sidebar,
      registerSidebar,
      activeModal,
      activeLeftDrawer,
      activeRightDrawer,
      trigger,
      closeModal,
      closeLeftDrawer,
      closeRightDrawer,
    }),
    [sidebar, registerSidebar, activeModal, activeLeftDrawer, activeRightDrawer, trigger, closeModal, closeLeftDrawer, closeRightDrawer],
  )

  return <ActionsContext.Provider value={value}>{children}</ActionsContext.Provider>
}

export function useActions(): ActionsContextType {
  const ctx = useContext(ActionsContext)
  if (!ctx) throw new Error('useActions must be used within ActionsProvider')
  return ctx
}
