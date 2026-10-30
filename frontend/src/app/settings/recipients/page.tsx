'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AppShell } from '@/components/app-shell'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Send } from 'lucide-react'
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
  const [search, setSearch] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [broadcastOpen, setBroadcastOpen] = useState(false)
  const [broadcastText, setBroadcastText] = useState('')
  const [broadcasting, setBroadcasting] = useState(false)
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return recipients
    return recipients.filter((r) =>
      `${r.display_name} ${r.user_id} ${r.note} ${r.category}`.toLowerCase().includes(q),
    )
  }, [recipients, search])

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

  const syncRecipients = async () => {
    setSyncing(true)
    try {
      const res = await fetch('/api/line/recipients/sync', { method: 'POST' })
      const data = (await res.json()) as { available: boolean; followers: number; added: number; message?: string }
      if (!data.available) toast.error(data.message ?? '此 LINE 帳號未開放名單 API')
      else toast.success(`LINE 上有 ${data.followers} 位好友，新增 ${data.added} 位`)
      void load()
    } catch {
      toast.error('同步失敗')
    } finally {
      setSyncing(false)
    }
  }

  const refreshAll = async () => {
    setRefreshing(true)
    try {
      const res = await fetch('/api/line/recipients/refresh-all', { method: 'POST' })
      const data = (await res.json()) as { updated: number }
      toast.success(`已更新 ${data.updated} 位名稱`)
      void load()
    } catch {
      toast.error('更新失敗')
    } finally {
      setRefreshing(false)
    }
  }

  const sendBroadcast = async () => {
    setBroadcasting(true)
    try {
      const res = await fetch('/api/line/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: broadcastText }),
      })
      const data = (await res.json()) as { sent: number }
      toast.success(`已發送給 ${data.sent} 位`)
      setBroadcastOpen(false)
      setBroadcastText('')
    } catch {
      toast.error('發送失敗')
    } finally {
      setBroadcasting(false)
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
          <CardContent className="py-3 flex flex-wrap items-center gap-2">
            <div className="flex-1 min-w-[220px]">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜尋名稱 / ID / 備註 / 分類..."
                className="h-9"
              />
            </div>
            <Button variant="outline" size="sm" className="h-9" onClick={() => void syncRecipients()} disabled={syncing}>
              {syncing ? '同步中...' : '同步聯絡人'}
            </Button>
            <Button variant="outline" size="sm" className="h-9" onClick={() => void refreshAll()} disabled={refreshing}>
              {refreshing ? '更新中...' : '更新名稱'}
            </Button>
            <Button size="sm" className="h-9" onClick={() => setBroadcastOpen(true)}>
              <Send className="h-3.5 w-3.5 mr-1" />
              群發信息
            </Button>
            {!configured && <span className="text-[11px] text-destructive">未設定憑證</span>}
          </CardContent>
        </Card>

        <Card className="border-border bg-card/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg font-medium">
              名單與授權（{recipients.length} 位）
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            {loading ? (
              <div className="p-4 space-y-2">
                {[1, 2].map((i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                {recipients.length === 0 ? '尚無使用者加入 LINE OA' : '沒有符合搜尋的收件者'}
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
                  {filtered.map((recipient) => (
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

      {broadcastOpen && (
        <>
          <div className="fixed inset-0 z-[99] bg-black/30" onClick={() => setBroadcastOpen(false)} />
          <div className="fixed z-[100] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[480px] max-w-[92vw] bg-background border border-border rounded-lg shadow-2xl p-4 space-y-3">
            <div className="text-sm font-medium">群發信息</div>
            <div className="text-xs text-muted-foreground">
              發送給全部 {recipients.filter((r) => r.status === 'followed').length} 位已加入 OA 的使用者
            </div>
            <textarea
              value={broadcastText}
              onChange={(e) => setBroadcastText(e.target.value)}
              className="w-full h-32 rounded-md border border-border bg-transparent p-2 text-sm"
              placeholder="輸入訊息..."
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setBroadcastOpen(false)}>
                取消
              </Button>
              <Button size="sm" onClick={() => void sendBroadcast()} disabled={broadcasting || !broadcastText.trim()}>
                {broadcasting ? '發送中...' : '發送'}
              </Button>
            </div>
          </div>
        </>
      )}

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
