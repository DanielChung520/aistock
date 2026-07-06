/**
 * Config loader
 *
 * 在瀏覽器端 fetch 各 config JSON。新專案只要把 config 檔放對位置即可。
 */

import type {
  SidebarConfig,
  HeaderConfig,
  FooterConfig,
  LayoutConfig,
  ThemeConfig,
} from '../types'

const FALLBACK_SIDEBAR: SidebarConfig = { position: 'left', items: [] }
const FALLBACK_HEADER: HeaderConfig = { logo: '', left: { type: 'tabs' }, right: { items: [] } }
const FALLBACK_FOOTER: FooterConfig = { items: [] }
const FALLBACK_LAYOUT: LayoutConfig = {
  id: 'default',
  regions: {
    header: { visible: true, height: '3rem' },
    sidebarL: { visible: true, width: '3.5rem' },
    sidebarR: { visible: false },
    footer: { visible: false },
  },
}
const FALLBACK_THEME: ThemeConfig = { name: 'shadcn-default', classes: {} }

async function fetchJson<T>(path: string, fallback: T): Promise<T> {
  if (typeof window === 'undefined') return fallback
  try {
    const res = await fetch(path, { cache: 'no-cache' })
    if (!res.ok) return fallback
    return (await res.json()) as T
  } catch {
    return fallback
  }
}

export async function loadSidebar(): Promise<SidebarConfig> {
  return fetchJson('/iframe/sidebar.json', FALLBACK_SIDEBAR)
}

export async function loadHeader(): Promise<HeaderConfig> {
  return fetchJson('/iframe/header.json', FALLBACK_HEADER)
}

export async function loadFooter(): Promise<FooterConfig> {
  return fetchJson('/iframe/footer.json', FALLBACK_FOOTER)
}

export async function loadLayout(): Promise<LayoutConfig> {
  return fetchJson('/iframe/layout.json', FALLBACK_LAYOUT)
}

export async function loadTheme(): Promise<ThemeConfig> {
  return fetchJson('/iframe/theme.json', FALLBACK_THEME)
}
