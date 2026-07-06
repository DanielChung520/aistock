import { Database } from 'arangojs'

let db: Database | null = null

export function getDatabase(): Database {
  if (!db) {
    db = new Database({
      url: process.env.ARANGO_URL || 'http://localhost:8530',
      databaseName: process.env.ARANGO_DB || 'aistock',
      auth: {
        username: process.env.ARANGO_USER || 'root',
        password: process.env.ARANGO_PASSWORD || '',
      },
    })
  }
  return db
}

export function getSystemDatabase(): Database {
  return new Database({
    url: process.env.ARANGO_URL || 'http://localhost:8530',
    databaseName: '_system',
    auth: {
      username: process.env.ARANGO_USER || 'root',
      password: process.env.ARANGO_PASSWORD || '',
    },
  })
}

export async function ensureDatabase(): Promise<Database> {
  const sysDb = getSystemDatabase()
  const dbName = process.env.ARANGO_DB || 'aistock'

  const databases = await sysDb.listDatabases()
  if (!databases.includes(dbName)) {
    await sysDb.createDatabase(dbName)
  }

  return getDatabase()
}

export async function ensureCollection(collectionName: string): Promise<void> {
  const db = getDatabase()
  const collection = db.collection(collectionName)
  const exists = await collection.exists()
  if (!exists) {
    await db.createCollection(collectionName)
  }
}
