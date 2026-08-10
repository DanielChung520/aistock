export type NormalizeMode = 'zscore' | 'pct'
export type MetricMode = 'euclidean' | 'dtw'
export type TrendFilter = 'none' | 'up' | 'down' | 'range'

export interface PatternParams {
  window: number
  normalize: NormalizeMode
  metric: MetricMode
  trend_filter: TrendFilter
  threshold: number
  limit: number
  end_date: string | null
}

export interface SearchPattern {
  _key: string
  name: string
  symbol: string
  bars: number[]
  end_date?: string | null
  params: PatternParams
  thumbnail?: string
  ai_description?: string | null
  created_at: string
  updated_at: string
}

export interface PatternSelection {
  dates: string[]
  closes: number[]
  thumbnail?: string
}

export interface PatternSearchResult {
  stock_id: string
  name: string | null
  similarity: number
  distance: number
}

export interface PatternSearchResponse {
  pattern: SearchPattern
  total: number
  results: PatternSearchResult[]
  ai_summary?: string
  used_fallback?: boolean
  fallback_model?: string | null
}

export const DEFAULT_PATTERN_PARAMS: PatternParams = {
  window: 20,
  normalize: 'zscore',
  metric: 'euclidean',
  trend_filter: 'none',
  threshold: 0.7,
  limit: 30,
  end_date: null,
}
