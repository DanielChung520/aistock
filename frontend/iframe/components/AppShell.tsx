'use client'

import { TabsProvider } from '../lib/tabs'
import { ActionsProvider, type SidebarItem } from '../lib/actions'
import { Sidebar } from './Sidebar'
import { PageTabsBar } from './PageTabsBar'
import { cn } from '@/lib/utils'

export interface AppShellProps {
  children: React.ReactNode
  sidebarItems?: SidebarItem[]
  homeRoute?: string
  homeTitle?: string
  rightSidebar?: React.ReactNode
  footer?: React.ReactNode
  headerExtras?: React.ReactNode
}

export function AppShell({
  children,
  sidebarItems,
  homeRoute = '/',
  homeTitle = '首頁',
  rightSidebar,
  footer,
  headerExtras,
}: AppShellProps) {
  return (
    <TabsProvider homeRoute={homeRoute} homeTitle={homeTitle}>
      <ActionsProvider>
        <div className="h-screen w-screen flex flex-col bg-background text-foreground overflow-hidden">
          <header className="h-12 border-b border-border bg-card/40 backdrop-blur-sm flex items-center px-4 shrink-0">
            <div className="flex-1 min-w-0">{headerExtras ?? <PageTabsBar className="border-0 h-12 px-0 bg-transparent" />}</div>
          </header>

          <div className="flex-1 flex min-h-0">
            <Sidebar items={sidebarItems} />

            <main className="flex-1 min-w-0 overflow-auto">{children}</main>

            {rightSidebar && (
              <aside className="w-72 border-l border-border bg-card/30 shrink-0 overflow-auto">
                {rightSidebar}
              </aside>
            )}
          </div>

          {footer && (
            <footer className="h-8 border-t border-border bg-card/30 flex items-center px-4 text-xs text-muted-foreground shrink-0">
              {footer}
            </footer>
          )}
        </div>
      </ActionsProvider>
    </TabsProvider>
  )
}
