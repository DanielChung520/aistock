import { NextResponse } from 'next/server'
import { NextRequest } from 'next/server'

import { backendSignal } from '@/lib/proxy'

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:38000'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const symbols = searchParams.get('symbols') || ''

  try {
    const resp = await fetch(`${BACKEND_URL}/api/news/today?symbols=${encodeURIComponent(symbols)}`, {
      cache: 'no-store',
      signal: backendSignal(),
    })
    if (!resp.ok) {
      return NextResponse.json({ error: 'Backend news API failed' }, { status: 502 })
    }
    const data = await resp.json()
    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      return NextResponse.json({ error: 'Backend timeout' }, { status: 504 })
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
