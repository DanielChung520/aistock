'use client'

import { useEffect, useState } from 'react'
import { TabsProvider } from '../lib/tabs'
import { ActionsProvider } from '../lib/actions'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { Footer } from './Footer'
import { Modal } from './Modal'
import { Drawer } from './Drawer'
import { PageTabsBar } from './PageTabsBar'
import { loadSidebar, loadHeader, loadFooter, loadLayout, loadTheme } from '../lib/load-config'
import type {
  SidebarConfig,
  HeaderConfig,
  FooterConfig,
  LayoutConfig,
  ThemeConfig,
} from '../types'

export interface AppShellProps {
  basePath?: string
  children: React.ReactNode
  homeRoute?: string
  homeTitle?: string
}

export function AppShell({
  basePath = '/iframe',
  children,
  homeRoute = '/',
  homeTitle = '首頁',
}: AppShellProps) {
  const [layout, setLayout] = useState<LayoutConfig | null>(null)
  const [header, setHeader] = useState<HeaderConfig | null>(null)
  const [footer, setFooter] = useState<FooterConfig | null>(null)
  const [sidebar, setSidebar] = useState<SidebarConfig | null>(null)
  const [theme, setTheme] = useState<ThemeConfig | null>(null)

  useEffect(() => {
    void (async () => {
      const [l, h, f, s, t] = await Promise.all([
        loadLayout(),
        loadHeader(),
        loadFooter(),
        loadSidebar(),
        loadTheme(),
      ])
      setLayout(l)
      setHeader(h)
      setFooter(f)
      setSidebar(s)
      setTheme(t)
    })()
  }, [basePath])

  if (!layout || !header || !footer || !sidebar || !theme) {
    return (
      <div className="h-screen w-screen flex items-center justify-center text-muted-foreground">
        載入中…
      </div>
    )
  }

  return (
    <TabsProvider homeRoute={homeRoute} homeTitle={homeTitle}>
      <ActionsProvider>
        <div className={theme.classes.shell}>
          {layout.regions.header.visible && (
            <Header
              config={header}
              theme={theme}
              tabs={<PageTabsBar theme={theme} />}
            />
          )}

          <div className="flex-1 flex min-h-0">
            {layout.regions.sidebarL.visible && (
              <Sidebar items={sidebar.items} theme={theme} />
            )}

            <main className={theme.classes.main}>{children}</main>

            {layout.regions.sidebarR.visible && (
              <Drawer side="right" theme={theme} />
            )}
          </div>

          {layout.regions.footer.visible && (
            <Footer config={footer} theme={theme} />
          )}

          <Modal theme={theme} />
        </div>
      </ActionsProvider>
    </TabsProvider>
  )
}
