/**
 * IndexedDB-backed fetch wrapper
 *
 * 行為：
 * 1. 從 cache 讀 → 若新鮮（TTL 內）→ 直接回傳
 * 2. cache miss 或過期 → 背景 fetch backend → 存 cache
 * 3. force refresh 可強制打 backend
 *
 * API 設計：
 *   cachedFetch<T>({ key, fetcher, ttl })
 *     - 回傳 { data, isStale, refetch }
 *     - data 可能是 cache 內的（即使是 stale 也回傳，背景 refresh）
 */

import { get, set } from 'idb-keyval'
import { ttlFor, type CacheCategory } from './cache-keys'

const NAMESPACE = 'aistock:v1'

interface CacheEnvelope<T> {
  data: T
  storedAt: number  // epoch ms
  ttl: number
}

export interface CachedFetchOptions<T> {
  key: string
  category: CacheCategory
  fetcher: () => Promise<T | null>
  /** Force bypass cache, always fetch fresh */
  force?: boolean
}

export interface CachedFetchResult<T> {
  /** data from cache (stale or fresh) OR freshly fetched */
  data: T | null
  /** true if data came from stale cache (and background refresh is in flight) */
  isStale: boolean
  /** true if this call actually fetched from backend (cache miss or forced) */
  didFetch: boolean
  /** manually trigger a refetch */
  refetch: () => Promise<T | null>
  /** epoch ms when cache was stored, 0 if not cached */
  storedAt: number
}

const inflight = new Map<string, Promise<unknown>>()

function namespacedKey(key: string): string {
  return `${NAMESPACE}:${key}`
}

function isFresh(envelope: CacheEnvelope<unknown>): boolean {
  return Date.now() - envelope.storedAt < envelope.ttl
}

function envelopeOf<T>(envelope: CacheEnvelope<T> | undefined): CacheEnvelope<T> | undefined {
  return envelope
}

export async function cachedFetch<T>(opts: CachedFetchOptions<T>): Promise<CachedFetchResult<T>> {
  const { key, category, fetcher, force = false } = opts
  const ttl = ttlFor(category)
  const idbKey = namespacedKey(key)

  if (!force) {
    try {
      const raw = await get<CacheEnvelope<T>>(idbKey)
      const env = envelopeOf(raw)
      if (env) {
        if (isFresh(env)) {
          return {
            data: env.data,
            isStale: false,
            didFetch: false,
            refetch: () => refetchNow(),
            storedAt: env.storedAt,
          }
        }
        // Stale: return stale data, but kick off background refresh
        void backgroundRefresh(idbKey, fetcher, ttl)
        return {
          data: env.data,
          isStale: true,
          didFetch: false,
          refetch: () => refetchNow(),
          storedAt: env.storedAt,
        }
      }
    } catch {
      // IndexedDB unavailable (SSR, private mode, etc) — fall through
    }
  }

  // Cache miss or forced: fetch now
  const data = await runOrJoinInflight(idbKey, fetcher)
  const storedAt = Date.now()
  if (data !== null) {
    await safeSet(idbKey, { data, storedAt, ttl })
  }
  return {
    data,
    isStale: false,
    didFetch: true,
    refetch: () => refetchNow(),
    storedAt,
  }

  async function refetchNow(): Promise<T | null> {
    const fresh = await runOrJoinInflight(idbKey, fetcher)
    if (fresh !== null) {
      await safeSet(idbKey, { data: fresh, storedAt: Date.now(), ttl })
    }
    return fresh
  }
}

async function backgroundRefresh<T>(
  idbKey: string,
  fetcher: () => Promise<T | null>,
  ttl: number,
): Promise<void> {
  try {
    const data = await runOrJoinInflight<T>(idbKey, fetcher)
    if (data !== null) {
      await safeSet(idbKey, { data, storedAt: Date.now(), ttl })
    }
  } catch (e) {
    console.warn('[cache] background refresh failed:', e)
  }
}

async function runOrJoinInflight<T>(idbKey: string, fetcher: () => Promise<T | null>): Promise<T | null> {
  const existing = inflight.get(idbKey)
  if (existing) {
    return (await existing) as T | null
  }
  const p = (async () => {
    try {
      return await fetcher()
    } catch (e) {
      console.warn('[cache] fetch failed:', e)
      return null
    } finally {
      inflight.delete(idbKey)
    }
  })()
  inflight.set(idbKey, p)
  return p
}

async function safeSet<T>(idbKey: string, env: CacheEnvelope<T>): Promise<void> {
  try {
    await set(idbKey, env)
  } catch (e) {
    console.warn('[cache] set failed:', e)
  }
}

/** Force-invalidate a key. Useful after writes (POST/DELETE). */
export async function invalidate(key: string): Promise<void> {
  try {
    const { del } = await import('idb-keyval')
    await del(namespacedKey(key))
  } catch {
    // ignore
  }
}

/** Invalidate by category prefix. e.g. invalidateCategory('watchlist') */
export async function invalidateCategory(category: string): Promise<void> {
  // idb-keyval doesn't support prefix scan. Caller should track keys themselves.
  // We provide a no-op stub; real impl is via `invalidate(key)` for known keys.
  console.warn(`[cache] invalidateCategory(${category}) is a no-op; invalidate specific keys instead`)
}
