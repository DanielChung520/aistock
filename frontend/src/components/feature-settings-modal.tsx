'use client'

import { useEffect, useMemo, useState } from 'react'
import { Check, Search, Sparkles, Plus, ListChecks, X, LineChart, Loader2, Target } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { MarketIndex } from '@/types/menu'
import { useSystemSettings } from '@/hooks/use-system-settings'
import universeData from '@/lib/data/research-universe-ai-memory-passive.json'

// 目標項目（生成時全算，摘要顯示勾選偏好）
export const DEFAULT_TARGETS = [
  { key: 'next_return', label: '隔日漲跌幅' },
  { key: 'next_5d_return', label: '5日總漲跌幅' },
  { key: 'next_direction', label: '隔日漲跌分類' },
  { key: 'next_5d_direction', label: '5日總漲跌分類' },
] as const

export interface FeatureConfigSummary {
  stockScope: 'all' | 'selected'
  stockCount: number
  startDate: string
  endDate: string
  featureCount: number
  indexCount: number
  targetCount: number
}

const MODAL_CONFIG_KEY = 'aistock-feature-modal-config'

interface SavedModalConfig {
  selected: string[]
  allMarket: boolean
  startDate: string
  endDate: string
  features: { key: string; enabled: boolean; params: { label: string; value: string }[] }[]
  targets: string[]
}

function loadSavedConfig(): SavedModalConfig | null {
  try {
    const raw = window.localStorage.getItem(MODAL_CONFIG_KEY)
    return raw ? (JSON.parse(raw) as SavedModalConfig) : null
  } catch {
    return null
  }
}

function saveModalConfig(cfg: SavedModalConfig) {
  try {
    window.localStorage.setItem(MODAL_CONFIG_KEY, JSON.stringify(cfg))
  } catch {
    // ignore storage quota errors
  }
}

interface FeatureSettingsModalProps {
  isOpen: boolean
  onClose: () => void
  onJobStarted?: (jobId: string) => void
  onConfigChange?: (summary: FeatureConfigSummary) => void
}

interface UniverseStock {
  stock_id: string
  name: string
  tags: string[]
  market: string
}

interface AiSuggestion {
  stock_id: string
  name: string
  reason: string
}

const ALL_STOCKS: UniverseStock[] = universeData.stocks

const RANGE_PRESETS = [
  { label: '近1年', years: 1 },
  { label: '近2年', years: 2 },
  { label: '近3年', years: 3 },
  { label: '近5年', years: 5 },
]

interface FeatureItem {
  key: string
  label: string
  enabled: boolean
  params: { label: string; value: string }[]
  kind: 'params' | 'none'
  desc?: string
}

// 對齊 .docs/charact.md 第九章欄位群組（v1）
export const DEFAULT_FEATURES: FeatureItem[] = [
  { key: 'pct', label: '漲幅', enabled: true, kind: 'none', params: [], desc: '單日漲幅、兩日累計漲幅、連續兩天收漲' },
  { key: 'slope', label: 'MA/MV 斜率', enabled: true, kind: 'params', params: [{ label: 'MA 週期', value: '8,13,21' }, { label: 'MV 週期', value: '5,10' }], desc: '一次與二次斜率（動能 + 加速度）' },
  { key: 'o1c1', label: 'O1/C1 價差', enabled: true, kind: 'none', params: [], desc: '開盤 1 小時 / 收盤 1 小時與收盤價之差（盤中強弱）' },
  { key: 'rsi', label: 'RSI 上下限均值', enabled: true, kind: 'params', params: [{ label: '週期', value: '14' }, { label: '超買線', value: '70' }, { label: '超賣線', value: '30' }], desc: '標準化位置、距超買/超賣線距離' },
  { key: 'kdj', label: 'KDJ', enabled: true, kind: 'params', params: [{ label: '週期', value: '9' }, { label: 'K 平滑', value: '3' }, { label: 'D 平滑', value: '3' }], desc: 'K/D/J、交叉、近 20 日高低價旗標' },
  { key: 'macd', label: 'MACD', enabled: true, kind: 'params', params: [{ label: '快', value: '12' }, { label: '慢', value: '26' }, { label: '訊號', value: '9' }], desc: 'DIF/DEA/柱、標準化柱體、250 日分位、交叉訊號' },
  { key: 'divergence', label: 'MA 均線發散', enabled: true, kind: 'params', params: [{ label: 'MA 週期', value: '8,13,21' }], desc: 'spread / divergence / alignment（MAD/MAR/Roncalli 加權）' },
  { key: 'three', label: '三盤突破/跌破', enabled: true, kind: 'none', params: [], desc: '一過二 / 一破二、突破幅度、帶量版' },
  { key: 'candle', label: 'K 線形態', enabled: true, kind: 'none', params: [], desc: '11 種酒田形態（長紅/十字/錘子/吞噬/晨星…）' },
  { key: 'master', label: '大師量價指標', enabled: true, kind: 'none', params: [], desc: '歐尼爾/李佛摩/林則行/量價 8 法/OBV/VR' },
  { key: 'bollinger', label: '布林帶', enabled: true, kind: 'params', params: [{ label: '週期', value: '20' }, { label: '標準差', value: '2' }], desc: '帶寬、%B（v2 起預設開啟）' },
  // ── 擴充群組 v2（全指標引擎） ──
  { key: 'ema', label: 'EMA 指數均線', enabled: true, kind: 'params', params: [{ label: 'MA 週期', value: '8,13,21,34' }], desc: '4 週期 + 斜率 + 二次斜率 + 成對 spread + alignment' },
  { key: 'wma', label: 'WMA 加權均線', enabled: true, kind: 'params', params: [{ label: 'MA 週期', value: '8,13,21,34' }], desc: '同上模板（線性加權）' },
  { key: 'hma', label: 'HMA 赫爾均線', enabled: true, kind: 'params', params: [{ label: 'MA 週期', value: '8,13,21,34' }], desc: '同上模板（減少滯後）' },
  { key: 'kama', label: 'KAMA 自適應均線', enabled: true, kind: 'params', params: [{ label: 'MA 週期', value: '8,13,21,34' }], desc: '同上模板（依市場效率調整）' },
  { key: 'dema', label: 'DEMA 雙重指數', enabled: true, kind: 'params', params: [{ label: 'MA 週期', value: '8,13,21,34' }], desc: '同上模板' },
  { key: 'tema', label: 'TEMA 三重指數', enabled: true, kind: 'params', params: [{ label: 'MA 週期', value: '8,13,21,34' }], desc: '同上模板' },
  { key: 'vwma', label: 'VWMA 量加權均線', enabled: true, kind: 'params', params: [{ label: 'MA 週期', value: '8,13,21,34' }], desc: '同上模板（成交量加權）' },
  { key: 'linearreg', label: '線性回歸值', enabled: true, kind: 'params', params: [{ label: 'MA 週期', value: '8,13,21,34' }], desc: '回歸擬合趨勢 + 斜率/二次斜率 + 成對 spread' },
  { key: 'tsf', label: 'TSF 時序預測', enabled: true, kind: 'params', params: [{ label: 'MA 週期', value: '8,13,21,34' }], desc: '回歸外推 + 衍生（同上模板）' },
  { key: 'stochrsi', label: 'StochRSI', enabled: true, kind: 'none', params: [], desc: 'RSI 的隨機值 %K/%D + 黃金/死亡交叉' },
  { key: 'willr', label: 'Williams %R', enabled: true, kind: 'none', params: [], desc: '威廉指標 + 分位/斜率/交叉' },
  { key: 'ultosc', label: '終極擺盪', enabled: true, kind: 'none', params: [], desc: '7/14/28 三重時窗加權' },
  { key: 'cci', label: 'CCI 通道指數', enabled: true, kind: 'none', params: [], desc: '商品通道指數 + 衍生' },
  { key: 'mfi', label: 'MFI 資金流量', enabled: true, kind: 'none', params: [], desc: '量價資金流（RSI 的量能版）' },
  { key: 'apo', label: 'APO 絕對振盪', enabled: true, kind: 'none', params: [], desc: 'EMA(12)-EMA(26)' },
  { key: 'ppo', label: 'PPO 百分比振盪', enabled: true, kind: 'none', params: [], desc: '價格動能百分比' },
  { key: 'pvo', label: 'PVO 量能振盪', enabled: true, kind: 'none', params: [], desc: '成交量動能百分比' },
  { key: 'roc', label: 'ROC 變動率', enabled: true, kind: 'none', params: [], desc: 'N 日變動率 + 交叉' },
  { key: 'mom', label: 'MOM 動量', enabled: true, kind: 'none', params: [], desc: 'N 日價格差動量' },
  { key: 'trix', label: 'TRIX 三重平滑', enabled: true, kind: 'none', params: [], desc: '三重 EMA 動能 + 交叉' },
  { key: 'adx', label: 'ADX 趨向指標', enabled: true, kind: 'none', params: [], desc: '趨勢強度 + 分位/斜率' },
  { key: 'dx', label: 'DX 單日趨向', enabled: true, kind: 'none', params: [], desc: 'ADX 的前身（未平滑）' },
  { key: 'aroon', label: 'Aroon 阿隆', enabled: true, kind: 'none', params: [], desc: 'UP/DOWN/振盪/交叉' },
  { key: 'atr', label: 'ATR 真實波幅', enabled: true, kind: 'none', params: [], desc: '波動率 + 對價比 + 分位' },
  { key: 'natr', label: 'NATR 正規波幅', enabled: true, kind: 'none', params: [], desc: 'ATR/價 百分比化' },
  { key: 'stddev', label: 'STDDEV 標準差', enabled: true, kind: 'none', params: [], desc: 'N 日波動 + 分位' },
  { key: 'sar', label: 'SAR 拋物線', enabled: true, kind: 'none', params: [], desc: '趨勢轉向系統 + 衍生' },
  { key: 'midprice', label: 'MIDPRICE 中點價', enabled: true, kind: 'none', params: [], desc: 'N 日高低中點' },
  { key: 'range3', label: '三日振幅', enabled: true, kind: 'none', params: [], desc: '窄幅整理偵測' },
  { key: 'day_high', label: '當日高價', enabled: true, kind: 'none', params: [], desc: '壓力位' },
  { key: 'day_low', label: '當日低價', enabled: true, kind: 'none', params: [], desc: '支撐位' },
  { key: 'max_n', label: 'N 日最高', enabled: true, kind: 'none', params: [], desc: '近 20 日壓力位' },
  { key: 'min_n', label: 'N 日最低', enabled: true, kind: 'none', params: [], desc: '近 20 日支撐位' },
  { key: 'adosc', label: 'ADOSC 量能振盪', enabled: true, kind: 'none', params: [], desc: '蔡金 A/D 振盪' },
  { key: 'cmf', label: 'CMF 資金流', enabled: true, kind: 'none', params: [], desc: '蔡金資金流乘數' },
  { key: 'breakout_high3', label: '3 日高點突破', enabled: true, kind: 'none', params: [], desc: '突破前三日高點 + 近 10 日次數' },
  { key: 'new_high_n', label: 'N 日收盤新高', enabled: true, kind: 'none', params: [], desc: '創近 20 日收盤新高' },
  { key: 'bollinger_squeeze', label: '布林壓縮噴出', enabled: true, kind: 'none', params: [], desc: '帶寬壓縮 + 突破上/下軌方向' },
]

export function FeatureSettingsModal({ isOpen, onClose, onJobStarted, onConfigChange }: FeatureSettingsModalProps) {
  const saved = useMemo(loadSavedConfig, [])
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(saved?.selected ?? ALL_STOCKS.slice(0, 6).map((s) => s.stock_id))
  )
  const [allMarket, setAllMarket] = useState<boolean>(saved?.allMarket ?? false)
  const [search, setSearch] = useState('')
  const [startDate, setStartDate] = useState<string>(saved?.startDate ?? '2024-08-01')
  const [endDate, setEndDate] = useState<string>(saved?.endDate ?? '2026-08-07')
  const [activePreset, setActivePreset] = useState<string | null>('近2年')
  const [features, setFeatures] = useState<FeatureItem[]>(() => {
    if (!saved?.features) return DEFAULT_FEATURES
    return DEFAULT_FEATURES.map((f) => {
      const savedF = saved.features.find((s) => s.key === f.key)
      return savedF ? { ...f, enabled: savedF.enabled, params: savedF.params } : f
    })
  })
  const [indices, setIndices] = useState<MarketIndex[]>([])
  const [targets, setTargets] = useState<Set<string>>(
    () => new Set(saved?.targets ?? DEFAULT_TARGETS.map((t) => t.key))
  )
  const { settings: sysSettings } = useSystemSettings()
  const [aiOpen, setAiOpen] = useState(false)
  const [aiDesc, setAiDesc] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiSuggestions, setAiSuggestions] = useState<AiSuggestion[]>([])
  const [genStatus, setGenStatus] = useState<'idle' | 'running' | 'completed' | 'failed'>('idle')

  // 設定變更時持久化到 localStorage（刷新後恢復）
  useEffect(() => {
    saveModalConfig({
      selected: Array.from(selected),
      allMarket,
      startDate,
      endDate,
      features: features.map((f) => ({ key: f.key, enabled: f.enabled, params: f.params })),
      targets: Array.from(targets),
    })
  }, [selected, allMarket, startDate, endDate, features, targets])

  // 每次設定變更時回報摘要給主頁（供摘要卡片顯示）
  useEffect(() => {
    if (!isOpen || !onConfigChange) return
    onConfigChange({
      stockScope: allMarket ? 'all' : 'selected',
      stockCount: allMarket ? 1946 : selected.size,
      startDate,
      endDate,
      featureCount: features.filter((f) => f.enabled).length,
      indexCount: indices.filter((i) => i.enabled).length,
      targetCount: targets.size,
    })
  }, [isOpen, allMarket, selected, startDate, endDate, features, indices, targets, onConfigChange])
  const [genError, setGenError] = useState<string | null>(null)
  const [rowsWritten, setRowsWritten] = useState(0)

  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    fetch('/api/market-indices')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('載入指數清單失敗'))))
      .then((data) => {
        if (!cancelled) setIndices(data.indices || [])
      })
      .catch((error) => console.error(error))
    return () => {
      cancelled = true
    }
  }, [isOpen])

  const toggleIndex = (key: string, enabled: boolean) => {
    setIndices((prev) =>
      prev.map((idx) =>
        idx._key === key ? { ...idx, enabled } : idx
      )
    )
  }

  const saveIndexEnabled = async (key: string, enabled: boolean) => {
    try {
      const res = await fetch('/api/market-indices', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _key: key, enabled }),
      })
      if (!res.ok) throw new Error('Failed to update index status')
    } catch (error) {
      console.error(error)
    }
  }

  const filteredStocks = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return ALL_STOCKS
    return ALL_STOCKS.filter(
      (s) => s.stock_id.includes(q) || s.name.toLowerCase().includes(q)
    )
  }, [search])

  const runAiSuggest = async () => {
    const desc = aiDesc.trim()
    if (!desc || aiLoading) return
    setAiLoading(true)
    setAiError(null)
    try {
      const res = await fetch('/api/strategy/ai-suggest-stocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: desc,
          universe: ALL_STOCKS.map(({ stock_id, name, tags, market }) => ({
            stock_id,
            name,
            tags,
            market,
          })),
          llm: {
            base_url: sysSettings.llm.baseUrl,
            model: sysSettings.llm.model,
            api_key: sysSettings.llm.apiKey,
            temperature: sysSettings.llm.temperature,
            max_tokens: Math.min(sysSettings.llm.maxTokens, sysSettings.llm.contextWindow),
          },
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { detail?: string } | null
        throw new Error(body?.detail ?? `AI 建議失敗 (${res.status})`)
      }
      const json = (await res.json()) as { suggestions: AiSuggestion[] }
      setAiSuggestions(json.suggestions)
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e))
    } finally {
      setAiLoading(false)
    }
  }

  const toggleStock = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleFeature = (key: string) => {
    setFeatures((prev) => prev.map((f) => (f.key === key ? { ...f, enabled: !f.enabled } : f)))
  }

  const toggleTarget = (key: string) => {
    setTargets((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const updateFeatureParam = (key: string, paramLabel: string, value: string) => {
    setFeatures((prev) =>
      prev.map((f) =>
        f.key === key
          ? {
              ...f,
              params: f.params.map((p) =>
                p.label === paramLabel ? { ...p, value } : p
              ),
            }
          : f
      )
    )
  }

  const handleGenerate = async () => {
    if (!allMarket && selected.size === 0) {
      setGenError('請先選擇至少一檔股票（或切換為全市場）')
      setGenStatus('failed')
      return
    }
    setGenStatus('running')
    setGenError(null)

    const featuresConfig: Record<string, { enabled: boolean; params: Record<string, string> }> = {}
    for (const f of features) {
      featuresConfig[f.key] = {
        enabled: f.enabled,
        params: Object.fromEntries(f.params.map((p) => [p.label, p.value])),
      }
    }

    try {
      const res = await fetch('/api/features/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stock_ids: allMarket ? [] : Array.from(selected),
          universe: allMarket ? 'all' : '',
          start_date: startDate,
          end_date: endDate,
          features: featuresConfig,
          indices: indices.filter((i) => i.enabled).map((i) => i._key).filter((k): k is string => Boolean(k)),
        }),
      })
      const body = (await res.json()) as {
        job_id?: string
        error?: string
        detail?: string
      }
      if (!res.ok) {
        throw new Error(body.error ?? body.detail ?? `生成請求失敗 (${res.status})`)
      }
      if (!body.job_id) throw new Error('後端未回傳 job_id')
      // 回報 job 給主頁承接進度，關閉設定彈窗
      onJobStarted?.(body.job_id!)
      setGenStatus('completed')
      setRowsWritten(0)
      onClose()
    } catch (e) {
      setGenStatus('failed')
      setGenError(e instanceof Error ? e.message : String(e))
    }
  }

  const enabledCount = features.filter((f) => f.enabled).length

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[calc(55vw-1rem)] h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>生成特征值設定</DialogTitle>
          <DialogDescription>設定股票清單、生成區間與特徵值項目參數</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="stocks" className="flex-1 min-h-0 flex flex-col">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="stocks">股票清單</TabsTrigger>
            <TabsTrigger value="range">生成區間</TabsTrigger>
            <TabsTrigger value="features">特徵值項目</TabsTrigger>
            <TabsTrigger value="targets">目標項目</TabsTrigger>
            <TabsTrigger value="indices">指數清單</TabsTrigger>
          </TabsList>

          {/* ── 股票清單 ── */}
          <TabsContent value="stocks" className="flex-1 min-h-0 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant={allMarket ? 'default' : 'outline'}
                className="gap-1.5"
                onClick={() => setAllMarket((v) => !v)}
              >
                <ListChecks className="h-3.5 w-3.5" />
                {allMarket ? '全市場 (1,946 檔)' : '切換全市場'}
              </Button>
              <Button
                size="sm"
                className="gap-1.5"
                onClick={() => setAiOpen((v) => !v)}
              >
                <Sparkles className="h-3.5 w-3.5" />
                AI 建議清單
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => setSelected(new Set(ALL_STOCKS.map((s) => s.stock_id)))}
              >
                <ListChecks className="h-3.5 w-3.5" />
                全部選取
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => setSelected(new Set())}
              >
                <X className="h-3.5 w-3.5" />
                清除
              </Button>
              <div className="relative ml-auto w-40">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜尋股票"
                  className="pl-8 h-8 text-sm"
                />
              </div>
            </div>

            {aiOpen && (
              <div className="flex flex-col gap-2 rounded-md border bg-muted/40 p-3">
                <div className="flex items-center gap-2">
                  <Input
                    value={aiDesc}
                    onChange={(e) => setAiDesc(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && runAiSuggest()}
                    placeholder="向 AI 描述想找的股票，例如：大約是 2317 相當的股票"
                    className="h-8 flex-1 text-sm"
                  />
                  <Button
                    size="sm"
                    className="gap-1.5 shrink-0"
                    onClick={runAiSuggest}
                    disabled={aiLoading}
                  >
                    {aiLoading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    送出
                  </Button>
                </div>
                {aiError && <p className="text-xs text-destructive">{aiError}</p>}
                {aiSuggestions.length > 0 && (
                  <div className="flex flex-col gap-0.5">
                    <p className="text-xs text-muted-foreground">
                      AI 建議 {aiSuggestions.length} 檔，點選加入勾選：
                    </p>
                    {aiSuggestions.map((s) => (
                      <label
                        key={s.stock_id}
                        className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted cursor-pointer"
                      >
                        <Checkbox
                          checked={selected.has(s.stock_id)}
                          onCheckedChange={() => toggleStock(s.stock_id)}
                        />
                        <span className="font-mono text-xs text-muted-foreground w-12">{s.stock_id}</span>
                        <span className="text-sm">{s.name}</span>
                        <span className="flex-1 truncate text-xs text-muted-foreground">{s.reason}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            <ScrollArea className="flex-1 min-h-0 rounded-md border">
              <div className="p-2 space-y-0.5">
                {filteredStocks.map((s) => (
                  <label
                    key={s.stock_id}
                    className="flex items-center gap-3 rounded-md px-2.5 py-2 text-sm hover:bg-muted cursor-pointer"
                  >
                    <Checkbox
                      checked={selected.has(s.stock_id)}
                      onCheckedChange={() => toggleStock(s.stock_id)}
                    />
                    <span className="font-mono text-xs text-muted-foreground w-12">{s.stock_id}</span>
                    <span className="flex-1 truncate">{s.name}</span>
                    <Badge variant="secondary" className="gap-0.5">
                      {s.market}
                    </Badge>
                  </label>
                ))}
              </div>
            </ScrollArea>
            <p className="text-xs text-muted-foreground">已選取 {selected.size} 檔（共 {ALL_STOCKS.length} 檔）</p>
          </TabsContent>

          {/* ── 生成區間 ── */}
          <TabsContent value="range" className="flex-1 min-h-0 flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="feature-start">起始日期</Label>
                <Input id="feature-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="feature-end">結束日期</Label>
                <Input id="feature-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">快捷：</span>
              {RANGE_PRESETS.map((p) => (
                <Button
                  key={p.label}
                  size="sm"
                  variant={activePreset === p.label ? 'default' : 'outline'}
                  onClick={() => setActivePreset(p.label)}
                >
                  {p.label}
                </Button>
              ))}
            </div>
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              資料庫可及範圍 2016-08-01 ~ 2026-08-07（10 年 OHLCV + 2 年 O1/C1）
            </div>
          </TabsContent>

          {/* ── 特徵值項目 ── */}
          <TabsContent value="features" className="flex-1 min-h-0 flex flex-col gap-3">
            <ScrollArea className="flex-1 min-h-0 rounded-md border">
              <div className="grid grid-cols-2">
                {features.map((f) => (
                  <div key={f.key} className="flex items-start gap-3 px-3 py-2.5 border-b border-r border-border even:border-r-0">
                    <Switch checked={f.enabled} onCheckedChange={() => toggleFeature(f.key)} className="mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-medium">{f.label}</span>
                        {f.desc && <span className="text-xs text-muted-foreground truncate">{f.desc}</span>}
                      </div>
                      {f.kind === 'params' ? (
                        <div className="mt-1.5 flex flex-wrap gap-2">
                          {f.params.map((p) => (
                            <div key={p.label} className="flex items-center gap-1.5">
                              <span className="text-xs text-muted-foreground">{p.label}</span>
                              <Input
                                value={p.value}
                                onChange={(e) => updateFeatureParam(f.key, p.label, e.target.value)}
                                className="h-7 w-[4.8rem] text-xs"
                                disabled={!f.enabled}
                              />
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
            <Button variant="outline" size="sm" className="gap-1.5 self-start">
              <Plus className="h-3.5 w-3.5" />
              新增特徵值項目
            </Button>
            <p className="text-xs text-muted-foreground">已啟用 {enabledCount} 項</p>
          </TabsContent>

          {/* ── 目標項目 ── */}
          <TabsContent value="targets" className="flex-1 min-h-0 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">
                預測目標（生成時全算 4 個，此處為顯示偏好）
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {DEFAULT_TARGETS.map((t) => (
                <label
                  key={t.key}
                  className="flex items-center gap-3 rounded-md border px-3 py-2.5 cursor-pointer hover:bg-muted"
                >
                  <Checkbox
                    checked={targets.has(t.key)}
                    onCheckedChange={() => toggleTarget(t.key)}
                  />
                  <div>
                    <div className="text-sm font-medium">{t.label}</div>
                    <div className="text-xs text-muted-foreground font-mono">{t.key}</div>
                  </div>
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">已選擇 {targets.size} / {DEFAULT_TARGETS.length} 個目標</p>
          </TabsContent>

          {/* ── 指數清單 ── */}
          <TabsContent value="indices" className="flex-1 min-h-0 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <LineChart className="h-4 w-4 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">
                市場環境指數（台/亞/美股），每日增量下載 2 年窗口，作為特徵值市場維度
              </p>
            </div>
            <ScrollArea className="flex-1 min-h-0 rounded-md border">
              <div className="divide-y divide-border">
                {indices.map((idx) => (
                  <div key={idx._key} className="flex items-center gap-3 px-3 py-2.5">
                    <Switch
                      checked={idx.enabled}
                        onCheckedChange={(checked) => {
                          toggleIndex(idx._key!, checked)
                          saveIndexEnabled(idx._key!, checked)
                        }}
                      />
                      <span className="font-mono text-xs text-muted-foreground w-16">{idx.symbol}</span>
                      <span className="flex-1 min-w-0 truncate text-sm font-medium">{idx.name}</span>
                      <Badge variant="secondary">{idx.category}</Badge>
                      <span className="font-mono text-[11px] text-muted-foreground hidden sm:inline">
                        {idx.yfSymbol}
                      </span>
                    </div>
                  ))}
                  {indices.length === 0 && (
                    <p className="px-3 py-4 text-center text-xs text-muted-foreground">載入中…</p>
                  )}
                </div>
              </ScrollArea>
            <p className="text-xs text-muted-foreground">
              已啟用 {indices.filter((i) => i.enabled).length} 檔（共 {indices.length} 檔）。增刪指數請至「功能設置 → 指數清單」。
            </p>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            onClick={handleGenerate}
            disabled={genStatus === 'running' || genStatus === 'completed'}
            className="gap-1.5"
          >
            {genStatus === 'running' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {genStatus === 'running'
              ? '生成中…'
              : genStatus === 'completed'
                ? '完成'
                : genStatus === 'failed'
                  ? '重試'
                  : '開始生成'}
          </Button>
          <Button onClick={onClose} className="gap-1.5">
            <Check className="h-4 w-4" />
            保存
          </Button>
        </DialogFooter>
        {genStatus !== 'idle' && (
          <div
            className={
              genStatus === 'failed'
                ? 'px-6 pb-4 text-xs text-destructive'
                : 'px-6 pb-4 text-xs text-muted-foreground'
            }
          >
            {genStatus === 'running'
              ? '正在生成特徵值…'
              : genStatus === 'completed'
                ? `生成完成，寫入 ${rowsWritten} 筆`
                : genError}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
