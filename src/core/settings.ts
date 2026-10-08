import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { DB } from './db.js'
import { UserError } from './types.js'

export interface Settings {
  /** Folder names never treated as projects. */
  ignoreNames: string[]
  /** A gap longer than this closes a work block. */
  idleMinutes: number
  /** Where Claude Code keeps its session transcripts. */
  claudeProjectsDir: string
  weekStart: 'monday' | 'sunday'
}

export const DEFAULT_SETTINGS: Settings = {
  ignoreNames: ['node_modules', 'vendor', '$RECYCLE.BIN', 'System Volume Information'],
  idleMinutes: 15,
  claudeProjectsDir: join(homedir(), '.claude', 'projects'),
  weekStart: 'monday',
}

export class SettingsRepository {
  constructor(private readonly db: DB) {}

  get(): Settings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
    const stored = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]))
    return { ...DEFAULT_SETTINGS, ...stored }
  }

  update(patch: Partial<Settings>): Settings {
    const values: Partial<Settings> = {}
    if (patch.ignoreNames !== undefined) {
      if (!Array.isArray(patch.ignoreNames) || patch.ignoreNames.some((n) => typeof n !== 'string')) {
        throw new UserError('ignoreNames must be a list of folder names')
      }
      values.ignoreNames = [...new Set(patch.ignoreNames.map((n) => n.trim()).filter(Boolean))]
    }
    if (patch.idleMinutes !== undefined) {
      if (!Number.isInteger(patch.idleMinutes) || patch.idleMinutes < 5 || patch.idleMinutes > 120) {
        throw new UserError('idleMinutes must be a whole number between 5 and 120')
      }
      values.idleMinutes = patch.idleMinutes
    }
    if (patch.claudeProjectsDir !== undefined) {
      const dir = String(patch.claudeProjectsDir).trim()
      if (/^(\\\\|\/\/)/.test(dir)) throw new UserError('Network paths are not allowed for the transcripts folder')
      const resolved = dir ? resolve(dir) : DEFAULT_SETTINGS.claudeProjectsDir
      let isDir = false
      try {
        isDir = statSync(resolved).isDirectory()
      } catch {
        // handled below
      }
      if (!isDir && dir) throw new UserError(`Not a folder: ${resolved}`)
      values.claudeProjectsDir = resolved
    }
    if (patch.weekStart !== undefined) {
      if (patch.weekStart !== 'monday' && patch.weekStart !== 'sunday') throw new UserError('weekStart must be monday or sunday')
      values.weekStart = patch.weekStart
    }
    for (const [key, value] of Object.entries(values)) {
      this.db
        .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .run(key, JSON.stringify(value))
    }
    return this.get()
  }
}
