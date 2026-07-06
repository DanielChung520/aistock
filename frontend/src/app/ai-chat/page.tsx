'use client'

import { useEffect, useRef, useState } from 'react'
import { X, Sparkles, Send, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

const STORAGE_KEY = 'ai-chat-messages'

function loadMessages(): ChatMessage[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return []
}

function saveMessages(messages: ChatMessage[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages))
  } catch {}
}

export default function StandaloneAIChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMessages(loadMessages())
  }, [])

  useEffect(() => {
    saveMessages(messages)
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const handleSend = () => {
    const text = input.trim()
    if (!text) return
    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setTimeout(() => {
      const aiMsg: ChatMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: `(Mock) 已收到您的訊息：「${text}」。AI 摘要功能尚未連接 LLM，此為示意回應。`,
        timestamp: Date.now(),
      }
      setMessages((prev) => [...prev, aiMsg])
    }, 500)
  }

  const handleClear = () => {
    if (confirm('確定要清除所有對話？')) {
      setMessages([])
    }
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      <header className="h-[60px] shrink-0 border-b border-border bg-gradient-to-r from-purple-500/5 to-blue-500/5 flex items-center justify-between px-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-md bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="text-base font-semibold">AI 助手</div>
            <div className="text-xs text-muted-foreground">獨立視窗模式 · Powered by aiStock</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
            onClick={handleClear}
            title="清除對話"
          >
            <Trash2 className="h-4 w-4 mr-1" />
            清除
          </Button>
          <Button
            variant="ghost"
            className="h-9 w-9"
            onClick={() => window.close()}
            title="關閉視窗"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <main ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center text-muted-foreground max-w-md">
              <Sparkles className="h-16 w-16 mx-auto mb-4 text-muted-foreground/40" />
              <div className="text-lg font-medium text-foreground mb-2">開始新對話</div>
              <div className="text-sm">輸入訊息開始與 AI 助手對話。<br />對話內容會自動儲存於 localStorage。</div>
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[70%] rounded-2xl px-4 py-2.5 text-sm ${
                  m.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-foreground'
                }`}
              >
                {m.content}
              </div>
            </div>
          ))
        )}
      </main>

      <footer className="border-t border-border p-4 shrink-0">
        <div className="flex items-end gap-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder="輸入訊息... (Enter 送出, Shift+Enter 換行)"
            rows={3}
            className="flex-1 resize-none rounded-lg border border-border bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <Button
            variant="ghost"
            className="h-10 w-10 shrink-0"
            onClick={handleSend}
            disabled={!input.trim()}
            title="送出"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </footer>
    </div>
  )
}
