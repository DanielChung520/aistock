import { NextRequest, NextResponse } from 'next/server'

import { backendSignal } from '@/lib/proxy'

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000'

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ stockId: string }> }
) {
  const { stockId } = await params
  const url = new URL(request.url)
  const targetUrl = `${BACKEND_URL}/api/watchlist/${stockId}${url.search}`

  try {
    const response = await fetch(targetUrl, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: backendSignal(),
    })

    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      return NextResponse.json({ error: 'Backend timeout' }, { status: 504 })
    }
    console.error(`Proxy error for /api/watchlist/${stockId}:`, error)
    return NextResponse.json(
      { error: 'Backend service unavailable' },
      { status: 502 }
    )
  }
}
