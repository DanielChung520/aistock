'use client'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { WatchlistManager } from '@/components/watchlist-manager'
import { useWatchlistModal } from '@/lib/watchlist-modal-context'

export function WatchlistModal() {
  const { isOpen, close } = useWatchlistModal()

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent className="w-[95vw] max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>自選股管理</DialogTitle>
        </DialogHeader>
        <WatchlistManager compact />
      </DialogContent>
    </Dialog>
  )
}
