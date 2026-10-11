import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, ensureDatabase, ensureCollection } from '@/lib/arangodb'
import {
  DEFAULT_SYSTEM_SETTINGS,
  SETTINGS_COLLECTION,
  SETTINGS_DOC_KEY,
  migrateSettings,
} from '@/lib/system-settings-defaults'
import type { SystemSettings } from '@/lib/system-settings-defaults'

async function initDb() {
  await ensureDatabase()
  await ensureCollection(SETTINGS_COLLECTION)
}

export async function GET() {
  try {
    await initDb()
    const db = getDatabase()
    const collection = db.collection(SETTINGS_COLLECTION)

    try {
      const doc = await collection.document(SETTINGS_DOC_KEY)
      const settings = migrateSettings(doc) ?? DEFAULT_SYSTEM_SETTINGS
      return NextResponse.json({ settings })
    } catch {
      // 尚無文件 → 回傳預設（前端會做 localStorage 遷移並 PUT）
      return NextResponse.json({ settings: DEFAULT_SYSTEM_SETTINGS })
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('GET /api/system-settings error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    await initDb()
    const body = (await request.json()) as unknown
    const settings = migrateSettings(body)

    if (!settings) {
      return NextResponse.json({ error: 'settings payload is invalid' }, { status: 400 })
    }

    const db = getDatabase()
    const collection = db.collection(SETTINGS_COLLECTION)
    const now = new Date().toISOString()

    const doc: SystemSettings & { _key: string; updatedAt: string } = {
      ...settings,
      _key: SETTINGS_DOC_KEY,
      updatedAt: now,
    }

    await collection.save(doc, { overwrite: true })
    return NextResponse.json({ settings })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('PUT /api/system-settings error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
