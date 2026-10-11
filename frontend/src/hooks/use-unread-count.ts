'use client'

import { useEffect, useState } from 'react'

const POLL_INTERVAL_MS = 30 * 1000
const MAX_RETRIES = 2
const RETRY_BACKOFF_MS = 1500

interface UnreadCountResponse {
  unread: number
}

async function fetchWithRetry(url: string): Promise<Response> {
  let lastErr: unknown = null
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url)
      if (res.ok) return res
      if (res.status >= 500 && res.status <= 599 && attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS * (attempt + 1)))
        continue
      }
      return res
    } catch (err) {
      lastErr = err
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS * (attempt + 1)))
        continue
      }
      throw err
    }
  }
  throw lastErr ?? new Error('unread-count: max retries exceeded')
}

export function useUnreadCount(): { unread: number; isLoading: boolean } {
  const [unread, setUnread] = useState(0)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    const fetchUnread = async () => {
      try {
        const res = await fetchWithRetry('/api/strategy-hits/unread-count')
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
