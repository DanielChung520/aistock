'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, ChevronDown, Send, Sparkles, Plus } from 'lucide-react'
import { AppShell } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getOntologyByKey, type EntityClass, type ObjectProperty } from '../_data/mock-ontology'
import { GraphCanvas } from '../_components/graph-canvas'
import { HippocampusTimeline } from '../_components/hippocampus-timeline'
import { NodeDetailsPanel } from '../_components/node-details-panel'

type TabKey = 'graph' | 'list' | 'json' | 'hippocampus'
type SelectedNode =
  | { kind: 'entity'; name: string }
  | { kind: 'property'; name: string }
  | null

const STATUS_LABELS = {
  draft: { label: '草稿', variant: 'secondary' as const },
  active: { label: '活躍', variant: 'default' as const },
  deprecated: { label: '已棄用', variant: 'outline' as const },
}

export default function OntologyStudioPage() {
  const params = useParams<{ key: string }>()
  const ontology = getOntologyByKey(params.key)
  const [activeTab, setActiveTab] = useState<TabKey>('graph')
  const [selectedNode, setSelectedNode] = useState<SelectedNode>({
    kind: 'entity',
    name: 'Company',
  })

  const status = ontology ? STATUS_LABELS[ontology.status] : null

  const selectedEntity = useMemo<EntityClass | undefined>(() => {
    if (!ontology || !selectedNode || selectedNode.kind !== 'entity') return undefined
    return ontology.entity_classes.find((e) => e.name === selectedNode.name)
  }, [ontology, selectedNode])

  const selectedProperty = useMemo<ObjectProperty | undefined>(() => {
    if (!ontology || !selectedNode || selectedNode.kind !== 'property') return undefined
    return ontology.object_properties.find((p) => p.name === selectedNode.name)
  }, [ontology, selectedNode])

  if (!ontology) {
    return (
      <AppShell title="Ontology 不存在">
        <div className="flex h-full items-center justify-center">
          <div className="text-center">
            <p className="text-lg">找不到 ontology: {params.key}</p>
            <Button asChild variant="outline" className="mt-4">
              <Link href="/admin/ontology">← 回列表</Link>
            </Button>
          </div>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell title={ontology.display_name}>
      <div className="flex h-full flex-col">
        {/* Header bar */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-2">
          <Button variant="ghost" size="icon" asChild className="h-8 w-8">
            <Link href="/admin/ontology" aria-label="回列表">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-muted-foreground">{ontology.name}</span>
            <Select defaultValue={ontology.version}>
              <SelectTrigger className="h-7 w-[110px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ontology.version}>
                  v{ontology.version} {status?.label && `(${status.label})`}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm">
              <Sparkles className="h-3.5 w-3.5 mr-1" />
              AI 助理
            </Button>
            <Button size="sm">+ 發佈 v1.0</Button>
          </div>
        </div>

        {/* Main 3-column layout */}
        <div className="flex flex-1 min-h-0">
          {/* Left: entity & property tree */}
          <aside className="w-[240px] shrink-0 border-r border-border flex flex-col">
            <ScrollArea className="flex-1">
              <div className="p-3">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Entities ({ontology.entity_classes.length})
                  </h3>
                  <Button variant="ghost" size="icon" className="h-5 w-5">
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
                <div className="space-y-0.5 mb-4">
                  {ontology.entity_classes.map((entity) => {
                    const isActive =
                      selectedNode?.kind === 'entity' && selectedNode.name === entity.name
                    return (
                      <button
                        key={entity.name}
                        onClick={() => setSelectedNode({ kind: 'entity', name: entity.name })}
                        className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors ${
                          isActive
                            ? 'bg-primary text-primary-foreground'
                            : 'hover:bg-muted text-foreground'
                        }`}
                      >
                        <span
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: entity.color }}
                        />
                        <span className="font-mono">{entity.name}</span>
                      </button>
                    )
                  })}
                </div>

                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Relations ({ontology.object_properties.length})
                  </h3>
                  <Button variant="ghost" size="icon" className="h-5 w-5">
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
                <div className="space-y-0.5">
                  {ontology.object_properties.map((prop) => {
                    const isActive =
                      selectedNode?.kind === 'property' && selectedNode.name === prop.name
                    return (
                      <button
                        key={prop.name}
                        onClick={() => setSelectedNode({ kind: 'property', name: prop.name })}
                        className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors ${
                          isActive
                            ? 'bg-primary text-primary-foreground'
                            : 'hover:bg-muted text-foreground'
                        }`}
                      >
                        <span className="text-muted-foreground text-xs">→</span>
                        <span className="font-mono text-xs">{prop.name}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </ScrollArea>
          </aside>

          {/* Center: tab content */}
          <main className="flex-1 min-w-0 flex flex-col">
            <Tabs
              value={activeTab}
              onValueChange={(v) => setActiveTab(v as TabKey)}
              className="flex-1 flex flex-col min-h-0"
            >
              <div className="border-b border-border px-3 pt-2">
                <TabsList>
                  <TabsTrigger value="graph">圖形</TabsTrigger>
                  <TabsTrigger value="list">清單</TabsTrigger>
                  <TabsTrigger value="json">JSON</TabsTrigger>
                  <TabsTrigger value="hippocampus">
                    Hippocampus
                    <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                      {ontology.evolution.length}
                    </Badge>
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="graph" className="flex-1 min-h-0 m-0">
                <GraphCanvas
                  ontology={ontology}
                  selectedNode={selectedNode}
                  onSelectNode={setSelectedNode}
                />
              </TabsContent>

              <TabsContent value="list" className="flex-1 min-h-0 m-0 overflow-auto">
                <div className="p-4 space-y-6">
                  <section>
                    <h3 className="text-sm font-semibold mb-2">Entity Classes</h3>
                    <Card>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[180px]">名稱</TableHead>
                            <TableHead>描述</TableHead>
                            <TableHead className="w-[80px] text-center">Properties</TableHead>
                            <TableHead className="w-[80px] text-center">範例</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {ontology.entity_classes.map((e) => (
                            <TableRow
                              key={e.name}
                              className="cursor-pointer"
                              onClick={() =>
                                setSelectedNode({ kind: 'entity', name: e.name })
                              }
                            >
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <span
                                    className="h-2 w-2 rounded-full"
                                    style={{ backgroundColor: e.color }}
                                  />
                                  <span className="font-mono font-medium">{e.name}</span>
                                </div>
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {e.description}
                              </TableCell>
                              <TableCell className="text-center font-mono text-xs">
                                {e.properties.length}
                              </TableCell>
                              <TableCell className="text-center font-mono text-xs text-muted-foreground">
                                {e.examples.length}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </Card>
                  </section>

                  <section>
                    <h3 className="text-sm font-semibold mb-2">Object Properties</h3>
                    <Card>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[180px]">名稱</TableHead>
                            <TableHead>描述</TableHead>
                            <TableHead className="w-[100px]">Domain</TableHead>
                            <TableHead className="w-[100px]">Range</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {ontology.object_properties.map((p) => (
                            <TableRow
                              key={p.name}
                              className="cursor-pointer"
                              onClick={() =>
                                setSelectedNode({ kind: 'property', name: p.name })
                              }
                            >
                              <TableCell>
                                <span className="font-mono font-medium">{p.name}</span>
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {p.description}
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className="font-mono text-xs">
                                  {p.domain}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className="font-mono text-xs">
                                  {p.range}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </Card>
                  </section>
                </div>
              </TabsContent>

              <TabsContent value="json" className="flex-1 min-h-0 m-0 overflow-auto">
                <pre className="m-4 rounded-lg border border-border bg-muted/30 p-4 text-xs font-mono leading-relaxed">
                  {JSON.stringify(ontology, null, 2)}
                </pre>
              </TabsContent>

              <TabsContent value="hippocampus" className="flex-1 min-h-0 m-0 overflow-auto">
                <HippocampusTimeline events={ontology.evolution} />
              </TabsContent>
            </Tabs>
          </main>

          {/* Right: node details panel */}
          <aside className="w-[320px] shrink-0 border-l border-border overflow-auto">
            <NodeDetailsPanel
              entity={selectedEntity}
              property={selectedProperty}
              ontologyKey={ontology.name}
            />
          </aside>
        </div>
      </div>
    </AppShell>
  )
}
