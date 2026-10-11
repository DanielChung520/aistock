export interface MenuItem {
  _key?: string
  title: string
  href: string
  icon?: string
  badge?: string | number
  parentKey?: string | null
  groupKey: string
  groupTitle?: string
  sortOrder: number
  isGroup: boolean
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface MenuGroup {
  key: string
  title: string
  sortOrder: number
  items: MenuItemWithChildren[]
}

export interface MenuItemWithChildren extends Omit<MenuItem, '_key'> {
  _key: string
  children?: MenuItemWithChildren[]
}

export type IndexCategory = '台股' | '亞股' | '美股'

export interface MarketIndex {
  _key?: string
  symbol: string
  yfSymbol: string
  name: string
  category: IndexCategory
  enabled: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}
