'use client'

import { useEffect } from 'react'
import { useActions } from '../lib/actions'
import type { HeaderConfig, ThemeConfig } from '../types'
import * as Icons from 'lucide-react'

export interface HeaderProps {
  config: HeaderConfig
  theme: ThemeConfig
  tabs: React.ReactNode
}

export function Header({ config, theme, tabs }: HeaderProps) {
  const { registerHeaderRight, trigger } = useActions()

  useEffect(() => {
    registerHeaderRight(config.right.items)
  }, [config.right.items, registerHeaderRight])

  return (
    <header className={theme.classes.header}>
      <div className="flex items-center gap-3 shrink-0">
        {config.logoImage ? (
          <img
            src={config.logoImage}
            alt={config.logo}
            style={{ height: config.logoHeight ?? '2rem' }}
            className="object-contain"
          />
        ) : (
          <span className="font-semibold text-sm">{config.logo}</span>
        )}
      </div>

      <div className="flex-1 min-w-0 mx-4">
        {config.left.type === 'tabs' ? tabs : null}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {config.right.items.map((item) => {
          const Icon = resolveIcon(item.icon)
          return (
            <button
              key={item.id}
              onClick={() => trigger(item)}
              title={item.tooltip ?? item.label}
              className={theme.classes.sidebarButton}
            >
              <Icon className="w-4 h-4" />
            </button>
          )
        })}
      </div>
    </header>
  )
}

function resolveIcon(name: string) {
  const lib = Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>
  return lib[name] ?? Icons.Circle
}
