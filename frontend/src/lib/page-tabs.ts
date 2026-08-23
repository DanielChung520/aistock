import { Home, Sparkles, ScanSearch, TableProperties, Brain, Bot, type LucideIcon } from 'lucide-react'

export interface FunctionPage {
  route: string
  title: string
  icon: LucideIcon
}

export const HOME_ROUTE = '/'

export const FUNCTION_PAGES: FunctionPage[] = [
  { route: HOME_ROUTE, title: '首頁', icon: Home },
  { route: '/strategy', title: '選股策略', icon: Sparkles },
  { route: '/patterns', title: '圖形搜索', icon: ScanSearch },
  { route: '/features', title: '生成特征值', icon: TableProperties },
  { route: '/ai-training', title: 'AI 資料訓練', icon: Brain },
  { route: '/tx-rl', title: '台指期 RL', icon: Bot },
]
