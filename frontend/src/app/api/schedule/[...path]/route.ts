import { NextRequest, NextResponse } from 'next/server'

import { backendSignal } from '@/lib/proxy'

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:38000'

export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  const targetUrl = `${BACKEND_URL}/api/schedule/${path.join('/')}${request.nextUrl.search}`
  try {
    const res = await fetch(targetUrl, { signal: backendSignal() })
    return NextResponse.json(await res.json(), { status: res.status })
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      return NextResponse.json({ error: 'Backend timeout' }, { status: 504 })
    }
    return NextResponse.json({ error: 'Backend unavailable' }, { status: 502 })
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  const targetUrl = `${BACKEND_URL}/api/schedule/${path.join('/')}`
  try {
    const res = await fetch(targetUrl, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: await request.text(), signal: backendSignal() })
    return NextResponse.json(await res.json(), { status: res.status })
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      return NextResponse.json({ error: 'Backend timeout' }, { status: 504 })
    }
    return NextResponse.json({ error: 'Backend unavailable' }, { status: 502 })
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  const targetUrl = `${BACKEND_URL}/api/schedule/${path.join('/')}`
  try {
    const res = await fetch(targetUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: await request.text(), signal: backendSignal() })
    return NextResponse.json(await res.json(), { status: res.status })
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      return NextResponse.json({ error: 'Backend timeout' }, { status: 504 })
    }
    return NextResponse.json({ error: 'Backend unavailable' }, { status: 502 })
  }
}
