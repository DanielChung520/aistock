import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { knowledgeBasePath, type IndicatorKbDoc } from '../route'

function resolveDocPath(metric: string): string {
  // Strict metric validation: alphanumeric + underscore only, prevents path traversal.
  if (!/^[a-z0-9_]+$/.test(metric)) {
    throw new Error('Invalid metric name')
  }
  return path.join(knowledgeBasePath(), `${metric}.json`)
}

export async function PUT(request: NextRequest, context: { params: Promise<{ metric: string }> }) {
  const { metric } = await context.params

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const doc = payload as IndicatorKbDoc
  if (!doc || doc.metric !== metric || typeof doc.name !== 'string') {
    return NextResponse.json(
      { error: 'Body must include matching metric and a name' },
      { status: 400 },
    )
  }

  try {
    const filePath = resolveDocPath(metric)
    // Confirm the file exists before overwriting.
    await fs.access(filePath)
    const serialized = `${JSON.stringify(doc, null, 2)}\n`
    await fs.writeFile(filePath, serialized, 'utf-8')
    return NextResponse.json({ ok: true, metric })
  } catch (err) {
    console.error(`Failed to save indicator ${metric}`, err)
    return NextResponse.json(
      { error: 'Failed to save indicator', detail: String(err) },
      { status: 500 },
    )
  }
}
