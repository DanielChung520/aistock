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
