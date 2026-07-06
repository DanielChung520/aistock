import { NextResponse } from 'next/server'
import { aql } from 'arangojs'
import { getDatabase, ensureDatabase, ensureCollection } from '@/lib/arangodb'
import type { MenuItem, MenuGroup, MenuItemWithChildren } from '@/types/menu'

async function initDb() {
  await ensureDatabase()
  await ensureCollection('menu_items')
  await ensureCollection('menu_groups')
}

function buildMenuTree(
  groups: Array<{ _key: string; title: string; sortOrder: number; enabled: boolean }>,
  items: MenuItem[],
): MenuGroup[] {
  return groups
    .filter((g) => g.enabled)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((group) => {
      const groupItems = items.filter(
        (item) => item.groupKey === group._key && !item.parentKey && item.enabled,
      )

      const itemsWithChildren: MenuItemWithChildren[] = groupItems
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((item) => {
          const children = items
            .filter(
              (child) =>
                child.parentKey === item._key &&
                child.groupKey === group._key &&
                child.enabled,
            )
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((child) => ({
              ...child,
              _key: child._key!,
            }))

          return {
            ...item,
            _key: item._key!,
            children: children.length > 0 ? children : undefined,
          }
        })

      return {
        key: group._key,
        title: group.title,
        sortOrder: group.sortOrder,
        items: itemsWithChildren,
      }
    })
}

export async function GET() {
  try {
    await initDb()
    const db = getDatabase()

    const groupsCursor = await db.query(aql`
      FOR g IN menu_groups
      SORT g.sortOrder ASC
      RETURN g
    `)
    const groups = await groupsCursor.all()

    const itemsCursor = await db.query(aql`
      FOR item IN menu_items
      SORT item.sortOrder ASC
      RETURN item
    `)
    const items = await itemsCursor.all()

    const menu = buildMenuTree(groups, items)

    return NextResponse.json({ menu })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('GET /api/menu error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    await initDb()
    const db = getDatabase()
    const body = await request.json()
    const collection = db.collection('menu_items')

    const now = new Date().toISOString()
    const doc: Omit<MenuItem, '_key'> = {
      title: body.title,
      href: body.href,
      icon: body.icon || undefined,
      badge: body.badge || undefined,
      parentKey: body.parentKey || null,
      groupKey: body.groupKey,
      groupTitle: body.groupTitle || undefined,
      sortOrder: body.sortOrder ?? 0,
      isGroup: body.isGroup ?? false,
      enabled: body.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    }

    const key = body._key || body.title.toLowerCase().replace(/\s+/g, '-')
    const result = await collection.save({ ...doc, _key: key }, { returnNew: true })

    return NextResponse.json({ item: result.new }, { status: 201 })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('POST /api/menu error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    await initDb()
    const db = getDatabase()
    const body = await request.json()
    const collection = db.collection('menu_items')

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

    return NextResponse.json({ item: result.new })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('PUT /api/menu error:', message)
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

    const collection = db.collection('menu_items')

    const childrenCursor = await db.query(aql`
      FOR item IN menu_items
      FILTER item.parentKey == ${key}
      RETURN item._key
    `)
    const childKeys = await childrenCursor.all()

    for (const childKey of childKeys) {
      await collection.remove(childKey)
    }

    await collection.remove(key)

    return NextResponse.json({ deleted: key, childrenDeleted: childKeys.length })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('DELETE /api/menu error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
