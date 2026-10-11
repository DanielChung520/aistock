'use client'

import Link from 'next/link'
import { FileText, FileType, Upload, Calendar, Search, Filter, Loader2, AlertCircle, Database, Network } from 'lucide-react'
import { AppShell } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { getAllKnowledge, type Knowledge } from './_data/mock-knowledge'

const FILE_TYPE_LABELS = {
  pdf: { label: 'PDF', color: 'bg-red-500/15 text-red-300 border-red-500/30' },
  docx: { label: 'DOCX', color: 'bg-blue-500/15 text-blue-300 border-blue-500/30' },
  md: { label: 'MD', color: 'bg-purple-500/15 text-purple-300 border-purple-500/30' },
  txt: { label: 'TXT', color: 'bg-slate-500/15 text-slate-300 border-slate-500/30' },
  html: { label: 'HTML', color: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
} as const

const STATUS_BADGES = {
  pending: { label: '待處理', variant: 'outline' as const, icon: ClockIcon },
  processing: { label: '處理中', variant: 'secondary' as const, icon: Loader2 },
  ready: { label: '已就緒', variant: 'default' as const, icon: null },
  failed: { label: '失敗', variant: 'destructive' as const, icon: AlertCircle },
}

function ClockIcon({ className }: { className?: string }) {
  return <span className={className}>⏱</span>
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const hours = Math.floor(diff / (1000 * 60 * 60))
  if (hours < 1) return '剛剛'
  if (hours < 24) return `${hours} 小時前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return new Date(iso).toLocaleDateString('zh-TW')
}

function KnowledgeCard({ k }: { k: Knowledge }) {
  const fileType = FILE_TYPE_LABELS[k.file_type]
  const status = STATUS_BADGES[k.status]
  const StatusIcon = status.icon
  const isReady = k.status === 'ready'

  return (
    <Link href={`/admin/knowledge/${k.id}`}>
      <Card className="h-full hover:border-primary/50 hover:shadow-md transition-all group cursor-pointer">
        <CardContent className="p-5 flex flex-col h-full gap-3">
          {/* Header: file type badge + status */}
          <div className="flex items-center justify-between">
            <Badge variant="outline" className={`text-xs font-mono ${fileType.color}`}>
              {fileType.label}
            </Badge>
            <Badge variant={status.variant} className="text-xs">
              {StatusIcon && <StatusIcon className="h-3 w-3 mr-1" />}
              {status.label}
            </Badge>
          </div>

          {/* Title */}
          <h3 className="text-base font-semibold leading-snug line-clamp-2 group-hover:text-primary transition-colors">
            {k.title}
          </h3>

          {/* Preview snippet */}
          {isReady && k.preview_text && (
            <p className="text-sm text-muted-foreground line-clamp-3 leading-relaxed">
              「{k.preview_text}」
            </p>
          )}

          {!isReady && (
            <p className="text-sm text-muted-foreground italic">
              {k.status === 'processing' ? '處理中，請稍候...' : '尚未處理'}
            </p>
          )}

          {/* Tags */}
          <div className="flex flex-wrap gap-1 mt-auto">
            {k.tags.slice(0, 3).map((tag) => (
              <Badge key={tag} variant="secondary" className="text-[10px] font-normal">
                {tag}
              </Badge>
            ))}
          </div>

          {/* Footer: stats + meta */}
          <div className="flex items-center justify-between text-[11px] text-muted-foreground border-t border-border/50 pt-3 mt-1">
            <div className="flex items-center gap-3">
              {isReady && (
                <>
                  <span className="flex items-center gap-1" title="chunks">
                    <Database className="h-3 w-3" />
                    {k.chunk_count}
                  </span>
                  <span className="flex items-center gap-1" title="entities">
                    <Network className="h-3 w-3" />
                    {k.entity_count}
                  </span>
                  {k.figure_count > 0 && (
                    <span className="flex items-center gap-1" title="figures">
                      <FileType className="h-3 w-3" />
                      {k.figure_count}
                    </span>
                  )}
                </>
              )}
            </div>
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {timeAgo(k.uploaded_at)}
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}

export default function KnowledgeListPage() {
  const knowledgeList = getAllKnowledge()

  return (
    <AppShell title="知識列表">
      <div className="flex h-full flex-col gap-3 p-4 md:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="搜尋知識標題、內容、標籤..." className="pl-9 h-9" />
          </div>
          <Button variant="outline" size="sm" className="h-9">
            <Filter className="h-3.5 w-3.5 mr-1" />
            篩選
          </Button>
          <div className="flex items-center gap-1 rounded-md border border-border bg-background p-0.5">
            <Button size="sm" variant="default" className="h-7">
              全部
            </Button>
            <Button size="sm" variant="ghost" className="h-7">
              已就緒
            </Button>
            <Button size="sm" variant="ghost" className="h-7">
              處理中
            </Button>
          </div>
          <Badge variant="secondary" className="font-mono text-xs">
            {knowledgeList.length} 筆
          </Badge>
          <div className="ml-auto">
            <Button size="sm" className="h-9">
              <Upload className="h-3.5 w-3.5 mr-1" />
              上傳新知識
            </Button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-auto -mx-1 px-1">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-4">
            {knowledgeList.map((k) => (
              <KnowledgeCard key={k.id} k={k} />
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  )
}
