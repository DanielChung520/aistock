import { NextRequest, NextResponse } from 'next/server'

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:38000'

export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  const targetUrl = `${BACKEND_URL}/api/watchlist/jobs/${path.join('/')}${request.nextUrl.search}`
  try {
    const response = await fetch(targetUrl, { headers: { 'Content-Type': 'application/json' } })
    return NextResponse.json(await response.json(), { status: response.status })
  } catch {
    return NextResponse.json({ error: 'Backend service unavailable' }, { status: 502 })
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  const targetUrl = `${BACKEND_URL}/api/watchlist/jobs/${path.join('/')}`
  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: await request.text(),
    })
    return NextResponse.json(await response.json(), { status: response.status })
  } catch {
    return NextResponse.json({ error: 'Backend service unavailable' }, { status: 502 })
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  const targetUrl = `${BACKEND_URL}/api/watchlist/jobs/${path.join('/')}`
  try {
    const response = await fetch(targetUrl, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: await request.text(),
    })
    return NextResponse.json(await response.json(), { status: response.status })
  } catch {
    return NextResponse.json({ error: 'Backend service unavailable' }, { status: 502 })
  }
}
