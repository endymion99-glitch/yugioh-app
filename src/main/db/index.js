import Database from 'better-sqlite3'
import { MIGRATIONS, SCHEMA_VERSION } from './schema.js'

/**
 * Opens (or creates) the SQLite database and brings its schema up to date.
 * Pass ':memory:' for tests.
 */
export function openDatabase(filePath) {
  const db = new Database(filePath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

export function migrate(db) {
  const current = db.pragma('user_version', { simple: true })
  if (current > SCHEMA_VERSION) {
    throw new Error(
      `Database schema v${current} is newer than this app supports (v${SCHEMA_VERSION}). ` +
        'Please update the app.'
    )
  }
  const run = db.transaction(() => {
    for (let v = current; v < SCHEMA_VERSION; v++) {
      db.exec(MIGRATIONS[v])
      db.pragma(`user_version = ${v + 1}`)
    }
  })
  run()
}
