/**
 * Session-level in-memory cache (Map).
 *
 * 優先於 IndexedDB，同頁 session 內同一 key 不重複讀取。
 * 頁面關閉即釋放，無持久化。
 */

const store = new Map<string, { data: unknown; storedAt: number; ttl: number }>()

const DEFAULT_TTL = 5 * 60 * 1000 // 5 minutes

export function memGet<T>(key: string): T | null {
  const entry = store.get(key)
  if (!entry) return null
  if (Date.now() - entry.storedAt > entry.ttl) {
    store.delete(key)
    return null
  }
  return entry.data as T
}

export function memSet<T>(key: string, data: T, ttl = DEFAULT_TTL): void {
  store.set(key, { data, storedAt: Date.now(), ttl })
}

export function memClear(): void {
  store.clear()
}
