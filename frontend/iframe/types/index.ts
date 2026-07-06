/**
 * iframe/ 框架的型別定義
 *
 * 不放任何商業邏輯，只有型別。所有型別由 config 結構隱含推導。
 */

export type TabBehavior = 'switch' | 'newTab'

export interface TabItem {
  id: string
  title: string
  subtitle?: string
  route: string
  icon?: string
  meta?: Record<string, unknown>
}

export type ActionBehavior =
  | TabBehavior
  | 'modal'
  | 'drawer-left'
  | 'drawer-right'

export interface SidebarItem {
  id: string
  title: string
  icon: string
  route: string
  behavior: ActionBehavior
  tooltip?: string
  meta?: Record<string, unknown>
}

export interface SidebarConfig {
  position: 'left' | 'right'
  items: SidebarItem[]
}

export interface HeaderRightItem {
  id: string
  title: string
  icon: string
  label: string
  route?: string
  behavior: ActionBehavior
  tooltip?: string
  meta?: Record<string, unknown>
}

export interface HeaderConfig {
  logo: string
  left: {
    type: 'tabs' | 'none'
  }
  right: {
    items: HeaderRightItem[]
  }
}

export interface FooterItem {
  id: string
  text: string
}

export interface FooterConfig {
  items: FooterItem[]
}

export interface LayoutRegion {
  visible: boolean
  height?: string
  width?: string
}

export interface LayoutConfig {
  id: string
  regions: {
    header: LayoutRegion
    sidebarL: LayoutRegion
    sidebarR: LayoutRegion
    footer: LayoutRegion
  }
}

export interface ThemeConfig {
  name: string
  classes: Record<string, string>
}

export interface ModalPayload {
  id: string
  title: string
  component: string
  props?: Record<string, unknown>
}
