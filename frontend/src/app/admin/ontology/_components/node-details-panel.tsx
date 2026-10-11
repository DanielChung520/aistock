'use client'

import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Pencil, ExternalLink } from 'lucide-react'
import type { EntityClass, ObjectProperty } from '../_data/mock-ontology'

interface NodeDetailsPanelProps {
  entity: EntityClass | undefined
  property: ObjectProperty | undefined
  ontologyKey: string
}

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  string: { label: 'string', color: 'bg-slate-500/20 text-slate-300' },
  number: { label: 'number', color: 'bg-blue-500/20 text-blue-300' },
  date: { label: 'date', color: 'bg-emerald-500/20 text-emerald-300' },
  enum: { label: 'enum', color: 'bg-purple-500/20 text-purple-300' },
  boolean: { label: 'boolean', color: 'bg-amber-500/20 text-amber-300' },
  array: { label: 'array', color: 'bg-pink-500/20 text-pink-300' },
}

export function NodeDetailsPanel({ entity, property, ontologyKey }: NodeDetailsPanelProps) {
  if (property) {
    return (
      <div className="p-4 space-y-4">
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-sm">→</span>
              <h2 className="text-base font-mono font-semibold">{property.name}</h2>
            </div>
            <Button variant="ghost" size="icon" className="h-6 w-6">
              <Pencil className="h-3 w-3" />
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">{property.description}</p>
        </div>

        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
            關係定義
          </div>
          <div className="space-y-1.5 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Domain</span>
              <Badge variant="outline" className="font-mono text-xs">
                {property.domain}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Range</span>
              <Badge variant="outline" className="font-mono text-xs">
                {property.range}
              </Badge>
            </div>
          </div>
        </Card>

        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
            範例
          </div>
          <ul className="space-y-1.5 text-sm">
            {property.examples.map((ex, i) => (
              <li key={i} className="text-muted-foreground italic">
                「{ex}」
              </li>
            ))}
          </ul>
        </Card>
      </div>
    )
  }

  if (entity) {
    return (
      <div className="p-4 space-y-4">
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span
                className="h-3 w-3 rounded-full shrink-0"
                style={{ backgroundColor: entity.color }}
              />
              <h2 className="text-base font-mono font-semibold">{entity.name}</h2>
            </div>
            <Button variant="ghost" size="icon" className="h-6 w-6">
              <Pencil className="h-3 w-3" />
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">{entity.description}</p>
        </div>

        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
            Properties ({entity.properties.length})
          </div>
          <div className="space-y-2">
            {entity.properties.map((prop) => {
              const typeStyle = TYPE_LABELS[prop.type] || TYPE_LABELS.string
              return (
                <div key={prop.name} className="text-sm">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-mono font-medium">{prop.name}</span>
                    <Badge variant="secondary" className={`text-[10px] h-4 px-1 ${typeStyle.color}`}>
                      {typeStyle.label}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">{prop.description}</div>
                  {prop.example && (
                    <div className="text-xs text-muted-foreground font-mono mt-0.5">
                      e.g. <span className="text-foreground">{prop.example}</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </Card>

        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
            範例
          </div>
          <div className="flex flex-wrap gap-1.5">
            {entity.examples.map((ex, i) => (
              <Badge key={i} variant="secondary" className="font-mono text-xs">
                {ex}
              </Badge>
            ))}
          </div>
        </Card>

        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
            NER 抽取預覽
          </div>
          <div className="text-xs text-muted-foreground space-y-1.5">
            <p>
              LLM 看到 <code className="text-foreground font-mono">「{entity.examples[0]}」</code>{' '}
              時，會抽出：
            </p>
            <pre className="rounded bg-muted/50 p-2 font-mono text-[11px] text-foreground overflow-x-auto">
{`{
  "name": "${entity.name}",
  "value": "...",
  "properties": { ... }
}`}
            </pre>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-4 text-sm text-muted-foreground text-center">
      選擇左側 entity 或 relation
      <br />
        查看詳情
    </div>
  )
}
