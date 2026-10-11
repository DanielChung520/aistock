'use client'

import { AppShell } from '@/components/app-shell'
import { WatchlistManager } from '@/components/watchlist-manager'

export default function WatchlistPage() {
  return (
    <AppShell title="自選股管理">
      <WatchlistManager />
    </AppShell>
  )
}
