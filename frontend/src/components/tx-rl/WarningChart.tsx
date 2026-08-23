'use client'

import { TrendingDown, TrendingUp, Activity, Sparkles } from 'lucide-react'
import { HelpButton } from './HelpButton'
import { WARNING_MD } from './help-content'

const COLOR_BUY_HOLD = '#64748b'
const COLOR_RL = '#f59e0b'
const COLOR_MA = '#3b82f6'

const STRATEGY_BARS = [
  { name: 'Buy & Hold 0050', value: 100, color: COLOR_BUY_HOLD, icon: TrendingUp, label: '穩定基準' },
  { name: 'Buy & Hold TWII', value: 95, color: '#94a3b8', icon: TrendingUp, label: '大盤追蹤' },
  { name: 'MA5/MA20 規則', value: 45, color: COLOR_MA, icon: Activity, label: '簡單規則' },
  { name: 'TX-RL Agent', value: 25, color: COLOR_RL, icon: Sparkles, label: '預期最低/隨機' },
]

export function WarningChart() {
  return (
    <div className="shrink-0 rounded-lg border border-amber-500/40 bg-gradient-to-r from-amber-500/8 to-amber-500/3 px-4 py-3">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400">
            <TrendingDown className="h-3.5 w-3.5" />
          </span>
          <div>
            <div className="text-xs font-semibold text-amber-700 dark:text-amber-400">學術預期：學 RL 流程，不是學穩賺</div>
            <div className="text-[10px] text-amber-700/80 dark:text-amber-400/80">基於前次 ML/DL 實測 + 學術共識</div>
          </div>
        </div>
        <HelpButton title="學術預期結果（必讀）" content={WARNING_MD} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
        {STRATEGY_BARS.map((s) => {
          const Icon = s.icon
          return (
            <div key={s.name} className="flex items-center gap-1.5">
              <Icon className="h-3 w-3 shrink-0" style={{ color: s.color }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span className="truncate">{s.name}</span>
                  <span className="ml-1 shrink-0 tabular-nums">{s.label}</span>
                </div>
                <div className="h-1.5 bg-muted/40 rounded-full overflow-hidden mt-0.5">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${s.value}%`, background: s.color }}
                  />
                </div>
              </div>
            </div>
          )
        })}
      </div>
      <div className="text-[10px] text-amber-700/70 dark:text-amber-400/70 mt-2 pt-2 border-t border-amber-500/20">
        點 <span className="font-mono">?</span> icon 看每個區塊詳細解釋（Markdown） · 各圖表說明在「可視化」tab
      </div>
    </div>
  )
}
