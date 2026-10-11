// Centralized feature column descriptions for sensitivity analysis tooltips.
//
// Each entry maps a column name (as produced by the feature pipeline) to:
//   - group: top-level feature group (e.g. "kdj")
//   - label: Chinese label for the column (e.g. "KDJ K 值")
//   - need: importance tier ("required" / "recommended" / "supporting")
//
// The lookup is fuzzy: longer keys take precedence over shorter prefixes,
// so "kdj_k" matches before "kdj", and "macd_dif" matches before "macd".
import { DEFAULT_FEATURES } from './feature-settings-modal'

export type FeatureNeed = 'required' | 'recommended' | 'supporting'

interface FeatureItem {
  key: string
  label: string
  enabled: boolean
  params: { label: string; value: string }[]
  kind: 'params' | 'none'
  desc?: string
}

interface ColumnDesc {
  label: string
  need: FeatureNeed
}

// Map of group key -> FeatureItem (from feature-settings-modal).
function getFeatureGroups(): FeatureItem[] {
  return DEFAULT_FEATURES
}

// Per-column description overrides for fields that need richer context
// beyond the generic "<group_label> <suffix_label>" template.
const COLUMN_OVERRIDES: Record<string, { label: string; need?: FeatureNeed }> = {
  kdj_k: { label: 'KDJ K 值', need: 'required' },
  kdj_d: { label: 'KDJ D 值' },
  kdj_j: { label: 'KDJ J 值（領先線）' },
  kdj_pos: { label: 'KDJ 標準化位置' },
  kdj_golden: { label: 'KDJ 黃金交叉旗標' },
  kdj_dead: { label: 'KDJ 死亡交叉旗標' },
  kdj_at_high: { label: 'KDJ 近 20 日高點旗標' },
  kdj_at_low: { label: 'KDJ 近 20 日低點旗標' },
  macd_dif: { label: 'MACD DIF 快線', need: 'required' },
  macd_signal: { label: 'MACD DEA 訊號線' },
  macd_hist: { label: 'MACD 柱狀體' },
  macd_hist_norm: { label: 'MACD 標準化柱體（250 日分位）' },
  macd_pos: { label: 'MACD 標準化位置' },
  macd_cross_up: { label: 'MACD 黃金交叉' },
  macd_cross_down: { label: 'MACD 死亡交叉' },
  rsi: { label: 'RSI 相對強弱指標', need: 'required' },
  rsi_pos: { label: 'RSI 標準化位置' },
  rsi_dist_upper: { label: 'RSI 距超買線距離' },
  rsi_dist_lower: { label: 'RSI 距超賣線距離' },
  obv: { label: 'OBV 能量潮', need: 'required' },
  obv_slope: { label: 'OBV 斜率' },
  vr: { label: 'VR 容量比率' },
  adx: { label: 'ADX 趨勢強度', need: 'required' },
  adx_pos: { label: 'ADX 標準化位置' },
  adx_slope: { label: 'ADX 斜率' },
  adx_slope2: { label: 'ADX 二次斜率（加速度）' },
  adx_cross_up: { label: 'ADX 黃金交叉' },
  adx_cross_down: { label: 'ADX 死亡交叉' },
  dx: { label: 'DX 單日趨向' },
  dx_pos: { label: 'DX 標準化位置' },
  dx_slope: { label: 'DX 斜率' },
  dx_cross_up: { label: 'DX 黃金交叉' },
  dx_cross_down: { label: 'DX 死亡交叉' },
  aroon_up: { label: 'Aroon Up 上行線' },
  aroon_down: { label: 'Aroon Down 下行線' },
  aroon_osc: { label: 'Aroon 振盪線' },
  aroon_pos: { label: 'Aroon 標準化位置' },
  aroon_slope: { label: 'Aroon 斜率' },
  aroon_cross: { label: 'Aroon 交叉' },
  bb_width: { label: '布林帶寬度' },
  bollinger_upper: { label: '布林上軌' },
  bollinger_middle: { label: '布林中軌' },
  bollinger_lower: { label: '布林下軌' },
  bb_squeeze: { label: '布林擠壓狀態' },
  bb_squeeze_break_up: { label: '布林擠壓向上突破' },
  bb_squeeze_break_down: { label: '布林擠壓向下跌破' },
  cci: { label: 'CCI 商品通道指數', need: 'recommended' },
  cci_pos: { label: 'CCI 標準化位置' },
  cci_slope: { label: 'CCI 斜率' },
  cci_cross_up: { label: 'CCI 黃金交叉' },
  cci_cross_down: { label: 'CCI 死亡交叉' },
  mfi: { label: 'MFI 資金流量', need: 'recommended' },
  mfi_pos: { label: 'MFI 標準化位置' },
  mfi_slope: { label: 'MFI 斜率' },
  mfi_cross_up: { label: 'MFI 黃金交叉' },
  mfi_cross_down: { label: 'MFI 死亡交叉' },
  stochrsi_k: { label: 'StochRSI K 值' },
  stochrsi_d: { label: 'StochRSI D 值' },
  stochrsi_pos: { label: 'StochRSI 標準化位置' },
  stochrsi_slope: { label: 'StochRSI 斜率' },
  stochrsi_golden: { label: 'StochRSI 黃金交叉' },
  stochrsi_dead: { label: 'StochRSI 死亡交叉' },
  willr: { label: 'Williams %R 威廉指標', need: 'recommended' },
  willr_pos: { label: 'Williams %R 標準化位置' },
  willr_slope: { label: 'Williams %R 斜率' },
  willr_cross_up: { label: 'Williams %R 黃金交叉' },
  willr_cross_down: { label: 'Williams %R 死亡交叉' },
  ultosc: { label: '終極擺盪指標' },
  ultosc_pos: { label: '終極擺盪標準化位置' },
  ultosc_slope: { label: '終極擺盪斜率' },
  ultosc_cross_up: { label: '終極擺盪黃金交叉' },
  ultosc_cross_down: { label: '終極擺盪死亡交叉' },
  atr: { label: 'ATR 真實波幅', need: 'recommended' },
  atr_ratio: { label: 'ATR 對價比' },
  atr_slope: { label: 'ATR 斜率' },
  atr_pos: { label: 'ATR 標準化位置' },
  natr: { label: 'NATR 正規波幅' },
  natr_ratio: { label: 'NATR 對價比' },
  natr_slope: { label: 'NATR 斜率' },
  natr_pos: { label: 'NATR 標準化位置' },
  stddev: { label: 'N 日標準差波動' },
  stddev_ratio: { label: 'STDDEV 對價比' },
  stddev_slope: { label: 'STDDEV 斜率' },
  stddev_pos: { label: 'STDDEV 標準化位置' },
  sar: { label: 'SAR 拋物線指標' },
  sar_ratio: { label: 'SAR 對價比' },
  sar_slope: { label: 'SAR 斜率' },
  sar_pos: { label: 'SAR 標準化位置' },
  midprice: { label: 'N 日中點價' },
  midprice_ratio: { label: 'MIDPRICE 對價比' },
  midprice_slope: { label: 'MIDPRICE 斜率' },
  midprice_pos: { label: 'MIDPRICE 標準化位置' },
  range3: { label: '三日振幅' },
  range3_ratio: { label: '三日振幅對價比' },
  range3_slope: { label: '三日振幅斜率' },
  range3_pos: { label: '三日振幅標準化位置' },
  day_high: { label: '當日高價（壓力位）' },
  day_high_ratio: { label: '當日高價比' },
  day_high_slope: { label: '當日高價斜率' },
  day_high_pos: { label: '當日高價標準化位置' },
  day_low: { label: '當日低價（支撐位）' },
  day_low_ratio: { label: '當日低價比' },
  day_low_slope: { label: '當日低價斜率' },
  day_low_pos: { label: '當日低價標準化位置' },
  max_n: { label: 'N 日最高' },
  max_n_ratio: { label: 'N 日最高比' },
  max_n_slope: { label: 'N 日最高斜率' },
  max_n_pos: { label: 'N 日最高標準化位置' },
  min_n: { label: 'N 日最低' },
  min_n_ratio: { label: 'N 日最低比' },
  min_n_slope: { label: 'N 日最低斜率' },
  min_n_pos: { label: 'N 日最低標準化位置' },
  adosc: { label: 'ADOSC 能量潮振盪' },
  adosc_ratio: { label: 'ADOSC 對量比' },
  adosc_slope: { label: 'ADOSC 斜率' },
  adosc_pos: { label: 'ADOSC 標準化位置' },
  cmf: { label: 'CMF 資金流指標' },
  cmf_ratio: { label: 'CMF 對量比' },
  cmf_slope: { label: 'CMF 斜率' },
  cmf_pos: { label: 'CMF 標準化位置' },
  breakout_high3: { label: '三盤突破高點旗標' },
  breakout_high3_cnt10: { label: '近 10 日三盤突破計數' },
  breakout_high3_ratio: { label: '三盤突破幅度比' },
  breakout_high3_slope: { label: '三盤突破斜率' },
  new_high_n: { label: '創 N 日新高旗標' },
  new_high_n_cnt10: { label: '近 10 日創新高計數' },
  new_high_n_ratio: { label: '創新高幅度比' },
  new_high_n_slope: { label: '創新高斜率' },
  near_52w_high: { label: '近 52 週高點距離' },
  break_52w_high: { label: '突破 52 週高點旗標' },
  vol_surge: { label: '成交量暴增旗標' },
  breakout_vol_confirm: { label: '帶量突破確認' },
  pivot_break: { label: '樞紐點突破旗標' },
  line_of_least_resistance: { label: '最小阻力線旗標' },
  fly_high_vol: { label: '高飛量增旗標' },
  above_200ma: { label: '站上 200 日均線旗標' },
  weekly_slope_30: { label: '週線 30 日斜率' },
  vp_price_up_vol_up: { label: '量價齊揚' },
  vp_price_up_vol_dn: { label: '價漲量縮' },
  vp_price_dn_vol_up: { label: '價跌量增' },
  vp_price_dn_vol_dn: { label: '量價齊跌' },
  vp_top_divergence: { label: '頂部量價背離' },
  vp_bottom_divergence: { label: '底部量價背離' },
  vp_sky_vol: { label: '天量' },
  vp_ground_vol: { label: '地量' },
  idx_DJI_pct: { label: '道瓊指數當日漲跌幅' },
  idx_DJI_ma5: { label: '道瓊 5 日均線' },
  idx_DJI_ma20: { label: '道瓊 20 日均線' },
  idx_DJI_slope20: { label: '道瓊 20 日斜率' },
  idx_GSPC_pct: { label: '標普 500 當日漲跌幅' },
  idx_GSPC_ma5: { label: '標普 5 日均線' },
  idx_GSPC_ma20: { label: '標普 20 日均線' },
  idx_GSPC_slope20: { label: '標普 20 日斜率' },
  idx_HSI_pct: { label: '恆生指數當日漲跌幅' },
  idx_HSI_ma5: { label: '恆生 5 日均線' },
  idx_HSI_ma20: { label: '恆生 20 日均線' },
  idx_HSI_slope20: { label: '恆生 20 日斜率' },
  idx_IXIC_pct: { label: '那斯達克當日漲跌幅' },
  idx_IXIC_ma5: { label: '那斯達克 5 日均線' },
  idx_IXIC_ma20: { label: '那斯達克 20 日均線' },
  idx_IXIC_slope20: { label: '那斯達克 20 日斜率' },
  idx_KS11_pct: { label: '韓股綜合當日漲跌幅' },
  idx_KS11_ma5: { label: '韓股 5 日均線' },
  idx_KS11_ma20: { label: '韓股 20 日均線' },
  idx_KS11_slope20: { label: '韓股 20 日斜率' },
  idx_N225_pct: { label: '日經 225 當日漲跌幅' },
  idx_N225_ma5: { label: '日經 5 日均線' },
  idx_N225_ma20: { label: '日經 20 日均線' },
  idx_N225_slope20: { label: '日經 20 日斜率' },
  idx_SOX_pct: { label: '費城半導體當日漲跌幅' },
  idx_SOX_ma5: { label: '費半 5 日均線' },
  idx_SOX_ma20: { label: '費半 20 日均線' },
  idx_SOX_slope20: { label: '費半 20 日斜率' },
  idx_SSE_pct: { label: '上證指數當日漲跌幅' },
  idx_SSE_ma5: { label: '上證 5 日均線' },
  idx_SSE_ma20: { label: '上證 20 日均線' },
  idx_SSE_slope20: { label: '上證 20 日斜率' },
  idx_TWII_pct: { label: '台股加權當日漲跌幅' },
  idx_TWII_ma5: { label: '台股 5 日均線' },
  idx_TWII_ma20: { label: '台股 20 日均線' },
  idx_TWII_slope20: { label: '台股 20 日斜率' },
  idx_TWO_pct: { label: '台股櫃買當日漲跌幅' },
  idx_TWO_ma5: { label: '台股櫃買 5 日均線' },
  idx_TWO_ma20: { label: '台股櫃買 20 日均線' },
  idx_TWO_slope20: { label: '台股櫃買 20 日斜率' },
  open: { label: '開盤價' },
  high: { label: '最高價' },
  low: { label: '最低價' },
  close: { label: '收盤價' },
  volume: { label: '成交量' },
  o1: { label: '開盤 1 小時收盤價' },
  c1: { label: '收盤 1 小時收盤價' },
  pct_change: { label: '單日漲跌幅' },
  pct_change_2d: { label: '兩日累計漲跌幅' },
  up_2d: { label: '連續兩天收漲旗標' },
  slope_ma8: { label: 'MA8 斜率' },
  slope2_ma8: { label: 'MA8 二次斜率（加速度）' },
  slope_ma13: { label: 'MA13 斜率' },
  slope2_ma13: { label: 'MA13 二次斜率（加速度）' },
  slope_ma21: { label: 'MA21 斜率' },
  slope2_ma21: { label: 'MA21 二次斜率（加速度）' },
  slope_mv5: { label: 'MV5 斜率' },
  slope2_mv5: { label: 'MV5 二次斜率（加速度）' },
  slope_mv10: { label: 'MV10 斜率' },
  slope2_mv10: { label: 'MV10 二次斜率（加速度）' },
  spread_8_13: { label: 'MA8 vs MA13 價差' },
  spread_8_21: { label: 'MA8 vs MA21 價差' },
  spread_13_21: { label: 'MA13 vs MA21 價差' },
  spread_over: { label: '均線發散加權分數' },
  divergence: { label: '均線發散度（MAD/MAR/Roncalli）' },
  divergence_delta: { label: '發散度變化量' },
  alignment_score: { label: '均線排列評分' },
  alignment_state: { label: '均線排列狀態碼' },
  three_up: { label: '一過二旗標' },
  three_down: { label: '一破二旗標' },
  three_up_str: { label: '一過二強度' },
  three_down_str: { label: '一破二強度' },
  three_up_vol: { label: '帶量一過二旗標' },
  three_down_vol: { label: '帶量一破二旗標' },
  three_state: { label: '三盤狀態碼' },
  candle_long_body_up: { label: '長紅 K 線旗標' },
  candle_long_body_down: { label: '長黑 K 線旗標' },
  candle_doji: { label: '十字 K 線旗標' },
  candle_hammer: { label: '錘子 K 線旗標' },
  candle_shooting_star: { label: '流星 K 線旗標' },
  candle_engulf_up: { label: '吞噬紅 K 線旗標' },
  candle_engulf_down: { label: '吞噬黑 K 線旗標' },
  candle_morning_star: { label: '晨星反轉旗標' },
  candle_evening_star: { label: '夜星反轉旗標' },
  candle_three_white: { label: '三白兵 K 線旗標' },
  candle_three_black: { label: '三黑鴉 K 線旗標' },
  vp_master_wayne: { label: '魏本斯 M 頭 / W 底' },
  vp_master_livermore: { label: '李佛摩關鍵點突破' },
  vp_master_oneil: { label: '歐尼爾 CANSLIM 杯柄' },
  vp_master_linzeyu: { label: '林則行 1-2-3 轉折' },
  vp_8_laws_vol: { label: '量價 8 法 — 量能' },
  vp_8_laws_price: { label: '量價 8 法 — 價穩' },
  feature_config_hash: { label: '特徵配置雜湊', need: 'supporting' },
}

// Per-group defaults (used when a column isn't in COLUMN_OVERRIDES).
const GROUP_DEFAULTS: Record<string, { label: string; need: FeatureNeed }> = {
  pct: { label: '漲幅', need: 'required' },
  slope: { label: 'MA/MV 斜率', need: 'required' },
  o1c1: { label: 'O1/C1 價差', need: 'recommended' },
  rsi: { label: 'RSI 上下限均值', need: 'required' },
  kdj: { label: 'KDJ 隨機指標', need: 'required' },
  macd: { label: 'MACD 指數平滑異同移動平均', need: 'required' },
  divergence: { label: 'MA 均線發散', need: 'recommended' },
  three: { label: '三盤突破/跌破', need: 'recommended' },
  candle: { label: 'K 線形態', need: 'recommended' },
  master: { label: '大師量價指標', need: 'recommended' },
  bollinger: { label: '布林帶', need: 'recommended' },
  ema: { label: 'EMA 指數均線', need: 'required' },
  wma: { label: 'WMA 加權均線', need: 'recommended' },
  hma: { label: 'HMA 赫爾均線', need: 'recommended' },
  kama: { label: 'KAMA 自適應均線', need: 'recommended' },
  dema: { label: 'DEMA 雙重指數', need: 'recommended' },
  tema: { label: 'TEMA 三重指數', need: 'recommended' },
  vwma: { label: 'VWMA 量加權均線', need: 'recommended' },
  linearreg: { label: '線性回歸值', need: 'recommended' },
  tsf: { label: 'TSF 時序預測', need: 'supporting' },
  stochrsi: { label: 'StochRSI', need: 'recommended' },
  willr: { label: 'Williams %R', need: 'recommended' },
  ultosc: { label: '終極擺盪指標', need: 'supporting' },
  cci: { label: 'CCI 通道指數', need: 'recommended' },
  mfi: { label: 'MFI 資金流量', need: 'recommended' },
  apo: { label: 'APO 絕對振盪', need: 'supporting' },
  ppo: { label: 'PPO 百分比振盪', need: 'supporting' },
  pvo: { label: 'PVO 量能振盪', need: 'supporting' },
  roc: { label: 'ROC 變動率', need: 'supporting' },
  mom: { label: 'MOM 動量', need: 'supporting' },
  trix: { label: 'TRIX 三重平滑', need: 'supporting' },
  adx: { label: 'ADX 趨向指標', need: 'required' },
  dx: { label: 'DX 單日趨向', need: 'supporting' },
  aroon: { label: 'Aroon 阿隆指標', need: 'recommended' },
  atr: { label: 'ATR 真實波幅', need: 'recommended' },
  natr: { label: 'NATR 正規波幅', need: 'supporting' },
  stddev: { label: 'STDDEV 標準差', need: 'supporting' },
  sar: { label: 'SAR 拋物線', need: 'supporting' },
  midprice: { label: 'MIDPRICE 中點價', need: 'supporting' },
  range3: { label: '三日振幅', need: 'supporting' },
  day_high: { label: '當日高價（壓力位）', need: 'supporting' },
  day_low: { label: '當日低價（支撐位）', need: 'supporting' },
  max_n: { label: 'N 日最高', need: 'supporting' },
  min_n: { label: 'N 日最低', need: 'supporting' },
  adosc: { label: 'ADOSC 能量潮振盪', need: 'supporting' },
  cmf: { label: 'CMF 資金流指標', need: 'supporting' },
  breakout_high3: { label: '三盤突破高點', need: 'recommended' },
  new_high_n: { label: '創 N 日新高', need: 'recommended' },
  near_52w_high: { label: '近 52 週高點距離', need: 'supporting' },
  break_52w_high: { label: '突破 52 週高點旗標', need: 'recommended' },
  vol_surge: { label: '成交量暴增旗標', need: 'recommended' },
  breakout_vol_confirm: { label: '帶量突破確認', need: 'recommended' },
  pivot_break: { label: '樞紐點突破旗標', need: 'supporting' },
  line_of_least_resistance: { label: '最小阻力線旗標', need: 'supporting' },
  fly_high_vol: { label: '高飛量增旗標', need: 'supporting' },
  above_200ma: { label: '站上 200 日均線旗標', need: 'recommended' },
  weekly_slope_30: { label: '週線 30 日斜率', need: 'supporting' },
  vp_price_up_vol_up: { label: '量價齊揚', need: 'recommended' },
  vp_price_up_vol_dn: { label: '價漲量縮', need: 'supporting' },
  vp_price_dn_vol_up: { label: '價跌量增', need: 'supporting' },
  vp_price_dn_vol_dn: { label: '量價齊跌', need: 'supporting' },
  vp_top_divergence: { label: '頂部量價背離', need: 'recommended' },
  vp_bottom_divergence: { label: '底部量價背離', need: 'recommended' },
  vp_sky_vol: { label: '天量旗標', need: 'supporting' },
  vp_ground_vol: { label: '地量旗標', need: 'supporting' },
  obv: { label: 'OBV 能量潮', need: 'required' },
  vp: { label: '量價分析', need: 'recommended' },
  vp_master: { label: '大師量價綜合', need: 'recommended' },
  vp_8_laws: { label: '量價 8 法', need: 'recommended' },
  idx: { label: '國際指數', need: 'recommended' },
  idx_DJI: { label: '道瓊指數', need: 'supporting' },
  idx_GSPC: { label: '標普 500', need: 'supporting' },
  idx_HSI: { label: '恆生指數', need: 'supporting' },
  idx_IXIC: { label: '那斯達克', need: 'supporting' },
  idx_KS11: { label: '韓股綜合', need: 'supporting' },
  idx_N225: { label: '日經 225', need: 'supporting' },
  idx_SOX: { label: '費城半導體', need: 'supporting' },
  idx_SSE: { label: '上證指數', need: 'supporting' },
  idx_TWII: { label: '台股加權', need: 'supporting' },
  idx_TWO: { label: '台股櫃買', need: 'supporting' },
}

// Candidate group keys for a column — longest match wins.
function _candidateGroups(col: string): string[] {
  const groups = new Set<string>()
  for (const k of Object.keys(GROUP_DEFAULTS)) groups.add(k)
  for (const k of Object.keys(COLUMN_OVERRIDES)) groups.add(k.split('_')[0] ?? k)
  return [...groups].sort((a, b) => b.length - a.length)
}

function _groupKey(col: string): string {
  const parts = col.split('_')
  for (let i = parts.length - 1; i >= 1; i--) {
    const candidate = parts.slice(0, i).join('_')
    if (COLUMN_OVERRIDES[candidate] || GROUP_DEFAULTS[candidate]) {
      return candidate
    }
  }
  return parts[0] ?? col
}

export function lookupColumnDesc(col: string): { label: string; need: FeatureNeed } | null {
  const ov = COLUMN_OVERRIDES[col]
  if (ov) {
    const baseGroup = _groupKey(col)
    const gd = GROUP_DEFAULTS[baseGroup]
    return {
      label: ov.label,
      need: ov.need ?? gd?.need ?? 'supporting',
    }
  }
  for (const g of _candidateGroups(col)) {
    if (col === g || col.startsWith(`${g}_`)) {
      const gd = GROUP_DEFAULTS[g]
      if (gd) {
        return { label: gd.label, need: gd.need }
      }
    }
  }
  return null
}

export function lookupFeatureGroupDesc(key: string): { label: string; need: FeatureNeed; desc?: string } | null {
  const groups = getFeatureGroups()
  const item = groups.find((f) => f.key === key)
  if (!item) return null
  const gd = GROUP_DEFAULTS[key]
  return {
    label: item.label,
    need: gd?.need ?? 'recommended',
    desc: item.desc,
  }
}