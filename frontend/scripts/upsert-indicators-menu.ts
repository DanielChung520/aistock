import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { ensureDatabase, ensureCollection, getDatabase } from '../src/lib/arangodb'
import { aql } from 'arangojs'

const now = new Date().toISOString()

async function upsertIndicatorsMenuItem() {
  await ensureDatabase()
  await ensureCollection('menu_items')
  await ensureCollection('menu_groups')

  const db = getDatabase()
  const items = db.collection('menu_items')
  const groups = db.collection('menu_groups')

  // Ensure group exists (basic-data 通常已存在)
  const groupCursor = await db.query(aql`
    RETURN DOCUMENT(${groups}, 'basic-data')
  `)
  const group = await groupCursor.next()
  if (!group) {
    await groups.save({
      _key: 'basic-data',
      title: '基礎資料',
      sortOrder: 1,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    })
    console.log('  + group: basic-data')
  }

  // Upsert menu item 指標管理
  const existing = await db.query(aql`
    FOR i IN ${items}
      FILTER i._key == 'indicators' OR i.href == '/indicators'
      LIMIT 1
      RETURN i
  `)
  const doc = await existing.next()

  const payload = {
    title: '指標管理',
    href: '/indicators',
    groupKey: 'basic-data',
    groupTitle: '基礎資料',
    parentKey: null,
    sortOrder: 2,
    isGroup: false,
    enabled: true,
    icon: 'LineChart',
    createdAt: doc?.createdAt ?? now,
    updatedAt: now,
  }

  if (doc) {
    await items.update(doc._key, payload)
    console.log(`  ~ updated: ${doc._key} (${doc.title})`)
  } else {
    await items.save({ _key: 'indicators', ...payload })
    console.log('  + inserted: indicators (指標管理)')
  }

  console.log('Done.')
}

upsertIndicatorsMenuItem().catch((err) => {
  console.error('Failed:', err)
  process.exit(1)
})
