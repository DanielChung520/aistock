'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { X, Sparkles, Send, GripHorizontal, ExternalLink, LayoutGrid, Check, Cpu, Database, History, Sliders, Bot } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useAIDrawer } from '@/lib/ai-drawer-context'
import { cn } from '@/lib/utils'

const DEFAULT_W = 640
const DEFAULT_H_VH = 0.8  // 80% of viewport
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
  const { isOpen, close } = useAIDrawer()
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 200, y: 100 })
  const [isDragging, setIsDragging] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState('openai')
  const [selectedModel, setSelectedModel] = useState('gpt-4o')
  const [selectedSession, setSelectedSession] = useState('current')
  const [selectedAgent, setSelectedAgent] = useState('analyst')

  const agents = [
    { id: 'default', name: '預設助手', desc: '一般問答' },
    { id: 'analyst', name: '股票分析師', desc: '個股基本面 + 技術面' },
    { id: 'strategist', name: '交易策略師', desc: '進出場時機 + 風險控管' },
    { id: 'researcher', name: '資料研究員', desc: '市場資料彙整' },
  ]

  // Mock data
  const providers = [
    { id: 'openai', name: 'OpenAI', desc: 'GPT 系列' },
    { id: 'anthropic', name: 'Anthropic', desc: 'Claude 系列' },
    { id: 'gemini', name: 'Google', desc: 'Gemini 系列' },
    { id: 'local', name: 'Local LLM', desc: '本地模型' },
  ]
  const models = [
    { id: 'gpt-4o', name: 'GPT-4o', desc: '最新多模態' },
    { id: 'gpt-4o-mini', name: 'GPT-4o mini', desc: '快速便宜' },
    { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', desc: '最新對話' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', desc: '高效能' },
    { id: 'llama-3.3-70b', name: 'Llama 3.3 70B', desc: '開源大型' },
  ]
  const sessions = [
    { id: 'current', name: '目前對話', desc: '剛剛', active: true },
    { id: 's2', name: '台積電 Q2 法說分析', desc: '3 小時前' },
    { id: 's3', name: '聯發科 9400 規格', desc: '昨天' },
    { id: 'new', name: '+ 開新對話', desc: '' },
  ]
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
      if (e.key === 'Escape' && isOpen) close()
    }
    if (isOpen) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, close])

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

  if (!isOpen) return null

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
            isDragging ? 'cursor-grabbing' : 'cursor-grab',
          )}
        >
          <div className="flex items-center gap-2 pointer-events-none">
            <div className="h-8 w-8 rounded-md bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <div>
              <div className="text-sm font-semibold">AI 助手</div>
              <div className="text-[10px] text-muted-foreground">Powered by aiStock</div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <GripHorizontal className="h-4 w-4 text-muted-foreground/50" />
            <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title="設定選單"
                >
                  <LayoutGrid className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                side="bottom"
                align="end"
                sideOffset={8}
                className="w-[640px] p-0 z-[80]"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="grid grid-cols-4 divide-x divide-border">
                  {/* Provider */}
                  <div className="p-3">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground mb-2 px-1">
                      <Cpu className="h-3.5 w-3.5" />
                      Provider
                    </div>
                    <div className="space-y-0.5">
                      {providers.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => { setSelectedProvider(p.id); setSettingsOpen(false) }}
                          className={cn(
                            'w-full flex items-start gap-1.5 px-2 py-1.5 rounded text-left text-xs hover:bg-muted transition-colors',
                            selectedProvider === p.id && 'bg-muted',
                          )}
                        >
                          {selectedProvider === p.id && <Check className="h-3 w-3 mt-0.5 text-primary shrink-0" />}
                          <span className={cn('flex-1 min-w-0', selectedProvider !== p.id && 'ml-[15px]')}>
                            <div className="font-medium truncate">{p.name}</div>
                            <div className="text-[10px] text-muted-foreground truncate">{p.desc}</div>
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* Models */}
                  <div className="p-3">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground mb-2 px-1">
                      <Database className="h-3.5 w-3.5" />
                      Models
                    </div>
                    <div className="space-y-0.5">
                      {models.map((m) => (
                        <button
                          key={m.id}
                          onClick={() => { setSelectedModel(m.id); setSettingsOpen(false) }}
                          className={cn(
                            'w-full flex items-start gap-1.5 px-2 py-1.5 rounded text-left text-xs hover:bg-muted transition-colors',
                            selectedModel === m.id && 'bg-muted',
                          )}
                        >
                          {selectedModel === m.id && <Check className="h-3 w-3 mt-0.5 text-primary shrink-0" />}
                          <span className={cn('flex-1 min-w-0', selectedModel !== m.id && 'ml-[15px]')}>
                            <div className="font-medium truncate">{m.name}</div>
                            <div className="text-[10px] text-muted-foreground truncate">{m.desc}</div>
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* Sessions */}
                  <div className="p-3">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground mb-2 px-1">
                      <History className="h-3.5 w-3.5" />
                      Sessions
                    </div>
                    <div className="space-y-0.5">
                      {sessions.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => { setSelectedSession(s.id); setSettingsOpen(false) }}
                          className={cn(
                            'w-full flex items-start gap-1.5 px-2 py-1.5 rounded text-left text-xs hover:bg-muted transition-colors',
                            selectedSession === s.id && 'bg-muted',
                          )}
                        >
                          {selectedSession === s.id && <Check className="h-3 w-3 mt-0.5 text-primary shrink-0" />}
                          <span className={cn('flex-1 min-w-0', selectedSession !== s.id && 'ml-[15px]')}>
                            <div className="font-medium truncate">{s.name}</div>
                            <div className="text-[10px] text-muted-foreground truncate">{s.desc}</div>
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* Configs */}
                  <div className="p-3">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground mb-2 px-1">
                      <Sliders className="h-3.5 w-3.5" />
                      Configs
                    </div>
                    <div className="space-y-2.5 px-1">
                      <div>
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-1">
                          <Bot className="h-3 w-3" />
                          Agent
                        </div>
                        <div className="space-y-0.5 mb-1">
                          {agents.map((a) => (
                            <button
                              key={a.id}
                              onClick={() => setSelectedAgent(a.id)}
                              className={cn(
                                'w-full flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] hover:bg-muted/70 transition-colors text-left',
                                selectedAgent === a.id && 'bg-muted',
                              )}
                            >
                              {selectedAgent === a.id ? (
                                <Check className="h-2.5 w-2.5 text-primary shrink-0" />
                              ) : (
                                <span className="w-2.5" />
                              )}
                              <span className="flex-1 truncate">{a.name}</span>
                            </button>
                          ))}
                        </div>
                        <div className="text-[9px] text-muted-foreground/70 italic">
                          {agents.find(a => a.id === selectedAgent)?.desc}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground mb-1">Temperature</div>
                        <input type="range" min="0" max="2" step="0.1" defaultValue="0.7" className="w-full" />
                        <div className="text-[10px] text-foreground text-right">0.7</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground mb-1">Max Tokens</div>
                        <input type="number" defaultValue="2048" className="w-full px-2 py-1 text-xs border border-border rounded bg-background" />
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground mb-1">System Prompt</div>
                        <textarea rows={2} placeholder="自訂系統提示..." className="w-full px-2 py-1 text-xs border border-border rounded bg-background resize-none" />
                      </div>
                    </div>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
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

        {/* Body - Chat Messages */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="text-sm text-muted-foreground text-center py-12">
            <Sparkles className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
            <div className="font-medium text-foreground mb-1">開始對話</div>
            <div className="text-xs">詢問股票、技術指標、市場分析</div>
            <div className="mt-4 text-[10px] text-muted-foreground/70">
              可拖曳視窗標題列移動位置
            </div>
          </div>
        </div>

        {/* Footer - Input */}
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
      </div>
    </>
  )
}
