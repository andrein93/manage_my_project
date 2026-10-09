import { addDays } from './dates.js'
import { localUserId, transaction, type DB } from './db.js'
import { newId, now } from './ids.js'
import { cleanName, resolveRef, uniqueName } from './refs.js'
import { UserError } from './types.js'

import { FIELD_KINDS, type FieldKind, type FieldValue, type ProjectField, type UpcomingFieldDate } from './field-types.js'

export { FIELD_KINDS }
export type { FieldKind, FieldValue, ProjectField, UpcomingFieldDate }

type Row = Record<string, unknown>

const DEFAULT_REMIND_DAYS = 30

/** User-defined project fields (production URL, domain expiry…). Local only: not team-synced. */
export class FieldRepository {
  constructor(private readonly db: DB) {}

  list(): ProjectField[] {
    return (this.db.prepare('SELECT * FROM project_fields WHERE deleted_at IS NULL ORDER BY position, name COLLATE NOCASE').all() as Row[]).map(toField)
  }

  /** id, id prefix or name. */
  resolve(ref: string): ProjectField {
    return resolveRef(this.list(), ref, 'field', '. Define it first (Settings → Custom fields, or mmp field add).')
  }

  create(input: { name?: string; kind?: string; remindDays?: number | null }): ProjectField {
    const name = cleanName(input.name, 'field', 60)
    const kind = cleanKind(input.kind)
    const remindDays = kind === 'date' ? cleanRemind(input.remindDays === undefined ? DEFAULT_REMIND_DAYS : input.remindDays) : null
    if (kind !== 'date' && input.remindDays != null) throw new UserError('Reminders are only for date fields')
    const id = newId()
    const ts = now()
    transaction(this.db, () => {
      this.requireUniqueName(name)
      const max = this.db.prepare('SELECT MAX(position) AS p FROM project_fields WHERE deleted_at IS NULL').get() as { p: number | null }
      uniqueName('field', name, () =>
        this.db
          .prepare('INSERT INTO project_fields (id, owner_id, name, kind, position, remind_days, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(id, localUserId(this.db), name, kind, (max.p ?? 0) + 1, remindDays, ts, ts),
      )
    })
    return this.require(id)
  }

  update(id: string, input: { name?: string; remindDays?: number | null }): ProjectField {
    const field = this.require(id)
    const name = input.name === undefined ? field.name : cleanName(input.name, 'field', 60)
    if (input.remindDays !== undefined && field.kind !== 'date') throw new UserError('Reminders are only for date fields')
    const remindDays = input.remindDays === undefined ? field.remindDays : cleanRemind(input.remindDays)
    if (name.toLowerCase() !== field.name.toLowerCase()) this.requireUniqueName(name)
    this.db.prepare('UPDATE project_fields SET name = ?, remind_days = ?, updated_at = ? WHERE id = ?').run(name, remindDays, now(), id)
    return this.require(id)
  }

  move(id: string, direction: 'up' | 'down'): ProjectField[] {
    this.require(id)
    transaction(this.db, () => {
      const list = this.list()
      const i = list.findIndex((f) => f.id === id)
      const j = direction === 'up' ? i - 1 : i + 1
      if (j < 0 || j >= list.length) return
      ;[list[i], list[j]] = [list[j], list[i]]
      const update = this.db.prepare('UPDATE project_fields SET position = ?, updated_at = ? WHERE id = ?')
      list.forEach((f, k) => update.run(k + 1, now(), f.id))
    })
    return this.list()
  }

  /** Removes the field and every project's value for it. */
  remove(id: string): ProjectField {
    const field = this.require(id)
    const ts = now()
    transaction(this.db, () => {
      this.db.prepare('UPDATE project_fields SET deleted_at = ?, updated_at = ? WHERE id = ?').run(ts, ts, id)
      this.db.prepare('DELETE FROM project_field_values WHERE field_id = ?').run(id)
    })
    return field
  }

  /** Every defined field with this project's value ('' when unset). */
  values(projectId: string): FieldValue[] {
    const stored = new Map(
      (this.db.prepare('SELECT field_id, value FROM project_field_values WHERE project_id = ?').all(projectId) as Row[]).map((r) => [
        String(r.field_id),
        String(r.value),
      ]),
    )
    return this.list().map((f) => ({ fieldId: f.id, name: f.name, kind: f.kind, value: stored.get(f.id) ?? '' }))
  }

  /** Sets values by field id; '' or null clears. Validates each value for its field kind. */
  setValues(projectId: string, values: Record<string, string | null>): FieldValue[] {
    const project = this.db.prepare('SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL').get(projectId)
    if (!project) throw new UserError(`Project not found: ${projectId}`, 'not_found')
    const fields = new Map(this.list().map((f) => [f.id, f]))
    const clean = Object.entries(values).map(([fieldId, raw]) => {
      const field = fields.get(fieldId)
      if (!field) throw new UserError(`Field not found: ${fieldId}`, 'not_found')
      return [fieldId, raw === null ? '' : cleanValue(field, String(raw))] as const
    })
    const ts = now()
    transaction(this.db, () => {
      for (const [fieldId, value] of clean) {
        if (!value) this.db.prepare('DELETE FROM project_field_values WHERE project_id = ? AND field_id = ?').run(projectId, fieldId)
        else
          this.db
            .prepare(
              `INSERT INTO project_field_values (project_id, field_id, value, updated_at) VALUES (?, ?, ?, ?)
               ON CONFLICT(project_id, field_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
            )
            .run(projectId, fieldId, value, ts)
      }
    })
    return this.values(projectId)
  }

  /**
   * Date values inside their field's remind window (`daysLeft <= remindDays`), passed dates
   * included (an expired domain still needs attention), soonest first.
   */
  upcomingDates(today: string): UpcomingFieldDate[] {
    const rows = this.db
      .prepare(
        `SELECT v.project_id, p.name AS project_name, f.id AS field_id, f.name AS field_name, f.remind_days, v.value
         FROM project_field_values v
         JOIN project_fields f ON f.id = v.field_id AND f.deleted_at IS NULL AND f.kind = 'date' AND f.remind_days IS NOT NULL
         JOIN projects p ON p.id = v.project_id AND p.deleted_at IS NULL`,
      )
      .all() as Row[]
    return rows
      .map((r) => ({
        projectId: String(r.project_id),
        projectName: String(r.project_name),
        fieldId: String(r.field_id),
        fieldName: String(r.field_name),
        date: String(r.value),
        daysLeft: daysBetween(today, String(r.value)),
        remind: Number(r.remind_days),
      }))
      .filter((d) => d.daysLeft <= d.remind)
      .sort((a, b) => a.date.localeCompare(b.date) || a.projectName.localeCompare(b.projectName))
      .map(({ remind: _remind, ...d }) => d)
  }

  private require(id: string): ProjectField {
    const row = this.db.prepare('SELECT * FROM project_fields WHERE id = ? AND deleted_at IS NULL').get(id) as Row | undefined
    if (!row) throw new UserError(`Field not found: ${id}`, 'not_found')
    return toField(row)
  }

  private requireUniqueName(name: string) {
    const clash = this.db.prepare('SELECT 1 FROM project_fields WHERE name = ? COLLATE NOCASE AND deleted_at IS NULL').get(name)
    if (clash) throw new UserError(`A field named "${name}" already exists`, 'conflict')
  }
}

function toField(r: Row): ProjectField {
  return {
    id: String(r.id),
    name: String(r.name),
    kind: String(r.kind) as FieldKind,
    position: Number(r.position),
    remindDays: r.remind_days === null || r.remind_days === undefined ? null : Number(r.remind_days),
  }
}

function cleanKind(value: unknown): FieldKind {
  if (!FIELD_KINDS.includes(value as FieldKind)) throw new UserError(`Invalid field kind "${value}". Use one of: ${FIELD_KINDS.join(', ')}`)
  return value as FieldKind
}

function cleanRemind(value: number | null): number | null {
  if (value === null) return null
  if (!Number.isInteger(value) || value < 0 || value > 365) throw new UserError('remindDays must be a whole number of days between 0 and 365')
  return value
}

function cleanValue(field: ProjectField, raw: string): string {
  const value = raw.trim()
  if (!value) return ''
  if (field.kind === 'url') {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      throw new UserError(`${field.name}: "${value}" is not a link (use http:// or https://)`)
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new UserError(`${field.name}: only http and https links are allowed`)
    return value
  }
  if (field.kind === 'date') {
    const ok = /^\d{4}-\d{2}-\d{2}$/.test(value) && addDays(value, 0) === value
    if (!ok) throw new UserError(`${field.name}: "${value}" is not a valid date (YYYY-MM-DD)`)
    return value
  }
  if (field.kind === 'number') {
    const n = Number(value.replace(',', '.'))
    if (!Number.isFinite(n)) throw new UserError(`${field.name}: "${value}" is not a number`)
    return String(n)
  }
  if (value.length > 2000) throw new UserError(`${field.name}: text is too long (max 2000 characters)`)
  return value
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000)
}
