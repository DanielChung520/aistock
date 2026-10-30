'use client'

import { useCallback, useEffect, useState } from 'react'
import { AppShell } from '@/components/app-shell'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface Source {
  key: string
  label: string
  enabled: boolean
}

interface Recipient {
  user_id: string
  display_name: string
  note: string
  category: string
  status: string
  subscriptions: Record<string, boolean>
}

interface Message {
  direction: 'in' | 'out'
  text: string
  at: number
}

export default function LineRecipientsPage() {
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [sources, setSources] = useState<Source[]>([])
  const [configured, setConfigured] = useState(true)
  const [loading, setLoading] = useState(true)
  const [chatFor, setChatFor] = useState<Recipient | null>(null)
  const [messages, setMessages] = useState<Message[]>([])

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/line/recipients')
      const data = (await res.json()) as { recipients: Recipient[]; sources: Source[]; configured: boolean }
      setRecipients(data.recipients ?? [])
      setSources(data.sources ?? [])
      setConfigured(Boolean(data.configured))
    } catch {
      toast.error('載入收件者失敗')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const patchRecipient = async (user_id: string, body: Record<string, unknown>) => {
    await fetch(`/api/line/recipients/${user_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  const toggleSubscription = async (recipient: Recipient, sourceKey: string) => {
    const next = { ...recipient.subscriptions, [sourceKey]: !recipient.subscriptions[sourceKey] }
    setRecipients((prev) =>
      prev.map((r) => (r.user_id === recipient.user_id ? { ...r, subscriptions: next } : r)),
    )
    await patchRecipient(recipient.user_id, { subscriptions: next })
  }

  const saveField = async (recipient: Recipient, field: 'note' | 'category', value: string) => {
    if (recipient[field] === value) return
    setRecipients((prev) =>
      prev.map((r) => (r.user_id === recipient.user_id ? { ...r, [field]: value } : r)),
    )
    await patchRecipient(recipient.user_id, { [field]: value })
  }

  const refreshName = async (recipient: Recipient) => {
    const res = await fetch(`/api/line/recipients/${recipient.user_id}/refresh`, { method: 'POST' })
    if (res.ok) {
      toast.success('已更新名稱')
      void load()
    } else {
      toast.error('無法取得 LINE 名稱（可能未加 OA 或已封鎖）')
    }
  }

  const openChat = async (recipient: Recipient) => {
    setChatFor(recipient)
    setMessages([])
    try {
      const res = await fetch(`/api/line/recipients/${recipient.user_id}/messages`)
      const data = (await res.json()) as { messages: Message[] }
      setMessages(data.messages ?? [])
    } catch {
      toast.error('載入對話失敗')
    }
  }

  return (
    <AppShell title="收件管理">
      <div className="p-4 md:p-6 space-y-4">
        <Card className="border-border bg-card/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg font-medium">通知來源</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 text-xs">
            <span className="text-muted-foreground mr-1">
              {configured ? '憑證已設定' : '未設定憑證'} · 來源的發送開關設於各功能本身（此處僅顯示註冊狀態）
            </span>
            {sources.map((source) => (
              <span
                key={source.key}
                className={cn(
                  'rounded-full px-2 py-0.5 border',
                  source.enabled ? 'border-border text-foreground' : 'border-border/50 text-muted-foreground',
                )}
              >
                {source.label}
                {source.enabled ? '' : '（停用）'}
              </span>
            ))}
          </CardContent>
        </Card>

        <Card className="border-border bg-card/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg font-medium">
              名單與授權（已加入 LINE OA 的使用者）
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            {loading ? (
              <div className="p-4 space-y-2">
                {[1, 2].map((i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : recipients.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                尚無使用者加入 LINE OA
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-muted-foreground">
                    <th className="text-left font-medium px-3 py-2">使用者</th>
                    <th className="text-left font-medium px-3 py-2 w-40">備註</th>
                    <th className="text-left font-medium px-3 py-2 w-28">分類</th>
                    {sources.map((source) => (
                      <th key={source.key} className="text-center font-medium px-2 py-2 whitespace-nowrap">
                        {source.label}
                      </th>
                    ))}
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {recipients.map((recipient) => (
                    <tr key={recipient.user_id} className="border-b border-border/40 last:border-b-0">
                      <td className="px-3 py-2 min-w-0">
                        <div className="truncate">{recipient.display_name || '(未命名)'}</div>
                        <div className="text-[10px] text-muted-foreground font-mono truncate">
                          {recipient.user_id}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          defaultValue={recipient.note}
                          onBlur={(e) => void saveField(recipient, 'note', e.target.value)}
                          className="h-7 text-xs"
                          placeholder="備註"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          defaultValue={recipient.category}
                          onBlur={(e) => void saveField(recipient, 'category', e.target.value)}
                          className="h-7 text-xs"
                          placeholder="分類"
                        />
                      </td>
                      {sources.map((source) => (
                        <td key={source.key} className="px-2 py-2 text-center">
                          <button
                            type="button"
                            onClick={() => void toggleSubscription(recipient, source.key)}
                            className={cn(
                              'h-5 w-5 rounded border align-middle',
                              recipient.subscriptions[source.key]
                                ? 'bg-primary border-primary'
                                : 'bg-transparent border-border',
                            )}
                            title={recipient.subscriptions[source.key] ? '接收' : '不接收'}
                          />
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <Button variant="ghost" size="sm" className="h-7" onClick={() => void refreshName(recipient)}>
                          更新名稱
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7" onClick={() => void openChat(recipient)}>
                          對話
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>

      {chatFor && (
        <>
          <div className="fixed inset-0 z-[99] bg-black/30" onClick={() => setChatFor(null)} />
          <aside className="fixed top-0 right-0 bottom-0 z-[100] w-[420px] bg-background border-l border-border shadow-2xl flex flex-col">
            <header className="h-12 shrink-0 border-b border-border flex items-center justify-between px-4">
              <div className="text-sm font-medium truncate">
                對話記錄 · {chatFor.display_name || chatFor.user_id}
              </div>
              <Button variant="ghost" size="sm" onClick={() => setChatFor(null)}>
                關閉
              </Button>
            </header>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground py-8">尚無對話</div>
              ) : (
                messages.map((message, index) => (
                  <div
                    key={index}
                    className={cn(
                      'max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap',
                      message.direction === 'out'
                        ? 'ml-auto bg-primary text-primary-foreground'
                        : 'bg-muted text-foreground',
                    )}
                  >
                    {message.text}
                  </div>
                ))
              )}
            </div>
          </aside>
        </>
      )}
    </AppShell>
  )
}
