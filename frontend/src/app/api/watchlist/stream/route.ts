import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:38000'

export async function GET(request: NextRequest) {
  const targetUrl = `${BACKEND_URL}/api/watchlist/stream${request.nextUrl.search}`

  try {
    const response = await fetch(targetUrl, {
      headers: { Accept: 'text/event-stream' },
      cache: 'no-store',
    })

    if (!response.ok || !response.body) {
      return new Response('Backend service unavailable', { status: 502 })
    }

    return new Response(response.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch (error) {
    console.error('Watchlist stream proxy error:', error)
    return new Response('Backend service unavailable', { status: 502 })
  }
}
