'use client'

import { useState, use } from 'react'
import { AppShell } from '@/components/app-shell'
import { StockDetailPanel } from '@/components/stocks/StockDetailPanel'

export default function StockDetailPage({
  params,
}: {
  params: Promise<{ symbol: string }>
}) {
  const { symbol } = use(params)
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
