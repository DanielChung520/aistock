import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:38000'

export async function POST(request: NextRequest) {
  // Signature is computed over the RAW body — forward the exact bytes, never re-serialize.
  const body = Buffer.from(await request.arrayBuffer())
  const signature = request.headers.get('x-line-signature') ?? ''

  try {
    const response = await fetch(`${BACKEND_URL}/api/line/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Line-Signature': signature,
      },
      body,
    })
    return new Response(response.body, { status: response.status })
  } catch (error) {
    console.error('LINE webhook proxy error:', error)
    return new Response('Backend service unavailable', { status: 502 })
  }
}
