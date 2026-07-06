'use client'

import { useEffect } from 'react'
import { useActions, type SidebarItem } from '../lib/actions'
import { cn } from '@/lib/utils'
import * as Icons from 'lucide-react'

export interface SidebarProps {
  items?: SidebarItem[]
  className?: string
}

export function Sidebar({ items, className }: SidebarProps) {
  const { sidebar, registerSidebar, trigger } = useActions()

  useEffect(() => {
    if (items && items.length > 0) {
      registerSidebar(items)
    }
  }, [items, registerSidebar])

  const display = items && items.length > 0 ? items : sidebar

  return (
    <aside
      className={cn(
        'w-14 border-r border-border bg-card/40 backdrop-blur-sm flex flex-col items-center py-2 gap-1 shrink-0',
        className,
      )}
    >
      {display.map((item) => {
        const Icon = resolveIcon(item.icon)
        return (
          <button
            key={item.id}
            onClick={() => trigger(item)}
            title={item.tooltip ?? item.title}
            className="w-10 h-10 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
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
