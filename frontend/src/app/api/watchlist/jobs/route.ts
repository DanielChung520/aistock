import { NextRequest, NextResponse } from 'next/server'

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:38000'

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const targetUrl = `${BACKEND_URL}/api/watchlist/jobs${url.search}`

  try {
    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })
    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error('Proxy error for /api/watchlist/jobs:', error)
    return NextResponse.json({ error: 'Backend service unavailable' }, { status: 502 })
  }
}

export async function POST(request: NextRequest) {
  const targetUrl = `${BACKEND_URL}/api/watchlist/jobs`

  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: await request.text(),
    })
    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error('Proxy error for /api/watchlist/jobs POST:', error)
    return NextResponse.json({ error: 'Backend service unavailable' }, { status: 502 })
  }
}
