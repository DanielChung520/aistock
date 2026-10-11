import { NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'

// Repo root = one level above frontend/ (process.cwd() is frontend/ in dev & prod).
export function knowledgeBasePath(): string {
  const env = process.env.INDICATOR_KB_PATH
  if (env) return env
  return path.resolve(process.cwd(), '..', '.docs', 'indicators')
}

export interface IndicatorKbParameter {
  name: string
  default: number
  range: number[]
  tw_convention?: string
}

export interface IndicatorKbSignal {
  pattern: string
  condition: string
}

export interface IndicatorKbDoc {
  metric: string
  name: string
  category: string
  tags?: string[]
  llm_intent?: string
  definition: string
  formula: string
  parameters: IndicatorKbParameter[]
  inputs: string[]
  outputs: { type: string; range: number[] | null; meaning: string }
  implementation: { implemented: boolean; function: string | null; catalog_metric: string | null }
  depends_on: string[]
  signals: IndicatorKbSignal[]
  combines_with: string[]
  notes: string
}

export async function GET() {
  try {
    const dir = knowledgeBasePath()
    const entries = await fs.readdir(dir)
    const jsonFiles = entries.filter((f) => f.endsWith('.json'))

    const docs: IndicatorKbDoc[] = []
    for (const file of jsonFiles) {
      try {
        const raw = await fs.readFile(path.join(dir, file), 'utf-8')
        const parsed = JSON.parse(raw) as IndicatorKbDoc
        if (parsed && typeof parsed.metric === 'string') {
          docs.push(parsed)
        }
      } catch {
        // Skip malformed JSON files individually; keep the rest of the catalog.
      }
    }

    docs.sort((a, b) => a.metric.localeCompare(b.metric))

    return NextResponse.json({ indicators: docs, total: docs.length })
  } catch (err) {
    console.error('Failed to load indicator knowledge base', err)
    return NextResponse.json(
      { error: 'Failed to load indicator knowledge base', detail: String(err) },
      { status: 500 },
    )
  }
}
