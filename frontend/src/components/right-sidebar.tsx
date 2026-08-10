'use client'

import { cn } from '@/lib/utils'
import { AIIconButton } from '@/components/ai-icon-button'
import { MyStocksIconButton } from '@/components/my-stocks-icon-button'
import { StrategyIconButton } from '@/components/strategy-icon-button'
import { NotificationsIconButton } from '@/components/notifications-icon-button'

export function RightSidebar({ className }: { className?: string }) {
  return (
    <aside className={cn('w-[60px] shrink-0 h-full flex flex-col items-center py-2 gap-2 bg-card/40 backdrop-blur-sm border-l border-border', className)}>
      <MyStocksIconButton />
      <StrategyIconButton />
      <NotificationsIconButton />
      <div className="flex-1" />
      <AIIconButton />
    </aside>
  )
}
