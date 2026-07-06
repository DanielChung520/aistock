'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AppShell } from '@/components/app-shell'
import { StockDetailPanel } from '@/components/stocks/StockDetailPanel'

function StockDetailContent() {
  const searchParams = useSearchParams()
  const symbol = searchParams.get('symbol') ?? ''
  const [stockName, setStockName] = useState('')

  const headerTitle = stockName ? `${stockName}-${symbol}` : symbol

  return (
    <AppShell title={headerTitle}>
      <div className="p-4 md:p-6 max-w-[100vw] overflow-x-hidden">
        <StockDetailPanel
          symbol={symbol}
          onNameResolved={setStockName}
          showHeader={false}
        />
      </div>
    </AppShell>
  )
}

export default function StockDetailPage() {
  return (
    <Suspense fallback={null}>
      <StockDetailContent />
    </Suspense>
  )
}
