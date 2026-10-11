'use client'

import { useEffect, useState } from 'react'
import { BarChart3, Monitor, Cpu, Loader2, PlugZap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useSystemSettings } from '@/hooks/use-system-settings'
import {
  PROVIDER_PRESETS,
  PROVIDER_MODELS,
  type LlmSettings,
} from '@/lib/system-settings-defaults'

const PROVIDER_OPTIONS: Array<{ value: LlmSettings['provider']; label: string }> = [
  { value: 'gemini', label: 'Gemini (Google)' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'opencode-zen', label: 'Opencode Zen' },
  { value: 'opencode-go', label: 'Opencode Go' },
  { value: 'minimax', label: 'MiniMax' },
]

interface SystemSettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

const TIME_RANGE_OPTIONS = [
  { label: '3 個月', value: 3 },
  { label: '6 個月', value: 6 },
  { label: '1 年', value: 12 },
  { label: '5 年', value: 60 },
  { label: '10 年', value: 120 },
  { label: '2010起', value: 200 },
  { label: '全部', value: 240 },
] as const

export function SystemSettingsModal({ isOpen, onClose }: SystemSettingsModalProps) {
  const { settings, updateSetting, resetSettings } = useSystemSettings()
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null)

  const testConnection = async () => {
    const llm = settings.llm
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/strategy/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          llm: {
            base_url: llm.baseUrl,
            model: llm.model,
            api_key: llm.apiKey,
            temperature: llm.temperature,
            max_tokens: Math.min(llm.maxTokens, llm.contextWindow),
          },
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { detail?: string } | null
        throw new Error(body?.detail ?? `連線失敗 (${res.status})`)
      }
      setTestResult({ ok: true })
    } catch (e) {
      setTestResult({ ok: false, error: e instanceof Error ? e.message : String(e) })
    } finally {
      setTesting(false)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="w-[95vw] max-w-lg">
        <DialogHeader>
          <DialogTitle>系統設定</DialogTitle>
          <DialogDescription>設定個股圖表預設行為與顯示偏好</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="chart" className="mt-2">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="chart" className="flex items-center gap-1.5">
              <BarChart3 className="h-4 w-4" />
              K線設定
            </TabsTrigger>
            <TabsTrigger value="general" className="flex items-center gap-1.5">
              <Monitor className="h-4 w-4" />
              一般設定
            </TabsTrigger>
          </TabsList>

          <TabsContent value="chart" className="space-y-4 pt-4">
            <div>
              <label className="text-sm font-medium mb-2 block">預設時間範圍</label>
              <div className="flex flex-wrap gap-2">
                {TIME_RANGE_OPTIONS.map((opt) => (
                  <Button
                    key={opt.value}
                    variant={settings.defaultTimeRange === opt.value ? 'default' : 'outline'}
                    size="sm"
                    className="h-8 px-3 text-xs"
                    onClick={() => updateSetting('defaultTimeRange', opt.value)}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5">
                此設定影響每次開啟個股頁面時預設顯示的日K長度
              </p>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">預設圖表樣式</label>
              <div className="flex gap-2">
                <Button
                  variant={settings.defaultChartStyle === 'candle' ? 'default' : 'outline'}
                  size="sm"
                  className="h-8 px-3 text-xs"
                  onClick={() => updateSetting('defaultChartStyle', 'candle')}
                >
                  📊 K線圖
                </Button>
                <Button
                  variant={settings.defaultChartStyle === 'line' ? 'default' : 'outline'}
                  size="sm"
                  className="h-8 px-3 text-xs"
                  onClick={() => updateSetting('defaultChartStyle', 'line')}
                >
                  📈 線圖
                </Button>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">分價圖透明度</label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={settings.volumeProfileOpacity}
                  onChange={(e) => updateSetting('volumeProfileOpacity', Number(e.target.value))}
                  className="flex-1"
                />
                <span className="text-xs font-mono w-8 text-right">{settings.volumeProfileOpacity}%</span>
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground mt-1.5">
                <span>淺透明</span>
                <span>中透明</span>
                <span>深透明</span>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="general" className="space-y-5 pt-4">
            <div>
              <h4 className="flex items-center gap-1.5 text-sm font-medium mb-1">
                <Cpu className="h-4 w-4" />
                LLM 連線（AI 選股搜尋用）
              </h4>
              <p className="text-[11px] text-muted-foreground mb-1.5">
                設定後即可在選股策略頁使用「AI 搜尋」，用自然語言描述選股條件。支援 OpenAI 相容 API（OpenAI、Gemini、Anthropic、MiniMax、Opencode Zen/Go，其中 Zen/Go 連線 dllm 本機服務）。
              </p>
              <p className="text-[10px] text-muted-foreground mb-3 rounded-md border border-dashed px-2 py-1.5">
                注意：右下角「AI 助手」為獨立的 opencode（ow）執行環境，其模型與 API Key 於 ow 內設定，不隨此處變更。
              </p>

              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">供應商</Label>
                    <select
                      className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-ring focus:ring-1 focus:ring-ring"
                      value={settings.llm.provider}
                      onChange={(e) => {
                        const provider = e.target.value as LlmSettings['provider']
                        const preset = PROVIDER_PRESETS[provider]
                        updateSetting('llm', { ...settings.llm, provider, ...preset })
                      }}
                    >
                      {PROVIDER_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">模型</Label>
                    <select
                      className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-ring focus:ring-1 focus:ring-ring"
                      value={settings.llm.model}
                      onChange={(e) =>
                        updateSetting('llm', { ...settings.llm, model: e.target.value })
                      }
                    >
                      {PROVIDER_MODELS[settings.llm.provider].map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                      {!PROVIDER_MODELS[settings.llm.provider].includes(settings.llm.model) && (
                        <option value={settings.llm.model}>{settings.llm.model}（自訂）</option>
                      )}
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Base URL</Label>
                  <Input
                    className="h-8 text-xs font-mono"
                    value={settings.llm.baseUrl}
                    onChange={(e) => updateSetting('llm', { ...settings.llm, baseUrl: e.target.value })}
                    placeholder="https://api.openai.com/v1"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">API Key</Label>
                  <Input
                    type="password"
                    className="h-8 text-xs"
                    value={settings.llm.apiKey}
                    onChange={(e) => updateSetting('llm', { ...settings.llm, apiKey: e.target.value })}
                    placeholder="sk-..."
                  />
                  <p className="text-[10px] text-muted-foreground">僅存於本機瀏覽器（localStorage），會隨請求傳給後端呼叫 LLM。</p>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px]"
                    onClick={testConnection}
                    disabled={testing}
                  >
                    {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <PlugZap className="h-3 w-3" />}
                    {testing ? '測試中…' : '測試連線'}
                  </Button>
                  {testResult && (
                    <span className={`text-[11px] ${testResult.ok ? 'text-emerald-600' : 'text-destructive'}`}>
                      {testResult.ok ? '✓ 連線成功' : `✗ ${testResult.error}`}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Context Window（輸入 token）</Label>
                    <Input
                      type="number"
                      min={1024}
                      max={262144}
                      step={1024}
                      className="h-8 text-xs"
                      value={settings.llm.contextWindow}
                      onChange={(e) => updateSetting('llm', { ...settings.llm, contextWindow: Number(e.target.value) || 8192 })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Max Tokens（輸出 token）</Label>
                    <Input
                      type="number"
                      min={256}
                      max={262144}
                      step={512}
                      className="h-8 text-xs"
                      value={settings.llm.maxTokens}
                      onChange={(e) => updateSetting('llm', { ...settings.llm, maxTokens: Number(e.target.value) || 8000 })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Temperature</Label>
                    <Input
                      type="number"
                      min={0}
                      max={2}
                      step={0.1}
                      className="h-8 text-xs"
                      value={settings.llm.temperature}
                      onChange={(e) => updateSetting('llm', { ...settings.llm, temperature: Number(e.target.value) || 0.1 })}
                    />
                  </div>
                </div>

                {/* 本機 dllm fallback：主要 LLM 失敗時自動改用本機模型 */}
                <div className="rounded-md border border-border bg-muted/30 p-3 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <Label className="text-xs">失敗時改用本機 dllm（fallback）</Label>
                      <p className="text-[10px] text-muted-foreground">
                        主要 LLM 呼叫失敗（401/逾時等）時，自動改用本機 dllm 模型，並在結果中提示。
                      </p>
                    </div>
                    <Switch
                      checked={settings.llm.fallback.enabled}
                      onCheckedChange={(checked) =>
                        updateSetting('llm', {
                          ...settings.llm,
                          fallback: { ...settings.llm.fallback, enabled: checked },
                        })
                      }
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">dllm Base URL</Label>
                      <Input
                        className="h-8 text-xs font-mono"
                        value={settings.llm.fallback.baseUrl}
                        onChange={(e) =>
                          updateSetting('llm', {
                            ...settings.llm,
                            fallback: { ...settings.llm.fallback, baseUrl: e.target.value },
                          })
                        }
                        placeholder="http://localhost:11400/v1"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">dllm 模型</Label>
                      <Input
                        className="h-8 text-xs font-mono"
                        value={settings.llm.fallback.model}
                        onChange={(e) =>
                          updateSetting('llm', {
                            ...settings.llm,
                            fallback: { ...settings.llm.fallback, model: e.target.value },
                          })
                        }
                        placeholder="Qwen3-8B-AWQ"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">dllm API Key</Label>
                    <Input
                      type="password"
                      className="h-8 text-xs font-mono"
                      value={settings.llm.fallback.apiKey}
                      onChange={(e) =>
                        updateSetting('llm', {
                          ...settings.llm,
                          fallback: { ...settings.llm.fallback, apiKey: e.target.value },
                        })
                      }
                      placeholder="dllm-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    />
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
          <Button variant="ghost" size="sm" className="text-xs" onClick={resetSettings}>
            重置為預設值
          </Button>
          <Button size="sm" onClick={onClose}>
            關閉
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
