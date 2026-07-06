import { NextResponse } from 'next/server'
import { aql } from 'arangojs'
import { getDatabase, ensureDatabase, ensureCollection } from '@/lib/arangodb'

const COLLECTION_NAME = 'menu_groups'

export async function GET() {
  try {
    const db = await ensureDatabase()
    await ensureCollection(COLLECTION_NAME)

    const cursor = await db.query(aql`
      FOR g IN ${db.collection(COLLECTION_NAME)}
      SORT g.sortOrder ASC
      RETURN g
    `)
    const groups = await cursor.all()
    return NextResponse.json(groups)
  } catch (error) {
    console.error('Error fetching menu groups:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const db = await ensureDatabase()
    await ensureCollection(COLLECTION_NAME)

    const body = await request.json()
    const { title, sortOrder = 0, enabled = true } = body

    if (!title) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 })
    }

    const collection = db.collection(COLLECTION_NAME)
    const result = await collection.save({
      title,
      sortOrder,
      enabled,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    console.error('Error creating menu group:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const db = await ensureDatabase()
    await ensureCollection(COLLECTION_NAME)

    const body = await request.json()
    const { _key, title, sortOrder, enabled } = body

    if (!_key) {
      return NextResponse.json({ error: '_key is required' }, { status: 400 })
    }

    const collection = db.collection(COLLECTION_NAME)
    
    const updateData: Record<string, unknown> = { updatedAt: new Date().toISOString() }
    if (title !== undefined) updateData.title = title
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder
    if (enabled !== undefined) updateData.enabled = enabled

    const result = await collection.update(_key, updateData)

    return NextResponse.json(result)
  } catch (error) {
    console.error('Error updating menu group:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const key = searchParams.get('key')

    if (!key) {
      return NextResponse.json({ error: 'key is required' }, { status: 400 })
    }

    const db = await ensureDatabase()
    await ensureCollection(COLLECTION_NAME)

    const collection = db.collection(COLLECTION_NAME)
    await collection.remove(key)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting menu group:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
