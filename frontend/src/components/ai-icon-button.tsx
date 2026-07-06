'use client'

import { Sparkles } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import { useAIDrawer } from '@/lib/ai-drawer-context'
import { cn } from '@/lib/utils'

export function AIIconButton({ className }: { className?: string }) {
  const { open } = useAIDrawer()

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={open}
            className={cn(
              'h-[45px] w-[45px] rounded-lg flex items-center justify-center transition-all',
              'bg-gradient-to-br from-purple-500 to-blue-500 text-white shadow-sm',
              'hover:from-purple-600 hover:to-blue-600 hover:shadow-md hover:scale-105 active:scale-95',
              className,
            )}
            title="AI 助手"
          >
            <Sparkles className="h-[25px] w-[25px]" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">AI 助手</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
