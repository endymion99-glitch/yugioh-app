// Bot settings (/config) and the per-stage match formats.
import type { BestOf, Stage, StageFormats } from '../logic/bracket'
import { DEFAULT_STAGE_FORMATS } from '../logic/bracket'

export type ConfigKey = 'admin_role_id' | 'channel_id'

export async function getConfig(db: D1Database, key: ConfigKey): Promise<string | null> {
  return db.prepare('SELECT value FROM config WHERE key = ?').bind(key).first<string>('value')
}

export async function setConfig(db: D1Database, key: ConfigKey, value: string): Promise<void> {
  await db
    .prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
    .bind(key, value)
    .run()
}

export async function getStageFormats(db: D1Database): Promise<StageFormats> {
  const { results } = await db.prepare('SELECT stage, best_of FROM stage_formats').all<{ stage: Stage; best_of: BestOf }>()
  const formats = { ...DEFAULT_STAGE_FORMATS }
  for (const r of results) formats[r.stage] = r.best_of
  return formats
}

export async function setStageFormat(db: D1Database, stage: Stage, bestOf: BestOf): Promise<void> {
  await db
    .prepare(
      'INSERT INTO stage_formats (stage, best_of) VALUES (?, ?) ON CONFLICT (stage) DO UPDATE SET best_of = excluded.best_of'
    )
    .bind(stage, bestOf)
    .run()
}
