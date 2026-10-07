// A minimal in-memory stand-in for Cloudflare D1, built on Node's own SQLite.
// D1 is SQLite too, so the real migrations run unchanged and queries behave
// the same. Only the parts of the D1 API the bot uses are implemented.
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

type Value = string | number | null | boolean
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations')

class FakeStatement {
  constructor(
    private db: DatabaseSync,
    private sql: string,
    private params: Value[] = []
  ) {}

  bind(...values: Value[]) {
    for (const v of values) if (v === undefined) throw new Error('D1_TYPE_ERROR: undefined is not a valid bind value')
    return new FakeStatement(this.db, this.sql, values)
  }

  private stmt(): StatementSync {
    return this.db.prepare(this.sql)
  }

  private args() {
    return this.params.map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v))
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = this.stmt().get(...this.args()) as Record<string, unknown> | undefined
    if (!row) return null
    return (column ? row[column] : { ...row }) as T
  }

  async all<T = Record<string, unknown>>() {
    const rows = this.stmt().all(...this.args()) as Record<string, unknown>[]
    return { success: true, results: rows.map((r) => ({ ...r })) as T[], meta: {} }
  }

  async run() {
    const res = this.stmt().run(...this.args())
    return { success: true, results: [], meta: { changes: Number(res.changes), last_row_id: Number(res.lastInsertRowid) } }
  }

  /** Used by batch(): runs the statement and returns rows like D1 does. */
  execForBatch() {
    const stmt = this.stmt()
    if (stmt.columns().length > 0) {
      return { success: true, results: (stmt.all(...this.args()) as object[]).map((r) => ({ ...r })), meta: {} }
    }
    const res = stmt.run(...this.args())
    return { success: true, results: [], meta: { changes: Number(res.changes), last_row_id: Number(res.lastInsertRowid) } }
  }
}

export function createTestDb(): D1Database & { sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys = ON') // D1 always enforces foreign keys
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(join(migrationsDir, file), 'utf8'))
  }

  const db = {
    sqlite,
    prepare: (sql: string) => new FakeStatement(sqlite, sql),
    async batch(statements: FakeStatement[]) {
      sqlite.exec('BEGIN')
      try {
        const results = statements.map((s) => s.execForBatch())
        sqlite.exec('COMMIT')
        return results
      } catch (err) {
        sqlite.exec('ROLLBACK')
        throw err
      }
    },
    async exec(sql: string) {
      sqlite.exec(sql)
      return { count: 0, duration: 0 }
    }
  }
  return db as unknown as D1Database & { sqlite: DatabaseSync }
}
