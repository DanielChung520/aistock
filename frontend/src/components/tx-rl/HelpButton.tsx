'use client'

import { useState } from 'react'
import { Info, X } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'

function renderMarkdown(md: string) {
  const lines = md.split('\n')
  const elements: React.ReactNode[] = []
  let i = 0
  let key = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('### ')) {
      elements.push(<h3 key={key++} className="text-sm font-semibold mt-3 mb-1.5 text-foreground">{renderInline(line.slice(4))}</h3>)
    } else if (line.startsWith('## ')) {
      elements.push(<h2 key={key++} className="text-base font-bold mt-4 mb-2 text-foreground border-b border-border/50 pb-1">{renderInline(line.slice(3))}</h2>)
    } else if (line.startsWith('- ')) {
      const items: React.ReactNode[] = []
      while (i < lines.length && lines[i].startsWith('- ')) {
        items.push(<li key={key++} className="ml-4 list-disc text-xs leading-relaxed">{renderInline(lines[i].slice(2))}</li>)
        i++
      }
      elements.push(<ul key={key++} className="my-1.5 space-y-0.5">{items}</ul>)
      continue
    } else if (line.trim().startsWith('|') && i + 1 < lines.length && /^\s*\|[\s\-:|]+\|\s*$/.test(lines[i + 1])) {
      const parseRow = (s: string) => s.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim())
      const headerCells = parseRow(line)
      i += 2
      const bodyRows: string[][] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        bodyRows.push(parseRow(lines[i]))
        i++
      }
      elements.push(
        <div key={key++} className="my-2 overflow-x-auto rounded border border-border/60">
          <table className="w-full text-xs">
            <thead className="bg-muted/40">
              <tr>
                {headerCells.map((h, j) => (
                  <th key={j} className="text-left px-2 py-1.5 font-semibold border-b border-border/60 whitespace-nowrap">
                    {renderInline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((row, ri) => (
                <tr key={ri} className="border-b border-border/30 last:border-b-0">
                  {row.map((c, j) => (
                    <td key={j} className="px-2 py-1.5 align-top">
                      {renderInline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    } else if (line.trim() === '') {
      i++
      continue
    } else {
      elements.push(<p key={key++} className="text-xs leading-relaxed my-1.5 text-foreground/90">{renderInline(line)}</p>)
    }
    i++
  }
  return elements
}

function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  let remaining = text
  let key = 0
  while (remaining.length > 0) {
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/)
    const codeMatch = remaining.match(/`([^`]+)`/)
    const emMatch = remaining.match(/\*([^*]+)\*/)
    const matches = [
      boldMatch ? { type: 'bold', m: boldMatch, len: boldMatch[0].length } : null,
      codeMatch ? { type: 'code', m: codeMatch, len: codeMatch[0].length } : null,
      emMatch ? { type: 'em', m: emMatch, len: emMatch[0].length } : null,
    ].filter(Boolean).sort((a, b) => (a!.m.index! - b!.m.index!))
    if (matches.length === 0) {
      parts.push(<span key={key++}>{remaining}</span>)
      break
    }
    const first = matches[0]!
    if (first.m.index! > 0) parts.push(<span key={key++}>{remaining.slice(0, first.m.index!)}</span>)
    if (first.type === 'bold') parts.push(<strong key={key++} className="font-semibold text-foreground">{first.m[1]}</strong>)
    else if (first.type === 'code') parts.push(<code key={key++} className="px-1 py-0.5 rounded bg-muted text-[11px] font-mono">{first.m[1]}</code>)
    else if (first.type === 'em') parts.push(<em key={key++} className="italic">{first.m[1]}</em>)
    remaining = remaining.slice(first.m.index! + first.len)
  }
  return <>{parts}</>
}

export function HelpButton({ title, content, className = '' }: {
  title: string
  content: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true) }}
        className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-muted-foreground/60 hover:text-foreground hover:bg-muted/80 transition-colors ${className}`}
        aria-label={`${title} 詳細說明`}
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] p-0 gap-0">
          <DialogHeader className="px-6 pt-5 pb-3 border-b border-border/50">
            <DialogTitle className="text-base font-semibold pr-8">{title}</DialogTitle>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </DialogHeader>
          <ScrollArea className="px-6 py-4 max-h-[70vh]">
            <div className="text-foreground">{renderMarkdown(content)}</div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function BlockTitle({ title, helpContent, children }: {
  title: string
  helpContent: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-2 mb-2">
      <div>
        <h3 className="text-sm font-semibold leading-tight">{title}</h3>
        {children}
      </div>
      <HelpButton title={title} content={helpContent} className="mt-0.5 shrink-0" />
    </div>
  )
}
