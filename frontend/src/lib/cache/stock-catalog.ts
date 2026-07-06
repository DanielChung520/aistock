/**
 * Stock catalog — full list of TWSE/TPEx stocks, cached in IndexedDB.
 *
 * Strategy:
 * - 1845+ stocks is too many to refetch per session.
 * - Updated rarely (corporate actions only).
 * - Cache aggressively: 24h TTL + manual force-refresh.
 *
 * Data shape (subset of /api/basics/stock-codes):
 *   { code: string, name: string, market?: string, industry?: string }
 */

import { cachedFetch } from './cache-fetch'
import { makeCacheKey, type CacheCategory } from './cache-keys'

export interface StockCatalogItem {
  code: string
  name: string
  market?: string
  industry?: string
}

export interface StockCatalogEnvelope {
  items: StockCatalogItem[]
  total: number
  storedAt: number
}

/** Pure in-memory search over a catalog. No network. */
export function searchCatalog(
  items: StockCatalogItem[],
  query: string,
  limit = 30,
): StockCatalogItem[] {
  if (!query.trim()) return items.slice(0, limit)
  const q = query.trim().toLowerCase()
  const tokens = q.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return items.slice(0, limit)

  const scored: Array<{ item: StockCatalogItem; score: number }> = []
  for (const item of items) {
    const code = item.code.toLowerCase()
    const name = item.name.toLowerCase()
    let score = 0
    for (const t of tokens) {
      if (code === t) score += 100
      else if (code.startsWith(t)) score += 50
      else if (name === t) score += 80
      else if (name.startsWith(t)) score += 40
      else if (name.includes(t)) score += 10
      else if (code.includes(t)) score += 5
    }
    if (score > 0) scored.push({ item, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map((s) => s.item)
}

/** Load catalog from cache, falling back to network. */
export async function loadCatalog(options?: { force?: boolean }): Promise<StockCatalogEnvelope> {
  const result = await cachedFetch<{ data: StockCatalogItem[] }>({
    key: makeCacheKey('stock-catalog'),
    category: 'stock-catalog' as CacheCategory,
    force: options?.force,
    fetcher: async () => {
      const res = await fetch('/api/basics/stock-codes')
      if (!res.ok) return null
      const json = await res.json()
      const raw = (json?.data ?? []) as Array<Record<string, string>>
      const items: StockCatalogItem[] = raw.map((r) => ({
        code: String(r.code ?? '').trim(),
        name: String(r.name ?? '').trim(),
        market: r.market,
        industry: r.industry,
      }))
      return { data: items }
    },
  })
  const items = (result.data?.data ?? []) as StockCatalogItem[]
  return {
    items,
    total: items.length,
    storedAt: result.storedAt,
  }
}
