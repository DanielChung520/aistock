import { NextRequest } from 'next/server'

const FILER_URL = process.env.SEAWEEDFS_FILER_URL || 'http://localhost:8888'
const BUCKET = process.env.SEAWEEDFS_INSTALLER_BUCKET || 'aistock-installers'

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
      return new Response('找不到檔案', { status: upstream.status })
    }

    const body = await upstream.arrayBuffer()
    const contentType =
      upstream.headers.get('content-type') ?? 'application/octet-stream'
    const disposition = /\.(exe|msi|dmg|deb|AppImage|gz)$/i.test(path)
      ? `attachment; filename="${path.split('/').pop()}"`
      : 'inline'

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': disposition,
        'Cache-Control': 'public, max-age=60',
      },
    })
  } catch (error) {
    console.error(`Proxy error for /api/installers/${path}:`, error)
    return new Response('檔案服務暫時無法使用', { status: 502 })
  }
}
