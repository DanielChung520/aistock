'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { loadCatalog, searchCatalog, type StockCatalogItem } from '@/lib/cache/stock-catalog'

interface UseStockCatalogResult {
  items: StockCatalogItem[]
  isLoading: boolean
  error: string | null
  storedAt: number
  search: (query: string, limit?: number) => StockCatalogItem[]
  refresh: () => Promise<void>
}

/**
 * Hook providing the in-memory stock catalog (loaded once, then kept in React state).
 * Initial load: cache-first, then network if stale/missing.
 * Subsequent searches: pure in-memory, no network.
 */
export function useStockCatalog(): UseStockCatalogResult {
  const [items, setItems] = useState<StockCatalogItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [storedAt, setStoredAt] = useState(0)
  const inited = useRef(false)

  const load = useCallback(async (force = false) => {
    try {
      setError(null)
      const env = await loadCatalog({ force })
      setItems(env.items)
      setStoredAt(env.storedAt)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load stock catalog')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (inited.current) return
    inited.current = true
    void load(false)
  }, [load])

  const search = useCallback(
    (query: string, limit = 30): StockCatalogItem[] => {
      return searchCatalog(items, query, limit)
    },
    [items],
  )

  const refresh = useCallback(() => load(true), [load])

  return { items, isLoading, error, storedAt, search, refresh }
}
