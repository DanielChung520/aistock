'use client'

import { useEffect, useState } from 'react'

const POLL_INTERVAL_MS = 30 * 1000

interface UnreadCountResponse {
  unread: number
}

export function useUnreadCount(): { unread: number; isLoading: boolean } {
  const [unread, setUnread] = useState(0)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    const fetchUnread = async () => {
      try {
        const res = await fetch('/api/strategy-hits/unread-count')
        if (!res.ok) throw new Error(`unread-count request failed with status ${res.status}`)
        const data = (await res.json()) as UnreadCountResponse
        if (cancelled) return
        setUnread(typeof data.unread === 'number' ? data.unread : 0)
        setIsLoading(false)
      } catch (error) {
        console.error('Failed to fetch unread count:', error)
        if (!cancelled) setIsLoading(false)
        // 保留上一次的 unread 值
      }
    }

    void fetchUnread()
    const timer = setInterval(() => void fetchUnread(), POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  return { unread, isLoading }
}
