'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Home, LayoutGrid, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { getIconComponent } from '@/lib/icon-map'
import type { MenuItemWithChildren } from '@/types/menu'

type MenuData = {
  menu: Array<{ key: string; title: string; items: MenuItemWithChildren[] }>
}

export function SidebarNav({ className, onNavClick }: { className?: string; onNavClick?: () => void }) {
  const pathname = usePathname()
  const router = useRouter()
  const [menu, setMenu] = useState<MenuData | null>(null)
  const [menuPopoverOpen, setMenuPopoverOpen] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/menu')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setMenu(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const goHome = () => {
    router.push('/')
    onNavClick?.()
  }

  const openMenuItem = (href: string) => {
    router.push(href)
    setMenuPopoverOpen(false)
    onNavClick?.()
  }

  return (
    <aside className={cn('w-[60px] shrink-0 h-full flex flex-col items-center py-2 gap-1 bg-card/40 backdrop-blur-sm border-r border-border', className)}>
      <TooltipProvider delayDuration={300}>
        {/* Top: Home */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={goHome}
              className={cn(
                'h-10 w-10 rounded-md flex items-center justify-center transition-colors',
                pathname === '/' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Home className="h-5 w-5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">首頁-儀表板</TooltipContent>
        </Tooltip>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Bottom: Grid menu popover */}
        <Popover open={menuPopoverOpen} onOpenChange={setMenuPopoverOpen}>
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
                </div>
              </div>
            ))}
          </PopoverContent>
        </Popover>
      </TooltipProvider>
    </aside>
  )
}
