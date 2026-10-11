'use client'

import { useEffect, useRef, useState } from 'react'
import { X, Sparkles, GripHorizontal, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAIDrawer } from '@/lib/ai-drawer-context'
import { cn } from '@/lib/utils'
import { getOwUrl } from '@/lib/ow-url'

const DEFAULT_W = 640
const DEFAULT_H_VH = 0.8 // 80% of viewport
const STORAGE_KEY = 'ai-chat-modal-position'

function getDefaultHeight() {
  if (typeof window === 'undefined') return 600
  return Math.round(window.innerHeight * DEFAULT_H_VH)
}

function getDefaultPosition() {
  // Center-right of viewport, accounting for sidebar (60px) and tabs (40px)
  const h = getDefaultHeight()
  const x = typeof window !== 'undefined' ? Math.max(0, window.innerWidth - DEFAULT_W - 100) : 200
  const y = typeof window !== 'undefined' ? Math.max(40, (window.innerHeight - h) / 2) : 100
  return { x, y }
}

function loadStoredPosition(): { x: number; y: number } | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw)
    if (typeof p.x === 'number' && typeof p.y === 'number') return p
  } catch {}
  return null
}

function savePosition(p: { x: number; y: number }) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
  } catch {}
}

function clampPosition(x: number, y: number) {
  const h = getDefaultHeight()
  const maxX = typeof window !== 'undefined' ? Math.max(0, window.innerWidth - DEFAULT_W - 20) : 1000
  const maxY = typeof window !== 'undefined' ? Math.max(40, window.innerHeight - h - 20) : 1000
  return {
    x: Math.max(0, Math.min(x, maxX)),
    y: Math.max(40, Math.min(y, maxY)),
  }
}

export function AIChatModal() {
  const { isOpen, mode, close } = useAIDrawer()
  const visible = isOpen && mode === 'modal'
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 200, y: 100 })
  const [isDragging, setIsDragging] = useState(false)
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)
  const modalRef = useRef<HTMLDivElement>(null)

  // Load saved position on mount
  useEffect(() => {
    const saved = loadStoredPosition()
    if (saved) {
      setPosition(clampPosition(saved.x, saved.y))
    } else {
      setPosition(getDefaultPosition())
    }
  }, [])

  // Clamp position when window resizes
  useEffect(() => {
    function onResize() {
      setPosition((p) => clampPosition(p.x, p.y))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // ESC to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    if (visible) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, close])

  // Drag handlers using pointer events
  useEffect(() => {
    if (!isDragging) return
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current) return
      const dx = e.clientX - dragRef.current.startX
      const dy = e.clientY - dragRef.current.startY
      const next = clampPosition(
        dragRef.current.originX + dx,
        dragRef.current.originY + dy,
      )
      setPosition(next)
    }
    const onUp = () => {
      setIsDragging(false)
      dragRef.current = null
      // Save final position
      setPosition((p) => {
        savePosition(p)
        return p
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [isDragging])

  if (!visible) return null

  const onPointerDown = (e: React.PointerEvent) => {
    // Ignore drag if clicking on a button (X)
    if ((e.target as HTMLElement).closest('button')) return
    setIsDragging(true)
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: position.x,
      originY: position.y,
    }
    // Capture pointer for smooth drag
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }

  return (
    <>
      {/* Backdrop - semi-transparent, click to close */}
      <div
        className="fixed inset-0 z-[60] bg-black/20 animate-in fade-in-0"
        onClick={close}
        style={{ pointerEvents: isDragging ? 'none' : 'auto' }}
      />
      {/* Modal */}
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label="AI 助手"
        className={cn(
          'fixed z-[70] bg-background border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in-0 zoom-in-95',
          isDragging ? 'cursor-grabbing select-none' : '',
        )}
        style={{
          left: `${position.x}px`,
          top: `${position.y}px`,
          width: `${DEFAULT_W}px`,
          height: `${typeof window !== 'undefined' ? window.innerHeight * DEFAULT_H_VH : 600}px`,
          maxHeight: 'calc(100vh - 80px)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag Handle / Header */}
        <header
          onPointerDown={onPointerDown}
          className={cn(
            'h-[60px] shrink-0 border-b border-border flex items-center justify-between px-4 bg-gradient-to-r from-purple-500/5 to-blue-500/5',
            isDragging ? 'cursor-grabbing select-none' : 'cursor-grab',
          )}
        >
          <div className="flex items-center gap-2 pointer-events-none">
            <div className="h-8 w-8 rounded-md bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <div>
              <div className="text-sm font-semibold">AI 助手</div>
              <div className="text-[10px] text-muted-foreground">Powered by opencode</div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <GripHorizontal className="h-4 w-4 text-muted-foreground/50" />
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

        {/* Body - opencode (ow) chat UI */}
        <iframe
          src={getOwUrl()}
          title="AI 助手"
          className="flex-1 w-full border-0 bg-background"
          allow="clipboard-write"
        />
      </div>
    </>
  )
}
