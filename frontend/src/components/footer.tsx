'use client'

import { cn } from '@/lib/utils'
import { Wifi, WifiOff, Activity } from 'lucide-react'

interface FooterStatus {
  apiConnected: boolean
  wsConnected: boolean
  lastUpdate?: string
}

interface FooterProps {
  status?: FooterStatus
  left?: React.ReactNode
  className?: string
}

export function Footer({ status, left, className }: FooterProps) {
  const apiOk = status?.apiConnected ?? true
  const wsOk = status?.wsConnected ?? false
  const lastUpdate = status?.lastUpdate
    ? new Date(status.lastUpdate).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '--:--:--'

  return (
    <footer className={cn('h-[50px] shrink-0 border-t border-border bg-card/40 backdrop-blur-sm flex items-center justify-between px-3 text-xs text-muted-foreground', className)}>
      <div className="flex items-center gap-2 min-w-0 overflow-x-auto">{left}</div>
      <div className="flex items-center gap-3 shrink-0">
        <div className="flex items-center gap-1.5" title="FastAPI 後端連線">
          <Activity className="h-3.5 w-3.5" />
          <span className={cn(apiOk ? 'text-green-500' : 'text-red-500')}>API</span>
        </div>
        <div className="flex items-center gap-1.5" title="即時行情 WebSocket">
          {wsOk ? <Wifi className="h-3.5 w-3.5 text-green-500" /> : <WifiOff className="h-3.5 w-3.5 text-gray-500" />}
          <span className={cn(wsOk ? 'text-green-500' : 'text-gray-500')}>WS</span>
        </div>
        <div title="最後更新時間">更新 {lastUpdate}</div>
        <div className="hidden md:block text-muted-foreground/70">v2.0</div>
      </div>
    </footer>
  )
}
