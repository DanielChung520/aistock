import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { ensureDatabase, getDatabase } from '../src/lib/arangodb'

async function reset() {
  await ensureDatabase()
  const db = getDatabase()

  const collections = ['menu_items', 'menu_groups']

  for (const name of collections) {
    const col = db.collection(name)
    const exists = await col.exists()
    if (exists) {
      await col.drop()
      console.log(`Dropped collection: ${name}`)
    }
  }

  console.log('Reset completed. Run "pnpm run db:seed" to re-seed.')
}

reset().catch((err) => {
  console.error('Reset failed:', err)
  process.exit(1)
})
