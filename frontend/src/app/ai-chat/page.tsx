'use client'

import { useEffect, useRef } from 'react'
import { X, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getOwUrl } from '@/lib/ow-url'

export default function StandaloneAIChat() {
  const frameRef = useRef<HTMLIFrameElement>(null)

  // SSR 與 client 的 hostname 可能不同（localhost vs 192.168.1.108），
  // render 期直接算 URL 會 hydration mismatch；改在 effect 裡對外部系統（DOM）賦值
  useEffect(() => {
    const frame = frameRef.current
    if (frame) frame.src = getOwUrl()
  }, [])

  return (
    <div className="h-screen flex flex-col bg-background">
      <header className="h-[60px] shrink-0 border-b border-border bg-gradient-to-r from-purple-500/5 to-blue-500/5 flex items-center justify-between px-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-md bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="text-base font-semibold">AI 助手</div>
            <div className="text-xs text-muted-foreground">獨立視窗模式 · Powered by opencode</div>
          </div>
        </div>
        <Button
          variant="ghost"
          className="h-9 w-9"
          onClick={() => window.close()}
          title="關閉視窗"
        >
          <X className="h-4 w-4" />
        </Button>
      </header>

      <main className="flex-1 min-h-0">
        <iframe
          ref={frameRef}
          title="AI 助手"
          className="h-full w-full border-0 bg-background"
          allow="clipboard-write"
        />
      </main>
    </div>
  )
}
