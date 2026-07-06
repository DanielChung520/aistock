'use client'

import { AppShell } from '@/components/app-shell'
import { WatchlistManager } from '@/components/watchlist-manager'

export default function WatchlistPage() {
  return (
    <AppShell>
      <WatchlistManager />
    </AppShell>
  )
}
