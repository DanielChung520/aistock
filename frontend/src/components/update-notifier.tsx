'use client'

import { useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { RefreshCw, Download, AlertCircle, CheckCircle2 } from 'lucide-react'
import { useUpdateStore, getCurrentVersion } from '@/lib/updater'

export function UpdateNotifier() {
  const { state, downloadAndInstall, dismiss } = useUpdateStore()

  // Auto-check on mount (in production)
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') {
      // Delay to not block initial render
      const t = setTimeout(() => {
        useUpdateStore.getState().check()
      }, 5000)
      return () => clearTimeout(t)
    }
  }, [])

  const open = state.phase === 'available' || state.phase === 'ready-to-install' || state.phase === 'downloading'
  const currentVersion = getCurrentVersion()

  return (
    <Dialog open={open} onOpenChange={(o) => !o && dismiss()}>
      <DialogContent className="sm:max-w-md">
        {state.phase === 'available' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <RefreshCw className="h-5 w-5 text-primary" />
                發現新版本
              </DialogTitle>
              <DialogDescription>
                目前版本 v{currentVersion} → 新版本 v{state.version}
              </DialogDescription>
            </DialogHeader>
            {state.notes && (
              <div className="rounded-md bg-muted/50 p-3 text-xs max-h-40 overflow-y-auto">
                <div className="font-semibold mb-1">更新日誌：</div>
                <pre className="whitespace-pre-wrap font-sans">{state.notes}</pre>
              </div>
            )}
            <DialogFooter className="gap-2">
              <Button variant="ghost" onClick={dismiss}>稍後</Button>
              <Button onClick={downloadAndInstall}>
                <Download className="h-4 w-4 mr-1" />
                立即更新
              </Button>
            </DialogFooter>
          </>
        )}

        {state.phase === 'downloading' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Download className="h-5 w-5 text-primary animate-pulse" />
                下載更新中...
              </DialogTitle>
              <DialogDescription>請稍候，正在下載 v{currentVersion} → v{state.phase === 'downloading' ? state.progress + '%' : ''}</DialogDescription>
            </DialogHeader>
            <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
              <div
                className="bg-primary h-full transition-all duration-300"
                style={{ width: `${state.progress}%` }}
              />
            </div>
            <div className="text-center text-xs text-muted-foreground">{state.progress}%</div>
          </>
        )}

        {state.phase === 'ready-to-install' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                下載完成
              </DialogTitle>
              <DialogDescription>新版本已下載，應用程式即將重啟以完成安裝。</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={dismiss}>稍後重啟</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
