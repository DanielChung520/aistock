'use client'

import { useEffect } from 'react'
import { X, Sparkles, ExternalLink, Maximize2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAIDrawer, AI_DRAWER_WIDTH } from '@/lib/ai-drawer-context'
import { cn } from '@/lib/utils'
import { getOwUrl } from '@/lib/ow-url'

export function AIDrawer() {
  const { isOpen, mode, open, close } = useAIDrawer()
  const visible = isOpen && mode === 'drawer'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    if (visible) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, close])

  return (
    <aside
      aria-label="AI 助手"
      style={{ width: AI_DRAWER_WIDTH }}
      className={cn(
        'fixed top-10 right-0 bottom-0 z-[100] bg-background border-l border-border shadow-2xl flex flex-col transition-transform duration-300 ease-out',
        visible ? 'translate-x-0' : 'translate-x-full',
      )}
    >
      <header className="h-[60px] shrink-0 border-b border-border flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-md bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <div>
            <div className="text-sm font-semibold">AI 助手</div>
            <div className="text-[10px] text-muted-foreground">Powered by opencode</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => open('modal')}
            title="展開為浮窗"
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => {
              window.open(
                '/ai-chat',
                'ai-chat-window',
                'width=900,height=700,left=200,top=100,resizable=yes,scrollbars=no',
              )
            }}
            title="在新視窗開啟"
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={close}
            title="關閉 (ESC)"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </header>
      {visible && (
        <iframe
          src={getOwUrl()}
          title="AI 助手"
          className="flex-1 w-full border-0 bg-background"
          allow="clipboard-write"
        />
      )}
    </aside>
  )
}
