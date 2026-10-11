'use client'

import { AppShell } from '@/components/app-shell'
import { PatternSearchPanel } from '@/components/pattern-search-panel'

export default function PatternsPage() {
  return (
    <AppShell title="圖形搜索">
      <div className="p-4 md:p-6 max-w-[100vw] overflow-x-hidden h-full">
        <PatternSearchPanel />
      </div>
    </AppShell>
  )
}
