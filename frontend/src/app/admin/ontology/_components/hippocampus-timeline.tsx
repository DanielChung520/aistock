'use client'

import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Plus, Filter, Download } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { OntologyEvolutionEvent } from '../_data/mock-ontology'

interface HippocampusTimelineProps {
  events: OntologyEvolutionEvent[]
}

const EVENT_META = {
  created: { label: 'created', color: 'bg-blue-500', icon: '★' },
  added: { label: 'added', color: 'bg-emerald-500', icon: '+' },
  modified: { label: 'modified', color: 'bg-amber-500', icon: '✎' },
  removed: { label: 'removed', color: 'bg-red-500', icon: '−' },
  rejected: { label: 'rejected', color: 'bg-slate-500', icon: '×' },
  discussed: { label: 'discussed', color: 'bg-purple-500', icon: '?' },
} as const

const TARGET_TYPE_LABELS = {
  ontology: 'ontology',
  entity_class: 'entity class',
  object_property: 'property',
  use_case: 'use case',
} as const

export function HippocampusTimeline({ events }: HippocampusTimelineProps) {
  const sortedEvents = [...events].sort(
    (a, b) => new Date(b.created_at * 1000).getTime() - new Date(a.created_at * 1000).getTime(),
  )

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">演化時間軸</h2>
        <Badge variant="secondary" className="font-mono text-xs">
          {events.length} events
        </Badge>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm">
            <Filter className="h-3.5 w-3.5 mr-1" />
            篩選
          </Button>
          <Button variant="ghost" size="sm">
            <Download className="h-3.5 w-3.5 mr-1" />
            匯出 markdown
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        這是 ontology 為什麼長成現在這個樣子的「海馬迴」— 誰、在什麼時候、基於什麼對話或文件，做了什麼決策。
      </p>

      <div className="relative pl-6 space-y-3">
        {/* Vertical line */}
        <div className="absolute left-2 top-2 bottom-2 w-px bg-border" />

        {sortedEvents.map((event, idx) => {
          const meta = EVENT_META[event.event_type]
          const isLast = idx === sortedEvents.length - 1
          return (
            <div key={event.id} className="relative">
              {/* Dot on timeline */}
              <div
                className={cn(
                  'absolute -left-[18px] top-1.5 h-3 w-3 rounded-full ring-2 ring-background',
                  meta.color,
                )}
              />

              <Card className="p-3">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className="font-mono text-xs">
                        {meta.label}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {TARGET_TYPE_LABELS[event.target_type]}
                      </span>
                      <span className="text-sm font-mono font-medium truncate">
                        {event.target_name}
                      </span>
                    </div>

                    <p className="text-sm text-foreground mb-2">{event.reason}</p>

                    {event.context?.trigger_question && (
                      <div className="text-xs text-muted-foreground mb-1">
                        <span className="font-semibold">觸發問題：</span>
                        <span className="italic">「{event.context.trigger_question}」</span>
                      </div>
                    )}

                    {event.context?.user_story && (
                      <div className="text-xs text-muted-foreground mb-1">
                        <span className="font-semibold">使用情境：</span>
                        {event.context.user_story}
                      </div>
                    )}

                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-2">
                      <span className="font-mono">{event.created_by}</span>
                      <span>·</span>
                      <span>
                        {new Date(event.created_at * 1000).toLocaleString('zh-TW', {
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          )
        })}

        {/* End-of-timeline marker */}
        {sortedEvents.length > 0 && (
          <div className="relative pt-2">
            <div className="absolute -left-[14px] top-2 text-xs text-muted-foreground font-mono">
              v0.1
            </div>
            <div className="ml-2 text-xs text-muted-foreground italic">
              ↑ 當前版本
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
