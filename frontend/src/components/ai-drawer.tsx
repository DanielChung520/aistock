'use client'

import { useEffect } from 'react'
import { X, Sparkles, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAIDrawer } from '@/lib/ai-drawer-context'
import { cn } from '@/lib/utils'

export function AIDrawer() {
  const { isOpen, close } = useAIDrawer()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    if (isOpen) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, close])

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-[99] bg-black/30 animate-in fade-in-0"
          onClick={close}
        />
      )}
      <aside
        className={cn(
          'fixed top-10 right-0 bottom-0 z-[100] w-[420px] bg-background border-l border-border shadow-2xl flex flex-col transition-transform duration-300 ease-out',
          isOpen ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <header className="h-[60px] shrink-0 border-b border-border flex items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-md bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <div>
              <div className="text-sm font-semibold">AI 助手</div>
              <div className="text-[10px] text-muted-foreground">Powered by aiStock</div>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={close} title="關閉 (ESC)">
            <X className="h-4 w-4" />
          </Button>
        </header>
        <div className="flex-1 overflow-y-auto p-4">
          <div className="text-sm text-muted-foreground text-center py-12">
            <Sparkles className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
            <div className="font-medium text-foreground mb-1">開始對話</div>
            <div className="text-xs">詢問股票、技術指標、市場分析</div>
          </div>
        </div>
        <footer className="border-t border-border p-3 shrink-0">
          <div className="flex items-end gap-2">
            <textarea
              placeholder="輸入訊息..."
              rows={2}
              className="flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <Button size="icon" className="h-9 w-9 shrink-0" title="送出">
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </footer>
      </aside>
    </>
  )
}
