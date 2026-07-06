'use client'

import { useEffect } from 'react'
import { useActions } from '../lib/actions'
import type { SidebarItem, ThemeConfig } from '../types'
import * as Icons from 'lucide-react'

export interface SidebarProps {
  items: SidebarItem[]
  theme: ThemeConfig
  className?: string
}

export function Sidebar({ items, theme, className }: SidebarProps) {
  const { registerSidebar, trigger } = useActions()

  useEffect(() => {
    registerSidebar(items)
  }, [items, registerSidebar])

  return (
    <aside className={[theme.classes.sidebarL, className].filter(Boolean).join(' ')}>
      {items.map((item) => {
        const Icon = resolveIcon(item.icon)
        return (
          <button
            key={item.id}
            onClick={() => trigger(item)}
            title={item.tooltip ?? item.title}
            className={theme.classes.sidebarButton}
          >
            <Icon className="w-5 h-5" />
          </button>
        )
      })}
    </aside>
  )
}

function resolveIcon(name: string) {
  const lib = Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>
  return lib[name] ?? Icons.Circle
}
