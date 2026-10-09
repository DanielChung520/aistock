import { NextRequest } from 'next/server'

const FILER_URL = process.env.SEAWEEDFS_FILER_URL || 'http://localhost:8888'
const BUCKET = process.env.SEAWEEDFS_REPORT_BUCKET || 'aistock-reports'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ key: string[] }> }
) {
  const { key } = await params
  const path = key.map(encodeURIComponent).join('/')

  try {
    const upstream = await fetch(`${FILER_URL}/buckets/${BUCKET}/${path}`)

    if (!upstream.ok) {
      return new Response('找不到文件', { status: upstream.status })
    }

    const body = await upstream.arrayBuffer()
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type':
          upstream.headers.get('content-type') ?? 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=60',
      },
    })
  } catch (error) {
    console.error(`Proxy error for /api/docs/${path}:`, error)
    return new Response('文件服務暫時無法使用', { status: 502 })
  }
}
