import type { DB } from './db.js'
import { UserError } from './types.js'

export interface Settings {
  /** Folder names never treated as projects. */
  ignoreNames: string[]
}

export const DEFAULT_SETTINGS: Settings = {
  ignoreNames: ['node_modules', 'vendor', '$RECYCLE.BIN', 'System Volume Information'],
}

export class SettingsRepository {
  constructor(private readonly db: DB) {}

  get(): Settings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
    const stored = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]))
    return { ...DEFAULT_SETTINGS, ...stored }
  }

  update(patch: Partial<Settings>): Settings {
    if (patch.ignoreNames !== undefined) {
      if (!Array.isArray(patch.ignoreNames) || patch.ignoreNames.some((n) => typeof n !== 'string')) {
        throw new UserError('ignoreNames must be a list of folder names')
      }
      const names = [...new Set(patch.ignoreNames.map((n) => n.trim()).filter(Boolean))]
      this.db
        .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .run('ignoreNames', JSON.stringify(names))
    }
    return this.get()
  }
}
