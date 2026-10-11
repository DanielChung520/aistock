'use client'

import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Database, Network, FileText, Sparkles, Download, ExternalLink, ZoomIn, ZoomOut, Maximize2, ChevronDown, ChevronUp, Hash, Eye, ListTree, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Graph } from '@antv/g6'
import { AppShell } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getKnowledgeById } from '../_data/mock-knowledge'

const FILE_TYPE_LABELS = {
  pdf: 'PDF',
  docx: 'DOCX',
  md: 'Markdown',
  txt: 'Plain text',
  html: 'HTML',
} as const

type TabKey = 'source' | 'graph' | 'vector'

interface NodePropertyDef {
  key: string
  type: 'string' | 'number' | 'date' | 'enum' | 'boolean'
  value: string
  description: string
  example?: string
}

interface EdgePropertyDef {
  key: string
  value: string
  description: string
}

interface SampleEntity {
  id: string
  type: 'Company' | 'Person' | 'Industry' | 'FinancialItem' | 'NewsEvent'
  name: string
  x: number
  y: number
  color: string
  description: string
  properties: NodePropertyDef[]
}

interface SampleRelation {
  id: string
  source: string
  target: string
  label: string
  description: string
  properties: EdgePropertyDef[]
}

const SAMPLE_ENTITIES: SampleEntity[] = [
  {
    id: 'e1',
    type: 'Company',
    name: '台積電',
    x: 400,
    y: 200,
    color: '#3b82f6',
    description: '在台灣證券交易所 (TWSE) 掛牌的半導體晶圓代工公司',
    properties: [
      { key: 'stock_code', type: 'enum', value: '2330', description: '台股代碼', example: '2330' },
      { key: 'name_zh', type: 'string', value: '台積電', description: '中文公司簡稱' },
      { key: 'name_en', type: 'string', value: 'TSMC', description: '英文公司簡稱' },
      { key: 'market', type: 'enum', value: 'TWSE', description: '掛牌市場', example: 'TWSE' },
    ],
  },
  {
    id: 'e2',
    type: 'Person',
    name: '魏哲家',
    x: 100,
    y: 280,
    color: '#10b981',
    description: '台積電現任董事長，2024 年接任',
    properties: [
      { key: 'name_zh', type: 'string', value: '魏哲家', description: '中文姓名' },
      { key: 'name_en', type: 'string', value: 'C.C. Wei', description: '英文姓名' },
      { key: 'title', type: 'string', value: '董事長', description: '頭銜／職稱' },
      { key: 'appointed_on', type: 'date', value: '2024-06-04', description: '就任日期' },
    ],
  },
  {
    id: 'e3',
    type: 'FinancialItem',
    name: '2026 Q2 EPS',
    x: 700,
    y: 180,
    color: '#f59e0b',
    description: '台積電 2026 年第二季每股盈餘，由公司法說會揭露',
    properties: [
      { key: 'metric', type: 'enum', value: 'EPS', description: '財務指標名稱' },
      { key: 'value', type: 'number', value: '7.8', description: '數值' },
      { key: 'unit', type: 'string', value: '元', description: '單位' },
      { key: 'period', type: 'string', value: '2026Q2', description: '報告期' },
      { key: 'period_type', type: 'enum', value: 'quarterly', description: '週期類型' },
    ],
  },
  {
    id: 'e4',
    type: 'NewsEvent',
    name: '法說會',
    x: 200,
    y: 450,
    color: '#ef4444',
    description: '台積電 2026 Q2 法說會，2026/7/8 下午 14:00 召開',
    properties: [
      { key: 'date', type: 'date', value: '2026-07-08', description: '事件日期' },
      { key: 'title', type: 'string', value: '2026 Q2 法人說明會', description: '事件標題' },
      { key: 'category', type: 'enum', value: 'earnings', description: '事件類別' },
      { key: 'source', type: 'string', value: '公司重訊', description: '消息來源' },
    ],
  },
  {
    id: 'e5',
    type: 'Industry',
    name: '半導體業',
    x: 600,
    y: 400,
    color: '#8b5cf6',
    description: 'TWSE/TPEx 行業分類 — 半導體製造業',
    properties: [
      { key: 'code', type: 'string', value: 'M2320', description: 'TWSE 行業代碼' },
      { key: 'name', type: 'string', value: '半導體業', description: '行業中文名稱' },
      { key: 'level', type: 'number', value: '2', description: '層級（0=大類, 1=中類, 2=小類）' },
    ],
  },
]

const SAMPLE_RELATIONS: SampleRelation[] = [
  {
    id: 'r1',
    source: 'e1',
    target: 'e4',
    label: 'mentions',
    description: '新聞 / 重大訊息 / 法說會提到某公司',
    properties: [
      { key: 'mention_count', value: '4 次', description: '本文件提及次數' },
      { key: 'pages', value: '1, 2, 3, 4', description: '出現頁碼' },
    ],
  },
  {
    id: 'r2',
    source: 'e1',
    target: 'e5',
    label: 'operates_in',
    description: '公司所屬產業',
    properties: [
      { key: 'since', value: '1987-02', description: '開始屬於此產業的時間' },
      { key: 'primary', value: 'true', description: '是否為主要產業（vs 兼營）' },
    ],
  },
  {
    id: 'r3',
    source: 'e2',
    target: 'e1',
    label: 'is_director_of',
    description: '自然人擔任公司董事 / 監察人 / 經理人',
    properties: [
      { key: 'role', value: '董事長', description: '具體職務' },
      { key: 'since', value: '2024-06-04', description: '就任日期' },
    ],
  },
  {
    id: 'r4',
    source: 'e1',
    target: 'e3',
    label: 'reported_in',
    description: '財務數據所屬公司',
    properties: [
      { key: 'reporting_period', value: '2026Q2', description: '報告期' },
      { key: 'comparison', value: 'YoY +18%', description: '與去年同期比較' },
    ],
  },
]

const SAMPLE_CHUNKS = [
  {
    id: 'c_001',
    position: 0,
    page: 1,
    text: '「各位投資人大家好，歡迎參加台積電 2026 年第二季法人說明會。我是董事長魏哲家。今天要跟大家分享我們在 3 奈米製程的最新進展，以及對 2026 下半年的展望。」',
    token_count: 78,
    source: 'text' as const,
  },
  {
    id: 'c_002',
    position: 1,
    page: 1,
    text: '「在 3 奈米部分，我們的良率持續改善。預期到 2026 年底，良率將達到 65% 的目標，並在 2027 年進入大量生產階段。」',
    token_count: 52,
    source: 'text' as const,
  },
  {
    id: 'c_003',
    position: 2,
    page: 2,
    text: '「AI 相關需求持續強勁。從高效能運算到邊緣 AI，客戶對我們的先進製程需求顯著增加，這也是支撐我們全年成長的關鍵動能。」',
    token_count: 65,
    source: 'text' as const,
  },
  {
    id: 'c_004',
    position: 3,
    page: 2,
    text: '（圖表 1：3 奈米製程良率走勢圖 — 2024 Q1 至 2026 Q2）',
    token_count: 0,
    source: 'image_caption' as const,
    image_caption: '3 奈米製程良率走勢圖。2024 Q1 起步良率約 35%，逐季改善至 2026 Q2 約 58%，預期年底達 65% 目標。',
  },
  {
    id: 'c_005',
    position: 4,
    page: 3,
    text: '「關於資本支出，我們維持年初 380 億至 420 億美元的區間不變。其中約 70% 將用於先進製程，包括 3 奈米、2 奈米。」',
    token_count: 58,
    source: 'text' as const,
  },
  {
    id: 'c_006',
    position: 5,
    page: 4,
    text: '「股利政策方面，我們將維持穩定的現金股利配發。董事會已核准每股新台幣 5 元的第二季現金股利，將於 2026 年 10 月發放。」',
    token_count: 55,
    source: 'text' as const,
  },
]

const ENTITY_COLORS: Record<string, string> = {
  Company: '#3b82f6',
  Industry: '#10b981',
  Person: '#8b5cf6',
  NewsEvent: '#ef4444',
  FinancialItem: '#f59e0b',
  Policy: '#94a3b8',
  TechnicalSignal: '#ec4899',
}

export default function KnowledgeDetailPage() {
  const params = useParams<{ id: string }>()
  const knowledge = getKnowledgeById(params.id)
  const [activeTab, setActiveTab] = useState<TabKey>('source')

  if (!knowledge) {
    return (
      <AppShell title="知識不存在">
        <div className="flex h-full items-center justify-center">
          <div className="text-center">
            <p className="text-lg">找不到知識: {params.id}</p>
            <Button asChild variant="outline" className="mt-4">
              <Link href="/admin/knowledge">← 回到列表</Link>
            </Button>
          </div>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell title={knowledge.title}>
      <div className="flex h-full flex-col">
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as TabKey)}
          className="flex-1 flex flex-col min-h-0"
        >
          {/* Top bar: back + filename + tabs + download */}
          <div className="flex items-center gap-3 border-b border-border px-4 py-2">
            <Button variant="ghost" size="icon" asChild className="h-8 w-8 shrink-0">
              <Link href="/admin/knowledge" aria-label="回列表">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>

            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="text-sm font-mono text-muted-foreground truncate">
                {knowledge.source_filename}
              </span>
              <Badge variant="outline" className="font-mono text-xs shrink-0">
                {FILE_TYPE_LABELS[knowledge.file_type]}
              </Badge>
            </div>

            <TabsList className="h-8">
              <TabsTrigger value="source" className="text-xs h-6">
                <FileText className="h-3.5 w-3.5 mr-1" />
                原文
              </TabsTrigger>
              <TabsTrigger value="graph" className="text-xs h-6">
                <Network className="h-3.5 w-3.5 mr-1" />
                Graph
                <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                  {knowledge.entity_count}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="vector" className="text-xs h-6">
                <Database className="h-3.5 w-3.5 mr-1" />
                Vector
                <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                  {knowledge.chunk_count}
                </Badge>
              </TabsTrigger>
            </TabsList>

            <Button variant="outline" size="sm" className="shrink-0">
              <Download className="h-3.5 w-3.5 mr-1" />
              下載原文
            </Button>
          </div>

          {/* Meta bar */}
          <div className="flex items-center gap-4 px-4 py-1.5 border-b border-border text-xs text-muted-foreground bg-muted/30">
            <span suppressHydrationWarning>上傳: {new Date(knowledge.uploaded_at).toLocaleString('zh-TW')}</span>
            <span>by {knowledge.uploaded_by}</span>
            {knowledge.page_count && <span>{knowledge.page_count} 頁</span>}
            {knowledge.figure_count > 0 && <span>{knowledge.figure_count} 圖</span>}
            <span>
              ontology: {knowledge.ontology_key} v{knowledge.ontology_version}
            </span>
          </div>

          <TabsContent value="source" className="flex-1 min-h-0 m-0 overflow-auto">
            <SourceViewer knowledge={knowledge} />
          </TabsContent>

          <TabsContent value="graph" className="flex-1 min-h-0 m-0">
            <GraphViewer knowledge={knowledge} />
          </TabsContent>

          <TabsContent value="vector" className="flex-1 min-h-0 m-0 overflow-auto">
            <VectorViewer knowledge={knowledge} />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  )
}

function SourceViewer({ knowledge }: { knowledge: NonNullable<ReturnType<typeof getKnowledgeById>> }) {
  return (
    <div className="p-6 max-w-3xl mx-auto">
      <Card>
        <CardContent className="p-8 space-y-6 text-sm leading-relaxed">
          <div className="text-xs text-muted-foreground font-mono border-b border-border pb-3">
            {knowledge.source_filename} · {knowledge.page_count} 頁
          </div>

          {SAMPLE_CHUNKS.map((chunk) => {
            if (chunk.source === 'image_caption') {
              return (
                <div
                  key={chunk.id}
                  className="my-6 rounded-lg border border-dashed border-border bg-muted/30 p-4"
                >
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                    <Sparkles className="h-3 w-3" />
                    <span>VL 影像摘要 · p.{chunk.page}</span>
                  </div>
                  <div className="text-sm italic text-foreground">{chunk.image_caption}</div>
                </div>
              )
            }

            return (
              <div
                key={chunk.id}
                className="border-l-2 border-border/50 pl-4 py-1 hover:border-primary/50 transition-colors"
              >
                <div className="text-[10px] text-muted-foreground font-mono mb-1">
                  chunk #{chunk.position} · p.{chunk.page} · {chunk.token_count} tokens
                </div>
                <p className="text-foreground">{chunk.text}</p>
              </div>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}

function PropertiesPanel({
  hoveredEntity,
  onClose,
}: {
  hoveredEntity: string | null
  onClose: () => void
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/30">
        <div className="text-sm font-semibold flex items-center gap-2">
          <ListTree className="h-4 w-4" />
          Schema 屬性
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="px-3 py-2 border-b border-border bg-muted/20 text-xs text-muted-foreground">
        hover 任一節點或邊查看詳情
      </div>

      <div className="flex-1 overflow-auto">
        {hoveredEntity && (() => {
          const ent = SAMPLE_ENTITIES.find((e) => e.id === hoveredEntity)
          if (ent) {
            return (
              <div className="p-3 border-b border-border bg-primary/5">
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: ENTITY_COLORS[ent.type] ?? ent.color }}
                  />
                  <span className="font-mono text-sm font-semibold">{ent.name}</span>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {ent.type}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mb-3">{ent.description}</p>
                <div className="space-y-1.5">
                  {ent.properties.map((prop) => (
                    <div
                      key={prop.key}
                      className="rounded border border-border bg-card/50 p-2 text-xs"
                    >
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-mono text-foreground">{prop.key}</span>
                        <Badge variant="outline" className="text-[9px] h-3.5 px-1">
                          {prop.type}
                        </Badge>
                        <span className="ml-auto font-mono text-foreground">
                          {prop.value}
                        </span>
                      </div>
                      <div className="text-muted-foreground text-[11px]">
                        {prop.description}
                      </div>
                      {prop.example && (
                        <div className="text-muted-foreground/70 text-[10px] font-mono mt-0.5">
                          e.g. {prop.example}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          }
          const rel = SAMPLE_RELATIONS.find((r) => r.id === hoveredEntity)
          if (rel) {
            return (
              <div className="p-3 border-b border-border bg-primary/5">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="outline" className="font-mono text-xs">
                    {rel.label}
                  </Badge>
                  <span className="text-muted-foreground text-xs">→</span>
                  <span className="font-mono text-xs">
                    {SAMPLE_ENTITIES.find((e) => e.id === rel.source)?.name}
                  </span>
                  <span className="text-muted-foreground text-xs">→</span>
                  <span className="font-mono text-xs">
                    {SAMPLE_ENTITIES.find((e) => e.id === rel.target)?.name}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mb-3">{rel.description}</p>
                <div className="space-y-1.5">
                  {rel.properties.map((prop) => (
                    <div
                      key={prop.key}
                      className="rounded border border-border bg-card/50 p-2 text-xs"
                    >
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-mono text-foreground">{prop.key}</span>
                        <span className="ml-auto font-mono text-foreground">
                          {prop.value}
                        </span>
                      </div>
                      <div className="text-muted-foreground text-[11px]">
                        {prop.description}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          }
          return null
        })()}

        {!hoveredEntity && (
          <div className="p-3 space-y-1">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
              Entities ({SAMPLE_ENTITIES.length})
            </div>
            {SAMPLE_ENTITIES.map((e) => (
              <button
                key={e.id}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted/50"
              >
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: ENTITY_COLORS[e.type] ?? e.color }}
                />
                <span className="font-mono">{e.name}</span>
                <span className="text-muted-foreground text-[10px] ml-auto">
                  {e.properties.length} props
                </span>
              </button>
            ))}

            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 mt-4">
              Relations ({SAMPLE_RELATIONS.length})
            </div>
            {SAMPLE_RELATIONS.map((r) => (
              <button
                key={r.id}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted/50"
              >
                <Badge variant="outline" className="font-mono text-[10px]">
                  {r.label}
                </Badge>
                <span className="text-muted-foreground text-[10px] ml-auto">
                  {r.properties.length} props
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function GraphViewer({ knowledge }: { knowledge: NonNullable<ReturnType<typeof getKnowledgeById>> }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<Graph | null>(null)
  const [selectedEntity, setSelectedEntity] = useState<string | null>(null)
  const [hoveredEntity, setHoveredEntity] = useState<string | null>(null)
  const [layout, setLayout] = useState<'force' | 'grid' | 'circular'>('force')
  const [mode, setMode] = useState<'path' | 'retrieval' | 'inference'>('retrieval')
  const [propertiesOpen, setPropertiesOpen] = useState(false)

  const g6Data = useMemo(
    () => ({
      nodes: SAMPLE_ENTITIES.map((e) => ({
        id: e.id,
        data: { label: e.name, type: e.type, color: ENTITY_COLORS[e.type] ?? e.color },
      })),
      edges: SAMPLE_RELATIONS.map((r) => ({
        id: r.id,
        source: r.source,
        target: r.target,
        data: { label: r.label },
      })),
    }),
    [],
  )

  useEffect(() => {
    if (!containerRef.current) return
    let cancelled = false

    const graph = new Graph({
      container: containerRef.current,
      autoFit: 'view',
      data: g6Data,
      node: {
        type: 'circle',
        style: {
          size: 60,
          fill: (d: any) => `${d.data.color}40`,
          stroke: (d: any) => d.data.color,
          lineWidth: 2,
          labelText: (d: any) => `${d.data.label}\n(${d.data.type})`,
          labelFontSize: 11,
          labelFontWeight: 600,
          labelFill: '#f5f5f5',
          labelPlacement: 'bottom',
          labelOffsetY: 8,
        },
        state: {
          selected: { lineWidth: 4, shadowColor: '#3b82f6', shadowBlur: 12 },
        },
      },
      edge: {
        type: 'line',
        style: {
          stroke: '#64748b',
          lineWidth: 1.5,
          endArrow: true,
          endArrowSize: 6,
          labelText: (d: any) => d.data.label,
          labelFontSize: 10,
          labelFontFamily: 'monospace',
          labelFill: '#94a3b8',
          labelBackground: true,
          labelBackgroundFill: '#0f172a',
          labelBackgroundRadius: 3,
          labelPadding: [1, 3],
        },
      },
      layout:
        layout === 'force'
          ? { type: 'force', preventOverlap: true, nodeSize: 100, linkDistance: 150, alphaDecay: 0.05 }
          : layout === 'grid'
            ? { type: 'grid' }
            : { type: 'circular' },
      behaviors: ['zoom-canvas', 'drag-canvas', 'drag-element'],
      animation: false,
    })

    if (!cancelled) {
      graph.render().catch((err: unknown) => {
        if (cancelled) return // strict mode remount — graph was destroyed
        console.warn('G6 render failed:', err)
      })
    }

    graph.on('node:click', (e: any) => {
      const id = e.target?.id as string | undefined
      if (!id) return
      setSelectedEntity(id)
      graph.setElementState(id, ['selected'])
    })

    graph.on('node:mouseenter', (e: any) => {
      const id = e.target?.id as string | undefined
      if (id) setHoveredEntity(id)
    })
    graph.on('node:mouseleave', () => {
      setHoveredEntity(null)
    })

    graph.on('canvas:click', () => {
      setSelectedEntity(null)
      SAMPLE_ENTITIES.forEach((e) => graph.setElementState(e.id, []))
    })

    graphRef.current = graph
    return () => {
      cancelled = true
      try { graph.destroy() } catch (err) { console.warn('G6 destroy failed:', err) }
      graphRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g6Data, layout])

  useEffect(() => {
    const graph = graphRef.current
    if (!graph || graph.destroyed) return
    try { graph.setData(g6Data) } catch (err) { console.warn('G6 setData failed:', err) }
  }, [g6Data])

  const selectedEnt = SAMPLE_ENTITIES.find((e) => e.id === selectedEntity)

  return (
    <div className="flex h-full">
      <div className="flex-1 min-w-0 relative bg-muted/10">
        <div ref={containerRef} className="h-full w-full" />

        {/* Top-left: mode + layout switchers */}
        <div className="absolute left-3 top-3 z-10 flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-md border border-border bg-card p-0.5 shadow-sm">
            <Button
              size="sm"
              variant={mode === 'path' ? 'default' : 'ghost'}
              className="h-7 text-xs"
              onClick={() => setMode('path')}
            >
              路徑
            </Button>
            <Button
              size="sm"
              variant={mode === 'retrieval' ? 'default' : 'ghost'}
              className="h-7 text-xs"
              onClick={() => setMode('retrieval')}
            >
              檢索
            </Button>
            <Button
              size="sm"
              variant={mode === 'inference' ? 'default' : 'ghost'}
              className="h-7 text-xs"
              onClick={() => setMode('inference')}
            >
              推斷
            </Button>
          </div>
          <div className="flex items-center gap-1 rounded-md border border-border bg-card p-0.5 shadow-sm">
            <Button
              size="sm"
              variant={layout === 'force' ? 'default' : 'ghost'}
              className="h-7 text-xs"
              onClick={() => setLayout('force')}
            >
              力導圖
            </Button>
            <Button
              size="sm"
              variant={layout === 'grid' ? 'default' : 'ghost'}
              className="h-7 text-xs"
              onClick={() => setLayout('grid')}
            >
              網格
            </Button>
            <Button
              size="sm"
              variant={layout === 'circular' ? 'default' : 'ghost'}
              className="h-7 text-xs"
              onClick={() => setLayout('circular')}
            >
              環形
            </Button>
          </div>
        </div>

        {/* Top-right: properties toggle */}
        <div className="absolute right-3 top-3 z-10">
          <Button
            size="sm"
            variant={propertiesOpen ? 'default' : 'outline'}
            className="h-8"
            onClick={() => setPropertiesOpen((v) => !v)}
          >
            <ListTree className="h-3.5 w-3.5 mr-1" />
            屬性
            {hoveredEntity && (
              <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                hover
              </Badge>
            )}
          </Button>
        </div>

        {/* Bottom-left: legend */}
        <div className="absolute left-3 bottom-3 z-10 rounded-md border border-border bg-card px-3 py-2 text-xs shadow-sm max-w-xs">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
            Extracted Entities ({SAMPLE_ENTITIES.length})
          </div>
          <div className="space-y-1">
            {SAMPLE_ENTITIES.map((e) => (
              <div key={e.id} className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: ENTITY_COLORS[e.type] ?? e.color }}
                />
                <span className="font-mono text-xs">{e.name}</span>
                <span className="text-muted-foreground text-[10px]">· {e.type}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Properties panel (slides in from right) */}
      {propertiesOpen && (
        <aside className="w-80 border-l border-border bg-card overflow-auto shrink-0">
          <PropertiesPanel
            hoveredEntity={hoveredEntity}
            onClose={() => setPropertiesOpen(false)}
          />
        </aside>
      )}

      {selectedEnt && !propertiesOpen && (
        <aside className="w-72 border-l border-border p-4 overflow-auto bg-card">
          <Badge variant="outline" className="mb-2 font-mono text-xs">
            {selectedEnt.type}
          </Badge>
          <h3 className="text-lg font-semibold mb-3">{selectedEnt.name}</h3>
          <div className="space-y-2 text-xs">
            <div>
              <div className="text-muted-foreground mb-1">Mentioned on pages</div>
              <div className="font-mono">1, 2, 3, 4</div>
            </div>
            <div>
              <div className="text-muted-foreground mb-1">Related to</div>
              <div className="space-y-1">
                {SAMPLE_RELATIONS.filter(
                  (r) => r.source === selectedEnt.id || r.target === selectedEnt.id,
                ).map((r) => {
                  const otherId = r.source === selectedEnt.id ? r.target : r.source
                  const other = SAMPLE_ENTITIES.find((e) => e.id === otherId)
                  return (
                    <div key={r.id} className="flex items-center gap-1.5 text-xs">
                      <span className="text-muted-foreground">{r.label}</span>
                      <span className="text-muted-foreground">→</span>
                      <span className="font-mono">{other?.name}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </aside>
      )}
    </div>
  )
}

function VectorPanel({ chunk }: { chunk: (typeof SAMPLE_CHUNKS)[number] }) {
  const [expanded, setExpanded] = useState(false)
  const isImage = chunk.source === 'image_caption'

  return (
    <div className="rounded-md border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-muted/30">
        <Hash className="h-3 w-3 text-muted-foreground" />
        <span className="font-mono text-xs text-muted-foreground">#{chunk.position}</span>
        <span className="text-xs text-muted-foreground">·</span>
        <span className="text-xs text-muted-foreground">p.{chunk.page}</span>
        <Badge
          variant="outline"
          className={`text-[10px] h-5 px-1.5 font-normal ${
            isImage
              ? 'bg-purple-500/15 text-purple-300 border-purple-500/30'
              : 'bg-blue-500/15 text-blue-300 border-blue-500/30'
          }`}
        >
          {isImage ? '影像' : '文字'}
        </Badge>
        <span className="text-[10px] text-muted-foreground font-mono">
          {chunk.token_count} tokens
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground font-mono">
          {chunk.id}
        </span>
      </div>

      <div className="px-4 py-3">
        {isImage ? (
          <p className="text-sm italic text-muted-foreground leading-relaxed">
            「{chunk.image_caption}」
          </p>
        ) : (
          <p className="text-sm leading-relaxed text-foreground">{chunk.text}</p>
        )}
      </div>

      <div className="border-t border-border">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1.5 px-4 py-1.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted/30 w-full text-left transition-colors font-mono"
        >
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          payload
        </button>
        {expanded && (
          <div className="px-4 pb-3 pt-1 space-y-1.5 font-mono text-[11px]">
            <div className="flex gap-2">
              <span className="text-muted-foreground">page:</span>
              <span className="text-foreground">{chunk.page}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-muted-foreground">position:</span>
              <span className="text-foreground">{chunk.position}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-muted-foreground">source:</span>
              <span className="text-foreground">"{chunk.source}"</span>
            </div>
            <div className="flex gap-2">
              <span className="text-muted-foreground">embedding:</span>
              <span className="text-muted-foreground">[0.023, -0.147, 0.891, ...] (1024-dim)</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function VectorViewer({ knowledge }: { knowledge: NonNullable<ReturnType<typeof getKnowledgeById>> }) {
  const totalTokens = SAMPLE_CHUNKS.reduce((sum, c) => sum + c.token_count, 0)

  return (
    <div className="p-4 max-w-5xl mx-auto">
      <div className="mb-3 flex items-center gap-4 text-xs font-mono text-muted-foreground">
        <span>共 {SAMPLE_CHUNKS.length} 個 chunks</span>
        <span>·</span>
        <span>總 {totalTokens} tokens</span>
        <span>·</span>
        <span>avg {Math.round(totalTokens / SAMPLE_CHUNKS.length)} / chunk</span>
        <span>·</span>
        <span>
          collection:{' '}
          <span className="text-foreground">
            kag_kb_{knowledge.ontology_key.replace(/-/g, '_')}
          </span>
        </span>
      </div>

      <div className="space-y-2">
        {SAMPLE_CHUNKS.map((chunk) => (
          <VectorPanel key={chunk.id} chunk={chunk} />
        ))}
      </div>
    </div>
  )
}
