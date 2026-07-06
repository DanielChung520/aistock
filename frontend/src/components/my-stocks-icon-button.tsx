'use client'

import { Star } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import { useMyStocksDrawer } from '@/lib/my-stocks-drawer-context'
import { cn } from '@/lib/utils'

export function MyStocksIconButton({ className }: { className?: string }) {
  const { open } = useMyStocksDrawer()
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={open}
            className={cn(
              'h-[45px] w-[45px] rounded-lg flex items-center justify-center transition-all',
              'bg-amber-500/90 text-white shadow-sm',
              'hover:bg-amber-500 hover:shadow-md hover:scale-105 active:scale-95',
              className,
            )}
            title="我的股票"
          >
            <Star className="h-[25px] w-[25px]" fill="white" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">我的股票</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
