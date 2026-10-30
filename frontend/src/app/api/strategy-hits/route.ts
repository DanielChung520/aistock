import { NextRequest, NextResponse } from 'next/server'
import { backendSignal } from '@/lib/proxy'

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000'

async function proxyRequest(request: NextRequest) {
  const url = new URL(request.url)
  const targetUrl = `${BACKEND_URL}/api/strategy-hits${url.search}`

  try {
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: {
        'Content-Type': 'application/json',
      },
      body:
        request.method !== 'GET' && request.method !== 'HEAD'
          ? await request.text()
          : undefined,
      signal: backendSignal(),
    })

    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      return NextResponse.json({ error: 'Backend timeout' }, { status: 504 })
    }
    console.error('Proxy error for /api/strategy-hits:', error)
    return NextResponse.json(
      { error: 'Backend service unavailable' },
      { status: 502 }
    )
  }
}

export async function GET(request: NextRequest) {
  return proxyRequest(request)
}

export async function POST(request: NextRequest) {
  return proxyRequest(request)
}

export async function PUT(request: NextRequest) {
  return proxyRequest(request)
}

export async function DELETE(request: NextRequest) {
  return proxyRequest(request)
}
