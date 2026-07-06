export interface StockHistoryItem {
  stock_id: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number;
  change: number;
  transaction: number;
}

export interface WatchlistItem {
  stock_id: string;
  name: string;
  added_at: string;
}

export interface StockSearchResult {
  stock_id: string;
  name: string;
  isin_code: string;
  market_type: string;
  industry: string;
  listed_date: string;
}

export interface IndicatorSettings {
  version: 1;
  ma: { enabled: boolean; periods: number[]; type: 'sma' | 'ema' };
  bollinger: { enabled: boolean; period: number; stdDev: number };
  volume: { enabled: boolean };
  kdj: { enabled: boolean; period: number; kSmooth: number; dSmooth: number };
  macd: { enabled: boolean; fast: number; slow: number; signal: number };
  rsi: { enabled: boolean; period: number };
}

export interface MaDataItem {
  date: string;
  [key: string]: number | string | null;
}

export interface KdjDataItem {
  date: string;
  k: number;
  d: number;
  j: number;
}

export interface RsiDataItem {
  date: string;
  rsi: number | null;
}

export interface MacdDataItem {
  date: string;
  dif: number | null;
  signal: number | null;
  histogram: number | null;
}

export interface BollingerDataItem {
  date: string;
  upper: number | null;
  middle: number | null;
  lower: number | null;
}

export interface IndicatorsResponse {
  ma: MaDataItem[];
  kdj: KdjDataItem[];
  rsi: RsiDataItem[];
  macd: MacdDataItem[];
  bollinger: BollingerDataItem[];
}

export interface BestFourPointAnalysis {
  is_buy: boolean;
  is_sell: boolean;
  reason: string;
}

export interface StockMinuteItem {
  datetime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
