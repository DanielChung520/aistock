'use client'

import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useSystemSettings } from '@/hooks/use-system-settings'

interface PriceVolume {
  price: number
  volume: number
}

interface VolumeProfileData {
  date: string
  bucket_size: number
  price_volume: PriceVolume[]
  vpoc: number
  max_volume: number
  total_volume: number
}

interface VolumeProfileDrawerProps {
  isOpen: boolean
  onClose: () => void
  date: string
  symbol: string
  profileData: VolumeProfileData
}

export function VolumeProfileDrawer({
  isOpen,
  onClose,
  date,
  symbol,
  profileData,
}: VolumeProfileDrawerProps) {
  const { settings } = useSystemSettings()
  const profileOpacity = settings.volumeProfileOpacity

  const sortedPrices =
    profileData?.price_volume?.length > 0
      ? [...profileData.price_volume].sort((a, b) => b.price - a.price)
      : []

  return (
    <div
      className={cn(
        'fixed left-[60px] top-10 bottom-0 w-[528px] z-50 flex flex-col',
        'backdrop-blur-sm',
        'border-r border-border shadow-2xl',
        'transition-transform duration-300 ease-out',
        isOpen ? 'translate-x-0' : '-translate-x-full',
      )}
      style={{
        backgroundColor: `hsl(var(--background) / ${(profileOpacity || 30) / 100})`,
      }}
    >
      <div className="flex items-center justify-end px-2 py-1.5 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {sortedPrices.length > 0 ? (
        <div className="flex-1 flex flex-col justify-center overflow-y-auto px-3 pb-4">
          <div className="text-[11px] text-muted-foreground mb-2 mt-1 shrink-0">
            {date} &middot; {symbol}
          </div>
          <div className="shrink-0">
            {sortedPrices.map((pv) => {
              const isVpoc = pv.price === profileData.vpoc
              const barWidth = (pv.volume / profileData.max_volume) * 100
              return (
                <div key={pv.price} className="flex items-center gap-2 py-0.5">
                  <span
                    className={cn(
                      'w-14 text-right font-mono text-xs shrink-0',
                      isVpoc ? 'text-red-500 font-bold' : 'text-muted-foreground',
                    )}
                  >
                    {pv.price.toFixed(1)}
                  </span>
                  <div className="flex-1 h-3 rounded bg-muted overflow-hidden">
                    <div
                      className={cn(
                        'h-full rounded',
                        isVpoc ? 'bg-red-500' : 'bg-primary/40',
                      )}
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground px-3">
          無成交量資料
        </div>
      )}
    </div>
  )
}
