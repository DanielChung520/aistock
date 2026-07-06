import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { ensureDatabase, ensureCollection, getDatabase } from '../src/lib/arangodb'
import { aql } from 'arangojs'
import type { MenuItem } from '../src/types/menu'

const now = new Date().toISOString()

const seedMenuItems: Omit<MenuItem, '_key'>[] = [
  // ── Group: 首頁 ──
  {
    title: '首頁',
    href: '/',
    groupKey: 'stock-analysis',
    groupTitle: '首頁',
    parentKey: null,
    sortOrder: 0,
    isGroup: false,
    enabled: true,
    icon: 'Home',
    createdAt: now,
    updatedAt: now,
  },
  {
    title: '自選股',
    href: '/watchlist',
    groupKey: 'stock-analysis',
    groupTitle: '首頁',
    parentKey: null,
    sortOrder: 1,
    isGroup: false,
    enabled: true,
    icon: 'Star',
    createdAt: now,
    updatedAt: now,
  },

  // ── Group: 基礎資料 ──
  {
    title: '證券代號',
    href: '/basics/stock-codes',
    groupKey: 'basic-data',
    groupTitle: '基礎資料',
    parentKey: null,
    sortOrder: 0,
    isGroup: false,
    enabled: true,
    icon: 'Grid3X3',
    createdAt: now,
    updatedAt: now,
  },
  {
    title: '券商資訊',
    href: '/basics/brokers',
    groupKey: 'basic-data',
    groupTitle: '基礎資料',
    parentKey: null,
    sortOrder: 1,
    isGroup: false,
    enabled: true,
    icon: 'Building2',
    createdAt: now,
    updatedAt: now,
  },

  // ── Group: 股票競拍 ──
  {
    title: '競拍公告',
    href: '/auction/announcements',
    groupKey: 'stock-auction',
    groupTitle: '股票競拍',
    parentKey: null,
    sortOrder: 0,
    isGroup: false,
    enabled: true,
    icon: 'Megaphone',
    createdAt: now,
    updatedAt: now,
  },
  {
    title: '我的競拍',
    href: '/auction/my-bids',
    groupKey: 'stock-auction',
    groupTitle: '股票競拍',
    parentKey: null,
    sortOrder: 1,
    isGroup: false,
    enabled: true,
    icon: 'Ticket',
    createdAt: now,
    updatedAt: now,
  },

  // ── Group: 系統管理 ──
  {
    title: '選單管理',
    href: '/admin/menu',
    groupKey: 'system-admin',
    groupTitle: '系統管理',
    parentKey: null,
    sortOrder: 0,
    isGroup: false,
    enabled: true,
    icon: 'Settings',
    createdAt: now,
    updatedAt: now,
  },
]

async function seed() {
  console.log('Ensuring database exists...')
  await ensureDatabase()

  console.log('Ensuring menu_items collection...')
  await ensureCollection('menu_items')

  const db = getDatabase()
  const collection = db.collection('menu_items')

  // Check if already seeded
  const countCursor = await db.query(aql`
    RETURN LENGTH(${collection})
  `)
  const count = await countCursor.next()

  if (count > 0) {
    console.log(`menu_items already has ${count} documents. Skipping seed.`)
    console.log('To re-seed, run: pnpm run db:reset && pnpm run db:seed')
    return
  }

  // Generate _key from title (use keyMap for Chinese titles)
  const keyMap: Record<string, string> = {
    '首頁': 'home',
    '自選股': 'watchlist',
    '證券代號': 'stock-codes',
    '券商資訊': 'brokers',
    '競拍公告': 'auction-announcements',
    '我的競拍': 'my-bids',
    '選單管理': 'menu-admin',
  }

  const documents = seedMenuItems.map((item) => ({
    ...item,
    _key: keyMap[item.title] || item.title.toLowerCase().replace(/\s+/g, '-'),
  }))

  console.log(`Inserting ${documents.length} menu items...`)

  for (const doc of documents) {
    await collection.save(doc)
    console.log(`  + ${doc.groupKey} / ${doc.title}`)
  }

  // Also create a menu_groups collection for group metadata
  await ensureCollection('menu_groups')
  const groupsCol = db.collection('menu_groups')

  const groupCountCursor = await db.query(aql`
    RETURN LENGTH(${groupsCol})
  `)
  const groupCount = await groupCountCursor.next()

  if (groupCount === 0) {
    const groups = [
      { _key: 'stock-analysis', title: '首頁', sortOrder: 0, enabled: true, createdAt: now, updatedAt: now },
      { _key: 'basic-data', title: '基礎資料', sortOrder: 1, enabled: true, createdAt: now, updatedAt: now },
      { _key: 'stock-auction', title: '股票競拍', sortOrder: 2, enabled: true, createdAt: now, updatedAt: now },
      { _key: 'system-admin', title: '系統管理', sortOrder: 3, enabled: true, createdAt: now, updatedAt: now },
    ]

    for (const group of groups) {
      await groupsCol.save(group)
      console.log(`  + group: ${group.title}`)
    }
  }

  console.log('Seed completed successfully!')
}

seed().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
