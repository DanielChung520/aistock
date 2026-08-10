/**
 * Cache key 策略 + TTL 設定
 *
 * 每個資料類型有不同 TTL 策略：
 * - 即時資料（最新一筆）: 短 TTL（分鐘級）
 * - 歷史資料: 中 TTL（小時級）
 * - 選單/設定: 長 TTL（天級）
 */

export type CacheCategory =
  | 'taiex-quote'         // 加權指數最新報價
  | 'taiex-history'       // 加權指數歷史
  | 'taiex-indicators'    // 加權指數指標（計算慢）
  | 'stock-quote'         // 個股最新報價
  | 'stock-history'       // 個股歷史 K 線
  | 'stock-indicators'    // 個股指標
  | 'stock-minute'        // 個股分鐘線
  | 'stock-minute-indicators'
  | 'stock-analysis'      // 個股分析（四大買賣點等）
  | 'stock-catalog'       // 全部股票清單（1845+）
  | 'news-today'          // 今日新聞
  | 'menu'                // 選單
  | 'watchlist'           // 自選股（即時）
  | 'search'              // 搜尋結果
  | 'strategy-hits'       // 策略選股命中歷史
  | 'strategy-unread-count' // 通知中心未讀數

const TTL_MS: Record<CacheCategory, number> = {
  'taiex-quote':            5 * 60 * 1000,            // 5 分鐘
  'taiex-history':           5 * 60 * 1000,            // 5 分鐘
  'taiex-indicators':        5 * 60 * 1000,            // 5 分鐘
  'stock-quote':             60 * 1000,                // 1 分鐘
  'stock-history':           60 * 60 * 1000,           // 1 小時
  'stock-indicators':        60 * 60 * 1000,           // 1 小時
  'stock-minute':            60 * 1000,                // 1 分鐘
  'stock-minute-indicators': 60 * 1000,                // 1 分鐘
  'stock-analysis':          60 * 60 * 1000,           // 1 小時
  'stock-catalog':           24 * 60 * 60 * 1000,      // 24 小時（1845+ 股票）
  'news-today':              10 * 60 * 1000,           // 10 分鐘
  'menu':                    24 * 60 * 60 * 1000,      // 24 小時
  'watchlist':               0,                          // 不快取
  'search':                  30 * 60 * 1000,            // 30 分鐘
  'strategy-hits':           5 * 60 * 1000,             // 5 分鐘
  'strategy-unread-count':   30 * 1000,                 // 30 秒
}

export function ttlFor(category: CacheCategory): number {
  return TTL_MS[category]
}

/**
 * Cache key 構造
 * 格式: `<category>:<path>`
 *
 * 範例:
 *   - taiex-history:months=6
 *   - stock-history:2330:months=6
 *   - stock-indicators:2330:months=6&ma_periods=5,10,20,60
 */
export function makeCacheKey(category: CacheCategory, ...parts: (string | number | undefined | null)[]): string {
  const filtered = parts.filter((p) => p !== undefined && p !== null && p !== '')
  return `${category}:${filtered.join(':')}`
}

export function parseCacheKey(key: string): { category: string; parts: string[] } {
  const [category, ...parts] = key.split(':')
  return { category, parts }
}
