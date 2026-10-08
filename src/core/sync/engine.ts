import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { addDays, localToday } from '../dates.js'
import { transaction, type DB } from '../db.js'
import { now } from '../ids.js'
import type { TimeRepository } from '../time/repository.js'
import { UserError } from '../types.js'
import { VERSION } from '../../version.js'

export const SYNC_TABLES = [
  'clients',
  'categories',
  'projects',
  'tasks',
  'agreements',
  'payments',
  'expenses',
  'time_entries',
  'time_daily',
] as const
export type SyncTable = (typeof SYNC_TABLES)[number]

/** Columns carried in `data` (id, updated_at, deleted_at travel separately). Projects are special. */
const COLUMNS: Record<Exclude<SyncTable, 'projects'>, string[]> = {
  clients: ['owner_id', 'name', 'email', 'notes', 'created_at'],
  categories: ['owner_id', 'name', 'color', 'position', 'created_at'],
  tasks: ['owner_id', 'project_id', 'title', 'description', 'status', 'priority', 'due_date', 'position', 'completed_at', 'assignee_id', 'created_at'],
  agreements: ['owner_id', 'project_id', 'kind', 'amount_cents', 'interval', 'start_date', 'end_date', 'note', 'created_at'],
  payments: ['owner_id', 'project_id', 'agreement_id', 'date', 'amount_cents', 'note', 'created_at'],
  expenses: ['owner_id', 'project_id', 'amount_cents', 'interval', 'start_date', 'end_date', 'note', 'created_at'],
  time_entries: ['owner_id', 'project_id', 'date', 'minutes', 'note', 'created_at'],
  time_daily: ['user_id', 'project_id', 'date', 'minutes', 'cost_usd'],
}
const PROJECT_COLUMNS = ['owner_id', 'name', 'description', 'status', 'client_id', 'category_id', 'remote_key', 'created_at']

/** Rows of private projects never leave this machine. */
const SHARED_PROJECT = 'project_id IN (SELECT id FROM projects WHERE shared = 1)'
const SCOPE: Record<SyncTable, string> = {
  clients: '1',
  categories: '1',
  projects: 'shared = 1',
  tasks: SHARED_PROJECT,
  agreements: SHARED_PROJECT,
  payments: SHARED_PROJECT,
  expenses: SHARED_PROJECT,
  time_entries: SHARED_PROJECT,
  time_daily: SHARED_PROJECT,
}

/** Optional references nulled when they point at rows that do not exist here. */
const SOFT_REFS: Record<string, [string, string][]> = {
  projects: [['client_id', 'clients'], ['category_id', 'categories']],
  tasks: [['assignee_id', 'users']],
  payments: [['agreement_id', 'agreements']],
}

const PUSH_BATCH = 200
const PULL_LIMIT = 500
const TIME_WINDOW_DAYS = 60

export interface Change {
  table: SyncTable
  id: string
  data: Record<string, unknown>
  updated_at: string
  deleted_at: string | null
  author_id?: string | null
  seq?: number
}

export interface SyncRunResult {
  pushed: number
  pulled: number
  applied: number
  skipped: number
  durationMs: number
}

export interface SyncStatus {
  configured: boolean
  url: string | null
  user: { id: string; name: string; email: string } | null
  running: boolean
  lastRun: (SyncRunResult & { at: string }) | null
  lastError: string | null
}

interface Credentials {
  url: string
  token: string
  user: { id: string; name: string; email: string }
}

type Fetch = typeof fetch

/** Team sync: pushes local changes of shared data and applies the team's changes. */
export class SyncService {
  private running: Promise<SyncRunResult> | undefined
  private lastError: string | null = null

  constructor(
    private readonly db: DB,
    private readonly dataDir: string,
    private readonly time: TimeRepository,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  // ---------- configuration ----------

  status(): SyncStatus {
    const creds = this.credentials()
    const last = this.state('lastRun')
    return {
      configured: !!creds,
      url: creds?.url ?? null,
      user: creds?.user ?? null,
      running: !!this.running,
      lastRun: last ? JSON.parse(last) : null,
      lastError: this.lastError,
    }
  }

  /** Connects to a team server; the local user becomes the server user everywhere. */
  async login(url: string, token: string): Promise<SyncStatus> {
    const base = cleanUrl(url)
    if (!token.trim()) throw new UserError('A token is required (ask your admin to run php artisan mmp:user)')
    const me = (await this.request<{ user: { id: string; name: string; email: string } }>('GET', '/me', undefined, { url: base, token: token.trim() })).user
    const previous = this.credentials()
    if (previous && previous.url !== base) {
      throw new UserError(`Already connected to ${previous.url}. Run "mmp sync logout" first.`, 'conflict')
    }
    transaction(this.db, () => {
      this.db.exec('PRAGMA defer_foreign_keys = ON')
      rekeyUser(this.db, currentUserId(this.db), me.id, me.name)
      this.setState('userId', me.id)
    })
    this.writeCredentials({ url: base, token: token.trim(), user: me })
    await this.pullMembers()
    return this.status()
  }

  logout(): SyncStatus {
    const file = this.credentialsFile()
    if (existsSync(file)) rmSync(file)
    this.db.prepare("DELETE FROM sync_state WHERE key IN ('cursor', 'lastRun')").run()
    // Keep userId: the data stays attributed to this person.
    return this.status()
  }

  members(): { id: string; name: string; me: boolean }[] {
    const me = currentUserId(this.db)
    return (this.db.prepare('SELECT id, name FROM users ORDER BY name COLLATE NOCASE').all() as { id: string; name: string }[]).map(
      (u) => ({ ...u, me: u.id === me }),
    )
  }

  /** Hours per member for a project in an inclusive date range (from synced daily totals). */
  teamTime(projectId: string, from: string, to: string): { userId: string; name: string; minutes: number }[] {
    return this.db
      .prepare(
        `SELECT d.user_id AS userId, COALESCE(u.name, 'Unknown') AS name, SUM(d.minutes) AS minutes
         FROM time_daily d LEFT JOIN users u ON u.id = d.user_id
         WHERE d.project_id = ? AND d.date BETWEEN ? AND ? AND d.deleted_at IS NULL
         GROUP BY d.user_id ORDER BY minutes DESC`,
      )
      .all(projectId, from, to) as { userId: string; name: string; minutes: number }[]
  }

  // ---------- sync ----------

  /** One sync at a time per process; concurrent callers share it. */
  run(): Promise<SyncRunResult> {
    return (this.running ??= this.doRun().finally(() => {
      this.running = undefined
    }))
  }

  private async doRun(): Promise<SyncRunResult> {
    const creds = this.credentials()
    if (!creds) throw new UserError('Team sync is not configured. Run "mmp sync login <url> <token>".')
    const started = Date.now()
    try {
      await this.pullMembers()
      // Pull first: local records never synced can then merge with the team's twins
      // (same-named clients/categories, same repository) before anything is sent.
      const { pulled, applied, skipped } = await this.pull()
      this.refreshTimeDaily()
      const pushed = await this.push()
      const result = { pushed, pulled, applied, skipped, durationMs: Date.now() - started }
      this.setState('lastRun', JSON.stringify({ ...result, at: now() }))
      this.lastError = null
      return result
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
      throw error
    }
  }

  private async pullMembers(): Promise<void> {
    const members = await this.request<{ id: string; name: string }[]>('GET', '/members')
    const ts = now()
    const upsert = this.db.prepare(
      `INSERT INTO users (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`,
    )
    transaction(this.db, () => {
      for (const m of members) upsert.run(m.id, m.name, ts, ts)
    })
  }

  /** Own automatic time per shared project and day (last 60 days), as rows teammates can see. */
  private refreshTimeDaily(): void {
    const me = currentUserId(this.db)
    const today = localToday()
    const range = { from: addDays(today, -(TIME_WINDOW_DAYS - 1)), to: today }
    const shared = new Set((this.db.prepare('SELECT id FROM projects WHERE shared = 1 AND deleted_at IS NULL').all() as { id: string }[]).map((r) => r.id))
    const daily = this.time.daily(range)
    const select = this.db.prepare('SELECT minutes, cost_usd FROM time_daily WHERE id = ?')
    const upsert = this.db.prepare(
      `INSERT INTO time_daily (id, user_id, project_id, date, minutes, cost_usd, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET minutes = excluded.minutes, cost_usd = excluded.cost_usd, updated_at = excluded.updated_at`,
    )
    transaction(this.db, () => {
      for (const [projectId, d] of daily) {
        if (!shared.has(projectId)) continue
        const days = new Set([...d.minutes.keys(), ...d.costUsd.keys()])
        for (const date of days) {
          const minutes = Math.round(d.minutes.get(date) ?? 0)
          const cost = Math.round((d.costUsd.get(date) ?? 0) * 100) / 100
          const id = stableId(`${me}|${projectId}|${date}`)
          const existing = select.get(id) as { minutes: number; cost_usd: number } | undefined
          if (existing && existing.minutes === minutes && Math.abs(existing.cost_usd - cost) < 0.005) continue
          upsert.run(id, me, projectId, date, minutes, cost, now())
        }
      }
    })
  }

  private async push(): Promise<number> {
    const changes: Change[] = []
    for (const table of SYNC_TABLES) {
      const rows = this.db
        .prepare(
          `SELECT * FROM ${table}
           WHERE (sync_rev IS NULL OR sync_rev <> updated_at)
             AND NOT (sync_rev IS NULL AND deleted_at IS NOT NULL)
             AND ${SCOPE[table]}`,
        )
        .all() as Record<string, unknown>[]
      for (const row of rows) changes.push(this.toChange(table, row))
    }
    let pushed = 0
    for (let i = 0; i < changes.length; i += PUSH_BATCH) {
      const batch = changes.slice(i, i + PUSH_BATCH)
      const res = await this.request<{ accepted: string[]; ignored: string[] }>('POST', '/sync/push', { changes: batch })
      const done = new Set([...res.accepted, ...res.ignored])
      transaction(this.db, () => {
        for (const c of batch) {
          if (!done.has(c.id)) continue
          // Only mark as synced if nobody edited the row while we were pushing it.
          this.db.prepare(`UPDATE ${c.table} SET sync_rev = updated_at WHERE id = ? AND updated_at = ?`).run(c.id, c.updated_at)
        }
      })
      pushed += res.accepted.length
    }
    return pushed
  }

  private async pull(): Promise<{ pulled: number; applied: number; skipped: number }> {
    let cursor = Number(this.state('cursor') ?? 0)
    const changes: Change[] = []
    for (;;) {
      const page = await this.request<{ changes: Change[]; cursor: number; more: boolean }>(
        'GET',
        `/sync/pull?since=${cursor}&limit=${PULL_LIMIT}`,
      )
      changes.push(...page.changes)
      cursor = page.cursor
      if (!page.more) break
    }
    let applied = 0
    let skipped = 0
    // Apply everything together, parents first, so references inside one sync always resolve.
    const order = (t: string) => SYNC_TABLES.indexOf(t as SyncTable)
    changes.sort((a, b) => order(a.table) - order(b.table) || (a.seq ?? 0) - (b.seq ?? 0))
    transaction(this.db, () => {
      this.db.exec('PRAGMA defer_foreign_keys = ON')
      for (const change of changes) {
        if (!SYNC_TABLES.includes(change.table)) continue
        const result = change.table === 'projects' ? this.applyProject(change) : this.applyRow(change)
        if (result === 'applied') applied++
        else if (result === 'skipped') skipped++
      }
      this.setState('cursor', String(cursor))
    })
    return { pulled: changes.length, applied, skipped }
  }

  // ---------- mapping ----------

  private toChange(table: SyncTable, row: Record<string, unknown>): Change {
    const data: Record<string, unknown> = {}
    if (table === 'projects') {
      for (const c of PROJECT_COLUMNS) data[c] = row[c] ?? null
      data.tags = (
        this.db
          .prepare('SELECT t.name FROM project_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.project_id = ? ORDER BY t.name')
          .all(row.id as string) as { name: string }[]
      ).map((t) => t.name)
    } else {
      for (const c of COLUMNS[table]) data[c] = row[c] ?? null
    }
    return { table, id: String(row.id), data, updated_at: String(row.updated_at), deleted_at: (row.deleted_at as string | null) ?? null }
  }

  /** Last write wins; a local row that is at least as new is kept (and pushed if dirty). */
  private isNewer(table: string, id: string, incoming: string): boolean {
    const local = this.db.prepare(`SELECT updated_at FROM ${table} WHERE id = ?`).get(id) as { updated_at: string } | undefined
    return !local || local.updated_at < incoming
  }

  private applyRow(change: Change): 'applied' | 'skipped' | 'unchanged' {
    const table = change.table as Exclude<SyncTable, 'projects'>
    const data = { ...change.data }
    if ((table === 'clients' || table === 'categories') && !change.deleted_at && typeof data.name === 'string') {
      data.name = this.reconcileName(table, change.id, data.name)
    }
    if (!this.isNewer(table, change.id, change.updated_at)) return 'unchanged'
    if (typeof data.project_id === 'string' && !this.exists('projects', data.project_id)) return 'skipped'
    if (table === 'expenses' && data.project_id === null) return 'skipped' // shared costs stay personal
    this.ensureUser(data.owner_id ?? data.user_id)
    for (const [column, target] of SOFT_REFS[table] ?? []) {
      if (typeof data[column] === 'string' && !this.exists(target, data[column] as string)) data[column] = null
    }
    const columns = COLUMNS[table]
    const all = ['id', ...columns, 'updated_at', 'deleted_at', 'sync_rev']
    const values = [change.id, ...columns.map((c) => toSql(data[c])), change.updated_at, change.deleted_at, change.updated_at]
    this.db
      .prepare(
        `INSERT INTO ${table} (${all.join(', ')}) VALUES (${all.map(() => '?').join(', ')})
         ON CONFLICT(id) DO UPDATE SET ${all.slice(1).map((c) => `${c} = excluded.${c}`).join(', ')}`,
      )
      .run(...values)
    return 'applied'
  }

  /**
   * Names of clients and categories are unique. A local twin that was never synced is merged
   * into the team's record (it takes the team id); otherwise the incoming name gets a suffix.
   */
  private reconcileName(table: 'clients' | 'categories', id: string, name: string): string {
    const twin = this.db
      .prepare(`SELECT id, sync_rev FROM ${table} WHERE name = ? COLLATE NOCASE AND deleted_at IS NULL AND id <> ?`)
      .get(name, id) as { id: string; sync_rev: string | null } | undefined
    if (!twin) return name
    if (twin.sync_rev === null && !this.exists(table, id, true)) {
      const column = table === 'clients' ? 'client_id' : 'category_id'
      this.db.prepare(`UPDATE ${table} SET id = ? WHERE id = ?`).run(id, twin.id)
      this.db.prepare(`UPDATE projects SET ${column} = ? WHERE ${column} = ?`).run(id, twin.id)
      this.db.prepare(`UPDATE ${table} SET updated_at = '' WHERE id = ?`).run(id) // the team version wins
      return name
    }
    for (let n = 2; ; n++) {
      const candidate = `${name} (${n})`
      if (!this.db.prepare(`SELECT 1 FROM ${table} WHERE name = ? COLLATE NOCASE AND deleted_at IS NULL AND id <> ?`).get(candidate, id)) {
        return candidate
      }
    }
  }

  private applyProject(change: Change): 'applied' | 'unchanged' {
    const data = { ...change.data }
    for (const [column, target] of SOFT_REFS.projects) {
      if (typeof data[column] === 'string' && !this.exists(target, data[column] as string)) data[column] = null
    }
    this.ensureUser(data.owner_id)
    let exists = this.exists('projects', change.id, true)
    if (!exists && typeof data.remote_key === 'string') {
      // The same repository registered independently on this machine: adopt the team's id.
      const twin = this.db
        .prepare('SELECT id FROM projects WHERE remote_key = ? AND local = 1 AND sync_rev IS NULL AND deleted_at IS NULL AND id <> ?')
        .get(data.remote_key, change.id) as { id: string } | undefined
      if (twin) {
        rekeyProject(this.db, twin.id, change.id)
        exists = true
        // Force the incoming version over the local, never-synced one.
        this.db.prepare("UPDATE projects SET updated_at = '' WHERE id = ?").run(change.id)
      }
    }
    if (exists && !this.isNewer('projects', change.id, change.updated_at)) return 'unchanged'
    if (exists) {
      this.db
        .prepare(
          `UPDATE projects SET owner_id = ?, name = ?, description = ?, status = ?, client_id = ?, category_id = ?,
             remote_key = COALESCE(?, remote_key), shared = 1, updated_at = ?, deleted_at = ?, sync_rev = ?
           WHERE id = ?`,
        )
        .run(
          toSql(data.owner_id),
          toSql(data.name),
          toSql(data.description) ?? '',
          toSql(data.status),
          toSql(data.client_id),
          toSql(data.category_id),
          toSql(data.remote_key),
          change.updated_at,
          change.deleted_at,
          change.updated_at,
          change.id,
        )
    } else {
      this.db
        .prepare(
          `INSERT INTO projects (id, owner_id, workspace_id, source, name, description, status, path, path_key, stack, git,
             versions, client_id, category_id, remote_key, shared, local, created_at, updated_at, deleted_at, sync_rev)
           VALUES (?, ?, NULL, 'manual', ?, ?, ?, '', ?, '[]', NULL, '{}', ?, ?, ?, 1, 0, ?, ?, ?, ?)`,
        )
        .run(
          change.id,
          toSql(data.owner_id),
          toSql(data.name),
          toSql(data.description) ?? '',
          toSql(data.status) ?? 'active',
          `remote:${change.id}`,
          toSql(data.client_id),
          toSql(data.category_id),
          toSql(data.remote_key),
          toSql(data.created_at) ?? change.updated_at,
          change.updated_at,
          change.deleted_at,
          change.updated_at,
        )
    }
    this.replaceTags(change.id, Array.isArray(data.tags) ? data.tags.map(String) : [])
    return 'applied'
  }

  /** Sets tags without touching updated_at (pulled data must not look like a local edit). */
  private replaceTags(projectId: string, tags: string[]): void {
    this.db.prepare('DELETE FROM project_tags WHERE project_id = ?').run(projectId)
    for (const name of [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))]) {
      this.db.prepare('INSERT OR IGNORE INTO tags (id, name) VALUES (?, ?)').run(stableId(`tag|${name}`), name)
      this.db.prepare('INSERT OR IGNORE INTO project_tags (project_id, tag_id) SELECT ?, id FROM tags WHERE name = ?').run(projectId, name)
    }
    this.db.prepare('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM project_tags)').run()
  }

  private exists(table: string, id: string, includeDeleted = false): boolean {
    const deleted = includeDeleted || table === 'users' ? '' : ' AND deleted_at IS NULL'
    return !!this.db.prepare(`SELECT 1 FROM ${table} WHERE id = ?${deleted}`).get(id)
  }

  private ensureUser(id: unknown): void {
    if (typeof id !== 'string' || this.exists('users', id)) return
    const ts = now()
    this.db.prepare('INSERT INTO users (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, 'Former member', ts, ts)
  }

  // ---------- plumbing ----------

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown, override?: { url: string; token: string }): Promise<T> {
    const creds = override ?? this.credentials()
    if (!creds) throw new UserError('Team sync is not configured. Run "mmp sync login <url> <token>".')
    let res: Response
    try {
      res = await this.fetchImpl(`${creds.url}/api/v1${path}`, {
        method,
        headers: {
          authorization: `Bearer ${creds.token}`,
          accept: 'application/json',
          'user-agent': `mmp/${VERSION}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      })
    } catch (error) {
      throw new UserError(`Cannot reach the team server at ${creds.url}: ${error instanceof Error ? error.message : error}`)
    }
    if (res.status === 401) throw new UserError('The team server did not accept the token. Ask your admin for a new one.')
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new UserError(`Team server error ${res.status}${text ? `: ${text.slice(0, 300)}` : ''}`)
    }
    return (await res.json()) as T
  }

  private credentialsFile(): string {
    return join(this.dataDir, 'sync.json')
  }

  private credentials(): Credentials | null {
    try {
      return JSON.parse(readFileSync(this.credentialsFile(), 'utf8')) as Credentials
    } catch {
      return null
    }
  }

  private writeCredentials(creds: Credentials): void {
    mkdirSync(this.dataDir, { recursive: true })
    // The token is a secret: readable by the owner only (ignored where unsupported, e.g. Windows ACLs).
    writeFileSync(this.credentialsFile(), JSON.stringify(creds, null, 2), { mode: 0o600 })
  }

  private state(key: string): string | null {
    return (this.db.prepare('SELECT value FROM sync_state WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null
  }

  private setState(key: string, value: string): void {
    this.db.prepare('INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
  }
}

function cleanUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '')
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new UserError(`Invalid server URL "${url}"`)
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new UserError('The server URL must start with https:// or http://')
  return trimmed
}

function toSql(value: unknown): string | number | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'number' || typeof value === 'string') return value
  if (typeof value === 'boolean') return value ? 1 : 0
  return JSON.stringify(value)
}

/** Deterministic UUID-shaped id from a string (same input → same id on every machine). */
export function stableId(input: string): string {
  const h = createHash('sha1').update(input).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`
}

function currentUserId(db: DB): string {
  const me = db.prepare("SELECT value FROM sync_state WHERE key = 'userId'").get() as { value: string } | undefined
  return me?.value ?? (db.prepare('SELECT id FROM users ORDER BY created_at LIMIT 1').get() as { id: string }).id
}

const USER_REFS: [string, string][] = [
  ['clients', 'owner_id'],
  ['categories', 'owner_id'],
  ['projects', 'owner_id'],
  ['tasks', 'owner_id'],
  ['tasks', 'assignee_id'],
  ['agreements', 'owner_id'],
  ['payments', 'owner_id'],
  ['expenses', 'owner_id'],
  ['ai_plans', 'owner_id'],
  ['time_entries', 'owner_id'],
  ['time_daily', 'user_id'],
]

/** Moves everything owned by `from` to `to` (call inside a transaction with deferred FKs). */
function rekeyUser(db: DB, from: string, to: string, name: string): void {
  if (from === to) {
    db.prepare('UPDATE users SET name = ?, updated_at = ? WHERE id = ?').run(name, now(), to)
    return
  }
  const ts = now()
  db.prepare(
    `INSERT INTO users (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`,
  ).run(to, name, ts, ts)
  for (const [table, column] of USER_REFS) db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`).run(to, from)
  db.prepare('DELETE FROM users WHERE id = ?').run(from)
}

const PROJECT_REFS = ['tasks', 'project_tags', 'time_entries', 'agreements', 'payments', 'expenses', 'time_daily']

/** Gives a local project the team's id (call inside a transaction with deferred FKs). */
function rekeyProject(db: DB, from: string, to: string): void {
  db.prepare('UPDATE projects SET id = ?, path_key = path_key WHERE id = ?').run(to, from)
  for (const table of PROJECT_REFS) db.prepare(`UPDATE ${table} SET project_id = ? WHERE project_id = ?`).run(to, from)
}
