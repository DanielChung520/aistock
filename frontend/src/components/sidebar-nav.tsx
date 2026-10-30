'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { LayoutGrid, Loader2, RefreshCw, Send } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { getIconComponent } from '@/lib/icon-map'
import { useStockTabs } from '@/lib/stock-tab-context'
import { useUpdateStore, getCurrentVersion, getSkippedVersion } from '@/lib/updater'
import { toast } from 'sonner'
import { FUNCTION_PAGES } from '@/lib/page-tabs'
import type { MenuItemWithChildren } from '@/types/menu'

type MenuData = {
  menu: Array<{ key: string; title: string; items: MenuItemWithChildren[] }>
}

export function SidebarNav({ className, onNavClick }: { className?: string; onNavClick?: () => void }) {
  const pathname = usePathname()
  const router = useRouter()
  const { setActiveTab } = useStockTabs()
  const [menu, setMenu] = useState<MenuData | null>(null)
  const [menuPopoverOpen, setMenuPopoverOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const hasUpdate = useUpdateStore((s) => s.state.phase === 'available')
  const newVersion = useUpdateStore((s) => (s.state.phase === 'available' ? s.state.version : null))

  useEffect(() => {
    fetch('/api/menu')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setMenu(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const goPage = (route: string) => {
    setActiveTab(null)
    router.push(route)
    onNavClick?.()
  }

  const openMenuItem = (href: string) => {
    setActiveTab(null)
    if (/^https?:\/\//i.test(href)) {
      window.open(href, '_blank', 'noopener,noreferrer')
    } else {
      router.push(href)
    }
    setMenuPopoverOpen(false)
    onNavClick?.()
  }

  const handleMenuOpen = (open: boolean) => {
    setMenuPopoverOpen(open)
    if (open) void useUpdateStore.getState().check()
  }

  const handleVersionCheck = async () => {
    await useUpdateStore.getState().check()
    const st = useUpdateStore.getState().state
    if (st.phase === 'available') {
      return
    }
    if (st.phase === 'not-available') {
      const skipped = getSkippedVersion()
      if (skipped) toast.info(`已略過 v${skipped}（有更新版本時會再通知）`)
      else toast.info(`目前已是最新版本 v${getCurrentVersion()}`)
    } else if (st.phase === 'error') {
      toast.error(st.message)
    }
  }

  return (
    <aside className={cn('w-[60px] shrink-0 h-full flex flex-col items-center py-2 gap-1 bg-card/40 backdrop-blur-sm border-r border-border', className)}>
      <TooltipProvider delayDuration={300}>
        {FUNCTION_PAGES.map((page) => {
          const Icon = page.icon
          const isActive =
            page.route === '/' ? pathname === '/' : pathname === page.route
          return (
            <Tooltip key={page.route}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => goPage(page.route)}
                  className={cn(
                    'h-10 w-10 rounded-md flex items-center justify-center transition-colors',
                    isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <Icon className="h-5 w-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{page.title}</TooltipContent>
            </Tooltip>
          )
        })}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Bottom: Grid menu popover */}
        <Popover open={menuPopoverOpen} onOpenChange={handleMenuOpen}>
          <PopoverTrigger asChild>
            <button
              className="h-10 w-10 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title="功能表"
            >
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <LayoutGrid className="h-5 w-5" />}
            </button>
          </PopoverTrigger>
          <PopoverContent side="right" align="end" className="w-64 p-2">
            <div className="text-xs font-semibold text-muted-foreground px-2 py-1.5">功能表</div>
            {menu?.menu.map((group) => (
              <div key={group.key} className="mb-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 px-2 py-1">{group.title}</div>
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const Icon = getIconComponent(item.icon)
                    const isActive = pathname === item.href
                    return (
                      <button
                        key={item._key}
                        onClick={() => openMenuItem(item.href)}
                        className={cn(
                          'flex items-center gap-2 w-full px-2 py-1.5 rounded text-sm transition-colors text-left',
                          isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-foreground',
                        )}
                      >
                        {Icon ? <Icon className="h-4 w-4 shrink-0" /> : null}
                        <span className="truncate">{item.title}</span>
                      </button>
                    )
                  })}
                  {group.key === 'system-admin' && (
                    <button
                      type="button"
                      onClick={handleVersionCheck}
                      title={hasUpdate ? `有新版本 v${newVersion}` : '檢查是否有新版本'}
                      className="relative flex items-center gap-2 w-full px-2 py-1.5 rounded text-sm transition-colors text-left hover:bg-muted text-foreground"
                    >
                      <RefreshCw className="h-4 w-4 shrink-0" />
                      <span className="truncate">版本檢查</span>
                      {hasUpdate && (
                        <span className="absolute -top-1 -right-1 rounded-full bg-red-500 px-1.5 py-0.5 text-[9px] font-bold leading-none text-white shadow-sm">
                          新
                        </span>
                      )}
                    </button>
                  )}
                </div>
              </div>
            ))}

            <div className="mt-2 border-t border-border pt-2">
              <button
                type="button"
                onClick={() => openMenuItem('/settings/recipients')}
                className="flex items-center gap-2 w-full px-2 py-1.5 rounded text-sm transition-colors text-left hover:bg-muted text-foreground"
              >
                <Send className="h-4 w-4 shrink-0" />
                <span className="truncate">收件管理</span>
              </button>
            </div>
          </PopoverContent>
        </Popover>
      </TooltipProvider>
    </aside>
  )
}
