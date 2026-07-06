'use client'

import { X, Home } from 'lucide-react'
import { useTabs } from '../lib/tabs'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import type { ThemeConfig } from '../types'

export interface PageTabsBarProps {
  theme: ThemeConfig
  className?: string
}

export function PageTabsBar({ theme, className }: PageTabsBarProps) {
  const { tabs, activeTabId, setActiveTab, closeTab, homeTitle } = useTabs()

  return (
    <div className={[theme.classes.tabBar, className].filter(Boolean).join(' ')}>
      <button
        onClick={() => setActiveTab(null)}
        className={activeTabId === null ? theme.classes.tabHomeActive : theme.classes.tabHome}
        title="首頁"
      >
        <Home className="h-3.5 w-3.5" />
        <span>{homeTitle}</span>
      </button>

      {tabs.length > 0 && (
        <>
          <div className="h-5 w-px bg-border mx-0.5" />
          <ScrollArea className="flex-1 whitespace-nowrap">
            <div className="flex gap-1">
              {tabs.map((tab) => {
                const isActive = activeTabId === tab.id
                return (
                  <div
                    key={tab.id}
                    className={isActive ? theme.classes.tabActive : theme.classes.tab}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    <span className="font-mono">{tab.id}</span>
                    <span className="truncate max-w-[80px]">{tab.title}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        closeTab(tab.id)
                      }}
                      className={theme.classes.tabClose}
                      title="關閉分頁"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )
              })}
            </div>
            <ScrollBar orientation="horizontal" className="h-1" />
          </ScrollArea>
        </>
      )}
    </div>
  )
}
