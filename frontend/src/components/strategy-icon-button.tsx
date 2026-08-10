'use client'

import { TrendingUp } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import { useStrategyDrawer } from '@/lib/strategy-drawer-context'
import { cn } from '@/lib/utils'

export function StrategyIconButton({ className }: { className?: string }) {
  const { open } = useStrategyDrawer()
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={open}
            className={cn(
              'h-[45px] w-[45px] rounded-lg flex items-center justify-center transition-all',
              'bg-blue-500/90 text-white shadow-sm',
              'hover:bg-blue-500 hover:shadow-md hover:scale-105 active:scale-95',
              className,
            )}
            title="策略選股"
          >
            <TrendingUp className="h-[25px] w-[25px]" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">策略選股</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
