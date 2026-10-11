'use client'

import { useEffect, useRef, useMemo } from 'react'
import { Graph } from '@antv/g6'
import { Button } from '@/components/ui/button'
import { Maximize2 } from 'lucide-react'
import type { Ontology, EntityClass, ObjectProperty } from '../_data/mock-ontology'

interface GraphCanvasProps {
  ontology: Ontology
  selectedNode:
    | { kind: 'entity'; name: string }
    | { kind: 'property'; name: string }
    | null
  onSelectNode: (node: { kind: 'entity'; name: string } | { kind: 'property'; name: string } | null) => void
}

export function GraphCanvas({ ontology, selectedNode, onSelectNode }: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<Graph | null>(null)

  const entityMap = useMemo(() => {
    const m = new Map<string, EntityClass>()
    ontology.entity_classes.forEach((e) => m.set(e.name, e))
    return m
  }, [ontology])

  const propertyMap = useMemo(() => {
    const m = new Map<string, ObjectProperty>()
    ontology.object_properties.forEach((p) => m.set(p.name, p))
    return m
  }, [ontology])

  // Compute the set of focused entities and properties around the selected node.
  const focusedSet = useMemo(() => {
    if (!selectedNode) return null
    const entities = new Set<string>()
    const properties = new Set<string>()
    if (selectedNode.kind === 'entity') {
      entities.add(selectedNode.name)
      ontology.object_properties.forEach((p) => {
        if (p.domain === selectedNode.name) {
          entities.add(p.range)
          properties.add(p.name)
        } else if (p.range === selectedNode.name) {
          entities.add(p.domain)
          properties.add(p.name)
        }
      })
    } else {
      properties.add(selectedNode.name)
      const p = propertyMap.get(selectedNode.name)
      if (p) {
        entities.add(p.domain)
        entities.add(p.range)
      }
    }
    return { entities, properties }
  }, [selectedNode, ontology, propertyMap])

  // Format data for G6 v5
  const g6Data = useMemo(() => {
    return {
      nodes: ontology.entity_classes.map((e) => ({
        id: `entity:${e.name}`,
        data: {
          label: e.name,
          color: e.color,
        },
      })),
      edges: ontology.object_properties.map((p) => ({
        id: `property:${p.name}`,
        source: `entity:${p.domain}`,
        target: `entity:${p.range}`,
        data: {
          label: p.name,
        },
      })),
    }
  }, [ontology])

  // Initialize the graph once
  useEffect(() => {
    if (!containerRef.current) return
    let cancelled = false

    const graph = new Graph({
      container: containerRef.current,
      autoFit: 'view',
      data: g6Data,
      node: {
        type: 'rect',
        style: {
          size: [140, 48],
          radius: 8,
          fill: (d: any) => `${d.data.color}30`,
          stroke: (d: any) => d.data.color,
          lineWidth: 1.5,
          labelText: (d: any) => d.data.label,
          labelFontWeight: 600,
          labelFontSize: 13,
          labelFill: '#f5f5f5',
          labelPlacement: 'center',
        },
        state: {
          dimmed: {
            fillOpacity: 0.2,
            strokeOpacity: 0.3,
            labelOpacity: 0.4,
          },
        },
      },
      edge: {
        type: 'line',
        style: {
          stroke: '#94a3b8',
          lineWidth: 1.5,
          endArrow: true,
          endArrowSize: 8,
          labelText: (d: any) => d.data.label,
          labelFontSize: 11,
          labelFill: '#cbd5e1',
        },
        state: {
          selected: {
            stroke: '#3b82f6',
            lineWidth: 2.5,
            labelFontWeight: 600,
          },
          dimmed: {
            strokeOpacity: 0.2,
            labelOpacity: 0.3,
          },
        },
      },
      layout: {
        type: 'force',
        preventOverlap: true,
        nodeSize: 160,
        linkDistance: 200,
        alphaDecay: 0.05,
      },
      behaviors: ['zoom-canvas', 'drag-canvas', 'drag-element'],
      animation: false,
    })

    if (!cancelled) {
      try {
        graph.render()
      } catch (err) {
        console.warn('G6 render failed:', err)
      }
    }

    graph.on('node:click', (e: any) => {
      const id = e.target?.id as string | undefined
      if (!id) return
      const entityName = id.replace(/^entity:/, '')
      onSelectNode({ kind: 'entity', name: entityName })
    })

    graph.on('edge:click', (e: any) => {
      const id = e.target?.id as string | undefined
      if (!id) return
      const propName = id.replace(/^property:/, '')
      onSelectNode({ kind: 'property', name: propName })
    })

    graph.on('canvas:click', () => {
      onSelectNode(null)
    })

    graphRef.current = graph

    return () => {
      cancelled = true
      try {
        graph.destroy()
      } catch (err) {
        console.warn('G6 destroy failed:', err)
      }
      graphRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!graphRef.current) return
    try {
      graphRef.current.setData(g6Data)
    } catch (err) {
      console.warn('G6 setData failed:', err)
    }
  }, [g6Data])

  // Update visual states when selection changes
  useEffect(() => {
    const graph = graphRef.current
    if (!graph) return

    try {
      ontology.entity_classes.forEach((e) => {
        graph.setElementState(`entity:${e.name}`, [])
      })
      ontology.object_properties.forEach((p) => {
        graph.setElementState(`property:${p.name}`, [])
      })

      if (!focusedSet) return

      ontology.entity_classes.forEach((e) => {
        if (!focusedSet.entities.has(e.name)) {
          graph.setElementState(`entity:${e.name}`, ['dimmed'])
        }
      })
      ontology.object_properties.forEach((p) => {
        if (!focusedSet.properties.has(p.name)) {
          graph.setElementState(`property:${p.name}`, ['dimmed'])
        }
      })

      if (selectedNode?.kind === 'property') {
        graph.setElementState(`property:${selectedNode.name}`, ['selected'])
      }
    } catch (err) {
      console.warn('G6 setElementState failed:', err)
    }
  }, [selectedNode, focusedSet, ontology])

  const handleFitView = () => {
    graphRef.current?.fitView()
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-muted/10">
      <div ref={containerRef} className="h-full w-full" />

      <div className="absolute right-3 top-3 z-10 flex flex-col gap-1 rounded-md border border-border bg-card p-1 shadow-sm">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={handleFitView}
          title="適配視窗"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="absolute left-3 top-3 z-10 rounded-md border border-border bg-card px-3 py-2 text-xs shadow-sm">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
          Entity Classes
        </div>
        <div className="space-y-1">
          {ontology.entity_classes.map((e) => (
            <div key={e.name} className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 rounded-full shrink-0"
                style={{ backgroundColor: e.color }}
              />
              <span className="font-mono">{e.name}</span>
              <span className="text-muted-foreground">· {e.examples.length} 例</span>
            </div>
          ))}
        </div>
      </div>

      {!selectedNode && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-xs text-muted-foreground bg-card/90 backdrop-blur border border-border rounded-full px-3 py-1.5 shadow-sm">
          點擊節點或關係查看詳情 · 滾輪縮放 · 拖曳移動
        </div>
      )}
    </div>
  )
}
