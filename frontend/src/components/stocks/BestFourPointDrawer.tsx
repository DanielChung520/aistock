'use client'

import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { BestFourPointCard } from '@/components/stocks/BestFourPointCard'
import type { BestFourPointCardProps } from '@/components/stocks/BestFourPointCard'

interface BestFourPointDrawerProps {
  isOpen: boolean
  onClose: () => void
  stockId: string
  bestFourPoint: BestFourPointCardProps['bestFourPoint']
  buyAnalysis: BestFourPointCardProps['buyAnalysis']
  sellAnalysis: BestFourPointCardProps['sellAnalysis']
}

export function BestFourPointDrawer({
  isOpen,
  onClose,
  stockId,
  bestFourPoint,
  buyAnalysis,
  sellAnalysis,
}: BestFourPointDrawerProps) {
  return (
    <>
      {isOpen && <div className="absolute inset-0 z-10 bg-black/30 pointer-events-none" />}
      <div
        className={cn(
          'absolute z-20 flex flex-col bg-background border-t border-border shadow-2xl rounded-t-lg transition-transform duration-300 ease-out',
          '-left-4 md:-left-6 -right-4 md:-right-6',
          'bottom-0',
          isOpen ? 'translate-y-0' : 'translate-y-full',
        )}
        style={{ maxHeight: '100%' }}
      >
        <div className="flex items-center justify-end pl-3 pr-[18px] py-1.5 shrink-0">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <BestFourPointCard
            stockId={stockId}
            bestFourPoint={bestFourPoint}
            buyAnalysis={buyAnalysis}
            sellAnalysis={sellAnalysis}
          />
        </div>
      </div>
    </>
  )
}
