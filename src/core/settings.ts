import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { DB } from './db.js'
import { UserError } from './types.js'

/** Your details printed on statements, and how statements are numbered. */
export interface Billing {
  name: string
  address: string
  taxId: string
  iban: string
  footer: string
  numberPrefix: string
  /** Default VAT percent shown on new statements (display only: mmp amounts are net). */
  vatRate: number
  dueDays: number
}

export const DEFAULT_BILLING: Billing = { name: '', address: '', taxId: '', iban: '', footer: '', numberPrefix: 'PF-', vatRate: 22, dueDays: 30 }

export interface Settings {
  /** Folder names never treated as projects. */
  ignoreNames: string[]
  /** A gap longer than this closes a work block. */
  idleMinutes: number
  /** Where Claude Code keeps its session transcripts. */
  claudeProjectsDir: string
  weekStart: 'monday' | 'sunday'
  /** Base currency for all money (ISO 4217 code). */
  currency: string
  /** Base-currency units per US dollar, used to convert AI costs. */
  usdRate: number
  billing: Billing
}

export type SettingsPatch = Partial<Omit<Settings, 'billing'>> & { billing?: Partial<Billing> }

export const DEFAULT_SETTINGS: Settings = {
  ignoreNames: ['node_modules', 'vendor', '$RECYCLE.BIN', 'System Volume Information'],
  idleMinutes: 15,
  claudeProjectsDir: join(homedir(), '.claude', 'projects'),
  weekStart: 'monday',
  currency: 'EUR',
  usdRate: 1,
  billing: DEFAULT_BILLING,
}

export class SettingsRepository {
  constructor(private readonly db: DB) {}

  get(): Settings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
    const stored = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]))
    return { ...DEFAULT_SETTINGS, ...stored, billing: { ...DEFAULT_BILLING, ...(stored.billing ?? {}) } }
  }

  update(patch: SettingsPatch): Settings {
    const values: Partial<Settings> = {}
    if (patch.billing !== undefined) values.billing = cleanBilling({ ...this.get().billing, ...patch.billing })
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
    if (patch.currency !== undefined) {
      const currency = String(patch.currency).trim().toUpperCase()
      if (!/^[A-Z]{3}$/.test(currency)) throw new UserError('currency must be a 3-letter code such as EUR or USD')
      values.currency = currency
    }
    if (patch.usdRate !== undefined) {
      if (typeof patch.usdRate !== 'number' || !(patch.usdRate > 0) || patch.usdRate > 10_000) {
        throw new UserError('usdRate must be a positive number (base currency units per US dollar)')
      }
      values.usdRate = patch.usdRate
    }
    for (const [key, value] of Object.entries(values)) {
      this.db
        .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .run(key, JSON.stringify(value))
    }
    return this.get()
  }
}

function cleanBilling(b: Billing): Billing {
  const text = (value: unknown, label: string, max = 2000) => {
    const s = String(value ?? '').trim()
    if (s.length > max) throw new UserError(`${label} is too long (max ${max} characters)`)
    return s
  }
  const numberPrefix = text(b.numberPrefix, 'numberPrefix', 12)
  if (!/^[A-Za-z0-9/_-]*$/.test(numberPrefix)) throw new UserError('The number prefix may only contain letters, digits, "-", "_" and "/"')
  if (typeof b.vatRate !== 'number' || !(b.vatRate >= 0 && b.vatRate <= 100)) throw new UserError('vatRate must be a percentage between 0 and 100')
  if (!Number.isInteger(b.dueDays) || b.dueDays < 0 || b.dueDays > 365) throw new UserError('dueDays must be a whole number of days between 0 and 365')
  return {
    name: text(b.name, 'name', 200),
    address: text(b.address, 'address'),
    taxId: text(b.taxId, 'taxId', 100),
    iban: text(b.iban, 'iban', 100),
    footer: text(b.footer, 'footer'),
    numberPrefix,
    vatRate: b.vatRate,
    dueDays: b.dueDays,
  }
}
