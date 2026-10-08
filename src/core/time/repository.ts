import { cleanText } from '../clients.js'
import { addDays, cleanDate, localToday } from '../dates.js'
import { localUserId, type DB } from '../db.js'
import { newId, now } from '../ids.js'
import { isWithin, pathKey } from '../paths.js'
import type { ProjectRepository } from '../projects.js'
import type { SettingsRepository } from '../settings.js'
import { UserError, type Project } from '../types.js'
import { buildBlocks, minutesPerDay, type Block, type Signal } from './blocks.js'
import { parseDuration } from './duration.js'
import { daysOf, localDateOf, localDayStartMinute, minuteKey, minuteToMs } from './periods.js'
import type { DateRange, GroupBy, TimeEntry, TimeReport, WorkBlock } from './types.js'

export { GROUP_BY } from './types.js'
export type { GroupBy, ReportRow, TimeEntry, TimeReport, WorkBlock } from './types.js'

export interface ReportFilters {
  projectId?: string
  clientId?: string
  categoryId?: string
}

export interface EntryInput {
  projectId?: string
  date?: string
  minutes?: number | string
  note?: string
}

interface ActivityRow {
  cwd_key: string
  cwd: string
  minute: string
  source: 'claude' | 'git'
  session_id: string | null
}

/** Per project (or unassigned cwd) accumulator. */
interface Bucket {
  autoPerDay: Map<string, number>
  manualPerDay: Map<string, number>
  costPerDay: Map<string, number>
}

const round = (n: number) => Math.round(n * 100) / 100

export class TimeRepository {
  constructor(
    private readonly db: DB,
    private readonly projects: ProjectRepository,
    private readonly settings: SettingsRepository,
  ) {}

  report(range: DateRange, by: GroupBy = 'project', filters: ReportFilters = {}): TimeReport {
    const { idleMinutes } = this.settings.get()
    const all = this.projects.list({ all: true })
    const included = all.filter(
      (p) =>
        (!filters.projectId || p.id === filters.projectId) &&
        (!filters.clientId || (p.client?.id ?? 'none') === filters.clientId) &&
        (!filters.categoryId || (p.category?.id ?? 'none') === filters.categoryId),
    )
    const includedIds = new Set(included.map((p) => p.id))
    const filtered = !!(filters.projectId || filters.clientId || filters.categoryId)
    const days = daysOf(range)
    const { buckets, signals, unassignedCwd } = this.collect(range, idleMinutes, this.attributor(all))
    const inRange = new Set(days)

    // Keep the buckets this report covers.
    const kept = [...buckets].filter(([key]) => (key.startsWith('cwd:') ? !filtered : includedIds.has(key)))
    const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0)
    const totals = { minutes: 0, autoMinutes: 0, manualMinutes: 0, costUsd: 0 }
    const daySeries = new Map(days.map((d) => [d, { date: d, minutes: 0, costUsd: 0 }]))
    // Totals use wall-clock time: work on parallel projects counts once (union of all signals),
    // while per-project rows below count each project's own blocks.
    const allSignals = kept.flatMap(([key]) => signals.get(key) ?? [])
    for (const [day, minutes] of minutesPerDay(buildBlocks(allSignals, idleMinutes))) {
      if (!inRange.has(day)) continue
      totals.autoMinutes += minutes
      daySeries.get(day)!.minutes += minutes
    }
    for (const [, b] of kept) {
      totals.manualMinutes += sum(b.manualPerDay)
      totals.costUsd += sum(b.costPerDay)
      for (const [d, m] of b.manualPerDay) daySeries.get(d)!.minutes += m
      for (const [d, c] of b.costPerDay) daySeries.get(d)!.costUsd += c
    }
    totals.minutes = totals.autoMinutes + totals.manualMinutes
    // Shares are relative to the sum of rows (which may exceed wall-clock time).
    const rowTotal = kept
      .filter(([key]) => !key.startsWith('cwd:'))
      .reduce((acc, [, b]) => acc + sum(b.autoPerDay) + sum(b.manualPerDay), 0)

    const byProject = new Map(all.map((p) => [p.id, p]))
    const groups = new Map<string, { label: string; color: string | null; minutes: number; costUsd: number }>()
    const add = (key: string, label: string, color: string | null, minutes: number, cost: number) => {
      const g = groups.get(key) ?? { label, color, minutes: 0, costUsd: 0 }
      g.minutes += minutes
      g.costUsd += cost
      groups.set(key, g)
    }
    if (by === 'day') {
      for (const d of daySeries.values()) add(d.date, d.date, null, d.minutes, d.costUsd)
    } else {
      for (const [key, b] of kept) {
        const project = byProject.get(key)
        if (!project) continue // unassigned activity is reported separately
        const minutes = sum(b.autoPerDay) + sum(b.manualPerDay)
        const cost = sum(b.costPerDay)
        if (by === 'project') add(project.id, project.name, project.category?.color ?? null, minutes, cost)
        if (by === 'client') add(project.client?.id ?? 'none', project.client?.name ?? 'No client', null, minutes, cost)
        if (by === 'category') {
          add(project.category?.id ?? 'none', project.category?.name ?? 'No category', project.category?.color ?? null, minutes, cost)
        }
      }
    }

    const reportRows = [...groups]
      .map(([key, g]) => ({
        key,
        label: g.label,
        color: g.color,
        minutes: Math.round(g.minutes),
        costUsd: round(g.costUsd),
        share: by === 'day' ? (totals.minutes ? g.minutes / totals.minutes : 0) : rowTotal ? g.minutes / rowTotal : 0,
      }))
      .filter((r) => by === 'day' || r.minutes > 0 || r.costUsd > 0)
      .sort((a, b) => (by === 'day' ? a.key.localeCompare(b.key) : b.minutes - a.minutes || b.costUsd - a.costUsd))

    const unassigned = filtered
      ? []
      : kept
          .filter(([key]) => key.startsWith('cwd:'))
          .map(([key, b]) => ({ cwd: unassignedCwd.get(key)!, minutes: Math.round(sum(b.autoPerDay)), costUsd: round(sum(b.costPerDay)) }))
          .filter((u) => u.minutes > 0 || u.costUsd > 0)
          .sort((a, b) => b.minutes - a.minutes)

    return {
      range,
      by,
      totals: {
        minutes: Math.round(totals.minutes),
        autoMinutes: Math.round(totals.autoMinutes),
        manualMinutes: Math.round(totals.manualMinutes),
        costUsd: round(totals.costUsd),
      },
      rows: reportRows,
      days: [...daySeries.values()].map((d) => ({ date: d.date, minutes: Math.round(d.minutes), costUsd: round(d.costUsd) })),
      unassigned,
    }
  }

  /**
   * Per project (or `cwd:<key>` for unassigned folders): minutes per local day (automatic
   * per-project blocks + manual entries) and API-equivalent AI cost (USD) per day.
   */
  daily(range: DateRange): Map<string, { minutes: Map<string, number>; costUsd: Map<string, number> }> {
    const { idleMinutes } = this.settings.get()
    const { buckets } = this.collect(range, idleMinutes, this.attributor(this.projects.list({ all: true })))
    const out = new Map<string, { minutes: Map<string, number>; costUsd: Map<string, number> }>()
    for (const [key, b] of buckets) {
      const minutes = new Map(b.autoPerDay)
      for (const [day, m] of b.manualPerDay) minutes.set(day, (minutes.get(day) ?? 0) + m)
      out.set(key, { minutes, costUsd: new Map(b.costPerDay) })
    }
    return out
  }

  private collect(range: DateRange, idleMinutes: number, attribute: (cwdKey: string) => Project | null) {
    const inRange = new Set(daysOf(range))
    // Look back one idle window so a block that started before the range keeps its true shape;
    // per-day minutes are clipped to the range below.
    const rows = this.activity(range, idleMinutes)

    // Group signals by project id, or by cwd for unassigned activity.
    const signals = new Map<string, Signal[]>()
    const unassignedCwd = new Map<string, string>()
    for (const r of rows) {
      const project = attribute(r.cwd_key)
      const key = project ? project.id : `cwd:${r.cwd_key}`
      if (!project) unassignedCwd.set(key, r.cwd)
      let list = signals.get(key)
      if (!list) signals.set(key, (list = []))
      list.push({ at: minuteToMs(r.minute), source: r.source, sessionId: r.session_id })
    }

    const buckets = new Map<string, Bucket>()
    const bucket = (key: string) => {
      let b = buckets.get(key)
      if (!b) buckets.set(key, (b = { autoPerDay: new Map(), manualPerDay: new Map(), costPerDay: new Map() }))
      return b
    }

    for (const [key, list] of signals) {
      const b = bucket(key)
      for (const [day, minutes] of minutesPerDay(buildBlocks(list, idleMinutes))) {
        if (inRange.has(day)) b.autoPerDay.set(day, (b.autoPerDay.get(day) ?? 0) + minutes)
      }
    }

    // AI cost: each session's cost is spread over its active minutes, then clipped to the range.
    const sessionDays = new Map<string, Map<string, number>>()
    for (const r of this.sessionMinutes(range)) {
      let perDay = sessionDays.get(r.session_id)
      if (!perDay) sessionDays.set(r.session_id, (perDay = new Map()))
      const day = localDateOf(minuteToMs(r.minute))
      perDay.set(day, (perDay.get(day) ?? 0) + 1)
    }
    for (const session of this.sessions([...sessionDays.keys()])) {
      // Sessions whose folder is still unknown carry no attribution yet.
      if (session.total === 0 || session.cost_usd === 0 || !session.cwd_key) continue
      const project = attribute(session.cwd_key)
      const b = bucket(project ? project.id : `cwd:${session.cwd_key}`)
      if (!project) unassignedCwd.set(`cwd:${session.cwd_key}`, session.cwd)
      for (const [day, minutes] of sessionDays.get(session.session_id)!) {
        if (inRange.has(day)) b.costPerDay.set(day, (b.costPerDay.get(day) ?? 0) + (session.cost_usd * minutes) / session.total)
      }
    }

    for (const entry of this.entryRows(range)) {
      const b = bucket(entry.project_id)
      b.manualPerDay.set(entry.date, (b.manualPerDay.get(entry.date) ?? 0) + entry.minutes)
    }

    return { buckets, signals, unassignedCwd }
  }

  /** Automatic work blocks of one project, newest first. */
  blocks(projectId: string, range: DateRange): WorkBlock[] {
    if (!this.projects.get(projectId)) throw new UserError(`Project not found: ${projectId}`, 'not_found')
    const attribute = this.attributor(this.projects.list({ all: true }))
    const signals: Signal[] = this.activity(range, this.settings.get().idleMinutes)
      .filter((r) => attribute(r.cwd_key)?.id === projectId)
      .map((r) => ({ at: minuteToMs(r.minute), source: r.source, sessionId: r.session_id }))
    const rangeStart = minuteToMs(localDayStartMinute(range.from))
    return buildBlocks(signals, this.settings.get().idleMinutes)
      .filter((b) => b.end > rangeStart)
      .reverse()
      .map((b: Block) => ({
        start: new Date(b.start).toISOString(),
        end: new Date(b.end).toISOString(),
        minutes: b.minutes,
        sources: b.sources,
        sessionIds: b.sessionIds,
      }))
  }

  entries(range: DateRange, projectId?: string): TimeEntry[] {
    return this.entryRows(range)
      .filter((e) => !projectId || e.project_id === projectId)
      .map(toEntry)
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
  }

  addEntry(input: EntryInput): TimeEntry {
    const projectId = input.projectId ?? ''
    if (!this.projects.get(projectId)) throw new UserError(`Project not found: ${projectId}`, 'not_found')
    if (input.minutes === undefined) throw new UserError('Duration is required')
    const id = newId()
    const ts = now()
    this.db
      .prepare(
        `INSERT INTO time_entries (id, owner_id, project_id, date, minutes, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        localUserId(this.db),
        projectId,
        cleanDate(input.date ?? localToday()),
        parseDuration(input.minutes),
        cleanText(input.note, 2000),
        ts,
        ts,
      )
    return this.entry(id)!
  }

  updateEntry(id: string, input: EntryInput): TimeEntry {
    const entry = this.entry(id)
    if (!entry) throw new UserError(`Time entry not found: ${id}`, 'not_found')
    const projectId = input.projectId ?? entry.projectId
    if (!this.projects.get(projectId)) throw new UserError(`Project not found: ${projectId}`, 'not_found')
    this.db
      .prepare('UPDATE time_entries SET project_id = ?, date = ?, minutes = ?, note = ?, updated_at = ? WHERE id = ?')
      .run(
        projectId,
        input.date === undefined ? entry.date : cleanDate(input.date),
        input.minutes === undefined ? entry.minutes : parseDuration(input.minutes),
        input.note === undefined ? entry.note : cleanText(input.note, 2000),
        now(),
        id,
      )
    return this.entry(id)!
  }

  removeEntry(id: string): TimeEntry {
    const entry = this.entry(id)
    if (!entry) throw new UserError(`Time entry not found: ${id}`, 'not_found')
    const ts = now()
    this.db.prepare('UPDATE time_entries SET deleted_at = ?, updated_at = ? WHERE id = ?').run(ts, ts, id)
    return entry
  }

  /** Resolves a manual entry by id or id prefix (≥ 6 chars). */
  resolveEntry(ref: string): TimeEntry {
    const value = ref.trim().toLowerCase()
    const rows = value.length >= 6
      ? (this.db.prepare(`${ENTRY_SELECT} AND e.id LIKE ?`).all(`${value}%`) as unknown as EntryRow[])
      : []
    if (rows.length === 1) return toEntry(rows[0])
    if (rows.length > 1) throw new UserError(`"${ref}" matches ${rows.length} time entries; use more characters`, 'conflict')
    throw new UserError(`Time entry not found: ${ref}`, 'not_found')
  }

  private entry(id: string): TimeEntry | null {
    const row = this.db.prepare(`${ENTRY_SELECT} AND e.id = ?`).get(id) as EntryRow | undefined
    return row ? toEntry(row) : null
  }

  private entryRows(range: DateRange): EntryRow[] {
    return this.db.prepare(`${ENTRY_SELECT} AND e.date BETWEEN ? AND ?`).all(range.from, range.to) as unknown as EntryRow[]
  }

  private activity(range: DateRange, lookbackMinutes = 0): ActivityRow[] {
    const from = minuteKey(minuteToMs(localDayStartMinute(range.from)) - lookbackMinutes * 60_000)
    return this.db
      .prepare('SELECT cwd_key, cwd, minute, source, session_id FROM activity WHERE minute >= ? AND minute < ?')
      .all(from, localDayStartMinute(addDays(range.to, 1))) as unknown as ActivityRow[]
  }

  private sessionMinutes(range: DateRange): { session_id: string; minute: string }[] {
    return this.db
      .prepare('SELECT session_id, minute FROM session_minutes WHERE minute >= ? AND minute < ?')
      .all(localDayStartMinute(range.from), localDayStartMinute(addDays(range.to, 1))) as unknown as {
      session_id: string
      minute: string
    }[]
  }

  /** Sessions with their cost and total active minutes (all time). */
  private sessions(ids: string[]): { session_id: string; cwd_key: string; cwd: string; cost_usd: number; total: number }[] {
    const out: { session_id: string; cwd_key: string; cwd: string; cost_usd: number; total: number }[] = []
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500)
      const marks = chunk.map(() => '?').join(',')
      out.push(
        ...(this.db
          .prepare(
            `SELECT s.session_id, s.cwd_key, s.cwd, s.cost_usd,
               (SELECT COUNT(*) FROM session_minutes m WHERE m.session_id = s.session_id) AS total
             FROM ai_sessions s WHERE s.session_id IN (${marks})`,
          )
          .all(...chunk) as unknown as { session_id: string; cwd_key: string; cwd: string; cost_usd: number; total: number }[]),
      )
    }
    return out
  }

  /** Maps a cwd key to the deepest registered (non-deleted) project containing it. */
  private attributor(projects: Project[]): (cwdKey: string) => Project | null {
    const byDepth = projects
      .map((p) => ({ project: p, key: pathKey(p.path) }))
      .sort((a, b) => b.key.length - a.key.length)
    const cache = new Map<string, Project | null>()
    return (cwdKey) => {
      if (!cache.has(cwdKey)) cache.set(cwdKey, byDepth.find((p) => isWithin(cwdKey, p.key))?.project ?? null)
      return cache.get(cwdKey)!
    }
  }
}

interface EntryRow {
  id: string
  project_id: string
  project_name: string
  date: string
  minutes: number
  note: string
  created_at: string
  updated_at: string
}

const ENTRY_SELECT = `
  SELECT e.*, p.name AS project_name FROM time_entries e
  JOIN projects p ON p.id = e.project_id AND p.deleted_at IS NULL
  WHERE e.deleted_at IS NULL`

function toEntry(row: EntryRow): TimeEntry {
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    date: row.date,
    minutes: Number(row.minutes),
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
