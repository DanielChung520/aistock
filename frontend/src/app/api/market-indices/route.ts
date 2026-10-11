import { NextResponse } from 'next/server'
import { aql } from 'arangojs'
import { getDatabase, ensureDatabase, ensureCollection } from '@/lib/arangodb'
import type { MarketIndex } from '@/types/menu'

const DEFAULT_INDICES: Array<Omit<MarketIndex, '_key' | 'createdAt' | 'updatedAt'>> = [
  { symbol: 'TWII', yfSymbol: '^TWII', name: '加權指數', category: '台股', enabled: true, sortOrder: 0 },
  { symbol: 'TWO', yfSymbol: '0051.TW', name: '櫃買指數', category: '台股', enabled: true, sortOrder: 1 },
  { symbol: 'N225', yfSymbol: '^N225', name: '日經 225', category: '亞股', enabled: true, sortOrder: 2 },
  { symbol: 'HSI', yfSymbol: '^HSI', name: '恆生指數', category: '亞股', enabled: true, sortOrder: 3 },
  { symbol: 'SSE', yfSymbol: '000001.SS', name: '上證指數', category: '亞股', enabled: true, sortOrder: 4 },
  { symbol: 'KS11', yfSymbol: '^KS11', name: '韓國 KOSPI', category: '亞股', enabled: true, sortOrder: 5 },
  { symbol: 'SOX', yfSymbol: '^SOX', name: '費城半導體', category: '美股', enabled: true, sortOrder: 6 },
  { symbol: 'IXIC', yfSymbol: '^IXIC', name: '那斯達克指數', category: '美股', enabled: true, sortOrder: 7 },
  { symbol: 'GSPC', yfSymbol: '^GSPC', name: '標普 500', category: '美股', enabled: true, sortOrder: 8 },
  { symbol: 'DJI', yfSymbol: '^DJI', name: '道瓊工業指數', category: '美股', enabled: true, sortOrder: 9 },
]

async function initDb() {
  await ensureDatabase()
  await ensureCollection('market_index_list')

  // 空 collection 時自動寫入預設 10 檔
  const db = getDatabase()
  const cursor = await db.query(aql`
    FOR i IN market_index_list
    LIMIT 1
    RETURN 1
  `)
  const hasAny = await cursor.next()

  if (!hasAny) {
    const now = new Date().toISOString()
    const collection = db.collection('market_index_list')
    for (const idx of DEFAULT_INDICES) {
      await collection.save({
        ...idx,
        _key: idx.symbol,
        createdAt: now,
        updatedAt: now,
      })
    }
  }
}

export async function GET() {
  try {
    await initDb()
    const db = getDatabase()

    const cursor = await db.query(aql`
      FOR i IN market_index_list
      SORT i.sortOrder ASC
      RETURN i
    `)
    const indices = (await cursor.all()) as MarketIndex[]

    return NextResponse.json({ indices })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('GET /api/market-indices error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    await initDb()
    const db = getDatabase()
    const body = await request.json()
    const collection = db.collection('market_index_list')

    const symbol: string = (body.symbol || '').trim().toUpperCase()
    if (!symbol) {
      return NextResponse.json({ error: 'symbol is required' }, { status: 400 })
    }

    const now = new Date().toISOString()
    const doc: Omit<MarketIndex, '_key'> = {
      symbol,
      yfSymbol: body.yfSymbol || symbol,
      name: body.name || symbol,
      category: body.category || '美股',
      enabled: body.enabled ?? true,
      sortOrder: body.sortOrder ?? 0,
      createdAt: now,
      updatedAt: now,
    }

    const result = await collection.save({ ...doc, _key: symbol }, { returnNew: true })

    return NextResponse.json({ index: result.new }, { status: 201 })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('POST /api/market-indices error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    await initDb()
    const db = getDatabase()
    const body = await request.json()
    const collection = db.collection('market_index_list')

    if (!body._key) {
      return NextResponse.json({ error: '_key is required' }, { status: 400 })
    }

    const updates = {
      ...body,
      updatedAt: new Date().toISOString(),
    }
    delete updates._key
    delete updates._id
    delete updates._rev

    const result = await collection.update(body._key, updates, { returnNew: true })

    return NextResponse.json({ index: result.new })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('PUT /api/market-indices error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    await initDb()
    const db = getDatabase()
    const { searchParams } = new URL(request.url)
    const key = searchParams.get('key')

    if (!key) {
      return NextResponse.json({ error: 'key parameter is required' }, { status: 400 })
    }

    const collection = db.collection('market_index_list')
    await collection.remove(key)

    return NextResponse.json({ deleted: key })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('DELETE /api/market-indices error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
