export interface StockHistoryItem {
  stock_id?: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover?: number;
  change?: number;
  transaction?: number;
}

export interface BarItem {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MinuteBarItem {
  datetime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
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
  version: 4;
  ma: {
    enabled: boolean;
    periods: number[];
    lookback: number;
    cooldown: number;
    buySlopeMin: number;
    sellSlopeMax: number;
  };
  bollinger: { enabled: boolean; period: number; stdDev: number };
  volume: { enabled: boolean };
  volume_ma: { enabled: boolean; periods: number[] };
  kdj: { enabled: boolean; period: number; kSmooth: number; dSmooth: number };
  macd: { enabled: boolean; fast: number; slow: number; signal: number };
  rsi: { enabled: boolean; period: number };
}

export interface MaDataItem {
  date: string;
  ma8?: number | null;
  ma21?: number | null;
  ma55?: number | null;
  ma89?: number | null;
  slope8?: number | null;
  slope21?: number | null;
  slope55?: number | null;
  close_offset?: number | null;
  volume_distance?: number | null;
  weight?: number | null;
  trend?: 'A' | 'B' | 'C' | null;
  buy?: boolean;
  sell?: boolean;
  [key: string]: number | string | null | boolean | undefined;
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

export interface MaAccuracy {
  horizon: number;
  buy_accuracy: number | null;
  buy_samples: number;
  sell_accuracy: number | null;
  sell_samples: number;
}

export interface IndicatorsResponse {
  ma: MaDataItem[];
  kdj: KdjDataItem[];
  rsi: RsiDataItem[];
  macd: MacdDataItem[];
  bollinger: BollingerDataItem[];
  ma_accuracy?: MaAccuracy;
}

export interface BestFourPointAnalysis {
  is_buy: boolean;
  is_sell: boolean;
  reason: string;
}

export interface BacktestRequest {
  stock_id: string;
  months: number;
  cooldown: number;
  buy_slope_min: number;
  sell_slope_max: number;
  max_hold_bars: number;
  stop_loss_pct: number;
  initial_capital: number;
}

export interface BacktestTrade {
  entry_date: string;
  exit_date: string;
  entry: number;
  exit: number;
  return_pct: number;
  exit_reason: 'signal' | 'stop_loss' | 'max_hold' | 'open';
}

export interface BacktestResult {
  stock_id: string;
  bars: number;
  months: number;
  params: {
    cooldown: number;
    buy_slope_min: number;
    sell_slope_max: number;
    max_hold_bars: number;
    stop_loss_pct: number;
  };
  initial_capital: number;
  final_equity: number;
  total_return_pct: number;
  max_drawdown_pct: number;
  buy_signals: number;
  sell_signals: number;
  closed_trades: number;
  wins: number;
  losses: number;
  win_rate_pct: number;
  avg_win_pct: number;
  avg_loss_pct: number;
  profit_factor: number | null;
  stop_loss_hits: number;
  max_hold_hits: number;
  last_signal: 'holding' | 'flat';
  trades: BacktestTrade[];
  equity_curve: Array<{ date: string; equity: number }>;
}

export interface BacktestSuggestion {
  stock_id: string;
  months: number;
  profile: {
    volatility_pct: number;
    buys_per_month: number;
    trend_share_pct: number;
  };
  suggested_params: {
    cooldown: number;
    buy_slope_min: number;
    sell_slope_max: number;
    max_hold_bars: number;
    stop_loss_pct: number;
  };
  reasons: string[];
  expected_result: {
    total_return_pct: number | null;
    win_rate_pct: number | null;
    max_drawdown_pct: number | null;
    closed_trades: number | null;
  };
}

export interface AiAdvice {
  action: 'buy' | 'sell' | 'hold' | 'wait';
  side: 'buy' | 'sell' | 'none';
  suggested_price: number[];
  reasons: string[];
}

export interface SimulationSignal {
  buy: boolean;
  sell: boolean;
  slope8: number | null;
  slope21: number | null;
  trend: 'A' | 'B' | 'C' | null;
  volume_distance: number | null;
  close_offset: number | null;
}

export interface SimulationDay {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  signal: SimulationSignal;
  advice: AiAdvice;
}

export interface SimulationTrade {
  date: string;
  action: 'buy' | 'sell';
  price: number;
  shares: number;
  fee: number;
  cash_after: number;
  pnl?: number;
  pnl_pct?: number;
  reason?: string;
  limit_price?: number | null;
  avg_cost?: number | null;
}

export interface SimulationState {
  day_index: number;
  cash: number;
  shares: number;
  entry_price: number;
  entry_index: number;
  avg_cost: number;
  pending_order: { action: 'buy' | 'sell'; date: string | null; reason?: string; limit_price?: number | null; lots?: number | null } | null;
  trades: SimulationTrade[];
  total_fees: number;
}

export interface SimulationInitResult {
  stock_id: string;
  bars: number;
  initial_capital: number;
  days: SimulationDay[];
  state: SimulationState;
}

export interface SimulationAdvanceResult {
  days: Array<SimulationDay & { order_executed: 'buy' | 'sell' | null; next_order: { action: string; date: string | null } | null; cash: number; position: { shares: number; entry_price: number } }>;
  state: SimulationState;
  completed: boolean;
}

export interface StockMinuteItem {
  datetime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
