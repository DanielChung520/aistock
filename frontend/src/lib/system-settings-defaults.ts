// 共享的系統設定常數與型別 — 同時給 client hook 與 server API route 使用（不含 'use client'）

export type LlmProvider = 'openai' | 'gemini' | 'anthropic' | 'opencode-zen' | 'opencode-go' | 'minimax'

export interface LlmFallbackSettings {
  enabled: boolean // 主要 LLM 失敗時自動改用本機 dllm
  baseUrl: string // dllm 服務位址（預設 http://localhost:11400/v1）
  model: string // dllm 模型（預設 Qwen3-8B-AWQ）
  apiKey: string // dllm 專用 key（Bearer token）
}

export interface LlmSettings {
  provider: LlmProvider
  baseUrl: string
  model: string
  apiKey: string
  contextWindow: number // max input tokens
  maxTokens: number // max output tokens
  temperature: number // 0-2
  fallback: LlmFallbackSettings
}

export interface SystemSettings {
  version: number
  defaultTimeRange: number // months: 6 | 12 | 60 | 120 | 200 | 240
  defaultChartStyle: 'candle' | 'line'
  volumeProfileOpacity: number // 0-100, default 30
  llm: LlmSettings
}

export const STORAGE_KEY = 'aistock-system-settings'
export const SETTINGS_DOC_KEY = 'system'
export const SETTINGS_COLLECTION = 'system_settings'
export const CURRENT_VERSION = 4

export const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  version: CURRENT_VERSION,
  defaultTimeRange: 200, // 2010-01 起（約 200 個月）
  defaultChartStyle: 'candle',
  volumeProfileOpacity: 30,
  llm: {
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    apiKey: '',
    contextWindow: 8192,
    maxTokens: 8000,
    temperature: 0.1,
    fallback: {
      enabled: true,
      baseUrl: 'http://localhost:11400/v1',
      model: 'Qwen3-8B-AWQ',
      apiKey: '',
    },
  },
}

// provider → base_url + 預設模型（模型清單依供應商可再擴充）
export const PROVIDER_PRESETS: Record<LlmProvider, { baseUrl: string; model: string }> = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-5.6-terra' },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.6-flash' },
  anthropic: { baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5' },
  'opencode-zen': { baseUrl: 'http://localhost:11400/v1', model: 'Qwen3-8B-AWQ' },
  'opencode-go': { baseUrl: 'http://localhost:11400/v1', model: 'Qwen3-8B-AWQ' },
  minimax: { baseUrl: 'https://api.minimax.io/v1', model: 'MiniMax-M3' },
}

// provider → 可選模型清單（設定 UI 下拉選單用）
// Opencode Zen / Go fallback 為 dllm（/home/daniel/github/dllm）本機模型清單
export const PROVIDER_MODELS: Record<LlmProvider, string[]> = {
  openai: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5'],
  gemini: ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-pro', 'gemini-3-flash'],
  anthropic: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5', 'claude-fable-5'],
  'opencode-zen': ['Qwen3-8B-AWQ', 'Qwen3-0.6B', 'Qwen2.5-VL-7B-Instruct', 'Qwen2.5-0.5B-Instruct'],
  'opencode-go': ['Qwen3-8B-AWQ', 'Qwen3-0.6B', 'Qwen2.5-VL-7B-Instruct', 'Qwen2.5-0.5B-Instruct'],
  minimax: ['MiniMax-M3', 'MiniMax-M2.7', 'MiniMax-M2.7-highspeed', 'MiniMax-M2.5', 'MiniMax-M2'],
}

export function isSystemSettings(value: unknown): value is SystemSettings {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.version === 'number' &&
    typeof v.defaultTimeRange === 'number' &&
    (v.defaultChartStyle === 'candle' || v.defaultChartStyle === 'line') &&
    typeof v.volumeProfileOpacity === 'number' &&
    typeof v.llm === 'object' &&
    v.llm !== null
  )
}

export function migrateSettings(parsed: unknown): SystemSettings | null {
  if (!isSystemSettings(parsed)) return null
  const src = parsed as SystemSettings
  // 白名單挑欄位，避免 spread 帶入 _key/_rev/updatedAt 等 DB 附加欄位
  const base: SystemSettings = {
    version: CURRENT_VERSION,
    defaultTimeRange: src.defaultTimeRange,
    defaultChartStyle: src.defaultChartStyle,
    volumeProfileOpacity: src.volumeProfileOpacity,
    llm: {
      ...DEFAULT_SYSTEM_SETTINGS.llm,
      ...src.llm,
      fallback: {
        ...DEFAULT_SYSTEM_SETTINGS.llm.fallback,
        ...(src.llm?.fallback ?? {}),
      },
    },
  }
  // 確保 provider 在合法清單內（v2 之前只有 openai/gemini/ollama/custom）
  if (!(base.llm.provider in PROVIDER_PRESETS)) {
    base.llm.provider = DEFAULT_SYSTEM_SETTINGS.llm.provider
  }
  return base
}
