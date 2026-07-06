import { create } from 'zustand'

export type UpdateState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'available'; version: string; notes?: string }
  | { phase: 'not-available' }
  | { phase: 'downloading'; progress: number }
  | { phase: 'ready-to-install'; version: string }
  | { phase: 'error'; message: string }

interface UpdateStore {
  state: UpdateState
  check: () => Promise<void>
  downloadAndInstall: () => Promise<void>
  dismiss: () => void
}

const GITHUB_API_URL = 'https://api.github.com/repos/DanielChung520/aistock/releases/latest'

export const useUpdateStore = create<UpdateStore>((set, get) => ({
  state: { phase: 'idle' },

  check: async () => {
    set({ state: { phase: 'checking' } })
    try {
      // Tauri context
      if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
        const { check } = await import('@tauri-apps/plugin-updater')
        const update = await check()
        if (update?.available) {
          set({ state: { phase: 'available', version: update.version, notes: update.body ?? undefined } })
        } else {
          set({ state: { phase: 'not-available' } })
        }
      } else {
        // Web fallback: fetch latest release info from GitHub API (CORS-friendly)
        try {
          const res = await fetch(GITHUB_API_URL, {
            cache: 'no-store',
            headers: { 'Accept': 'application/vnd.github+json' },
          })
          if (!res.ok) {
            set({ state: { phase: 'not-available' } })
            return
          }
          const release = await res.json() as {
            tag_name?: string
            name?: string
            body?: string
            html_url?: string
            published_at?: string
          }
          // tag_name like "v0.2.0" → strip "v" prefix
          const latestVersion = (release.tag_name || '').replace(/^v/, '')
          if (!latestVersion) {
            set({ state: { phase: 'not-available' } })
            return
          }
          // 比較版本
          if (compareVersions(latestVersion, getCurrentVersion()) > 0) {
            set({
              state: {
                phase: 'available',
                version: latestVersion,
                notes: release.body || release.name,
              },
            })
          } else {
            set({ state: { phase: 'not-available' } })
          }
        } catch (e) {
          set({ state: { phase: 'not-available' } })
        }
      }
    } catch (err) {
      set({ state: { phase: 'error', message: err instanceof Error ? err.message : String(err) } })
    }
  },

  downloadAndInstall: async () => {
    set({ state: { phase: 'downloading', progress: 0 } })
    try {
      if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
        const { check } = await import('@tauri-apps/plugin-updater')
        const { relaunch } = await import('@tauri-apps/plugin-process')
        const update = await check()
        if (update?.available) {
          // Tauri 2 updater: download with progress callback
          await update.downloadAndInstall((event) => {
            if (event.event === 'Progress' && event.data) {
              const p = (event.data as { progress?: number }).progress ?? 0
              set({ state: { phase: 'downloading', progress: p } })
            }
          })
          set({ state: { phase: 'ready-to-install', version: update.version } })
          await relaunch()
        }
      } else {
        // Web fallback: just open release page
        window.open('https://github.com/DanielChung520/aistock/releases/latest', '_blank')
        const current = get().state
        if (current.phase === 'available') {
          set({ state: { phase: 'ready-to-install', version: current.version } })
        }
      }
    } catch (err) {
      set({ state: { phase: 'error', message: err instanceof Error ? err.message : String(err) } })
    }
  },

  dismiss: () => set({ state: { phase: 'idle' } }),
}))

export function getCurrentVersion(): string {
  return '0.1.0'
}

export function compareVersions(a: string, b: string): number {
  const [a1, a2, a3] = a.split('.').map(Number)
  const [b1, b2, b3] = b.split('.').map(Number)
  if (a1 !== b1) return a1 - b1
  if (a2 !== b2) return a2 - b2
  return (a3 ?? 0) - (b3 ?? 0)
}
