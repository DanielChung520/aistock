'use client'

import { useEffect } from 'react'
import { useActions } from '../lib/actions'
import type { SidebarItem, ThemeConfig } from '../types'
import { X } from 'lucide-react'

export interface DrawerProps {
  side: 'left' | 'right'
  items?: SidebarItem[]
  theme: ThemeConfig
  className?: string
  width?: string
}

export function Drawer({ side, items, theme, className, width = '18rem' }: DrawerProps) {
  const {
    activeLeftDrawer,
    activeRightDrawer,
    closeLeftDrawer,
    closeRightDrawer,
    registerSidebar,
  } = useActions()

  useEffect(() => {
    if (items && items.length > 0) {
      registerSidebar(items)
    }
  }, [items, registerSidebar])

  const active = side === 'left' ? activeLeftDrawer : activeRightDrawer
  const close = side === 'left' ? closeLeftDrawer : closeRightDrawer

  if (!active) return null

  return (
    <aside
      className={[theme.classes.sidebarR, className].filter(Boolean).join(' ')}
      style={{ width }}
    >
      <div className="flex items-center justify-between p-3 border-b border-border">
        <span className="font-medium text-sm">{active.title}</span>
        <button
          onClick={close}
          className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          title="關閉"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="p-3 text-sm text-muted-foreground">
        抽屜內容：{active.title} ({active.route})
      </div>
    </aside>
  )
}
