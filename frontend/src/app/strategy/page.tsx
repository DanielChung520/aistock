'use client'

import { AppShell } from '@/components/app-shell'
import { StrategyWorkspace } from '@/components/strategy-workspace'

export default function StrategyPage() {
  return (
    <AppShell title="選股策略">
      <StrategyWorkspace />
    </AppShell>
  )
}
