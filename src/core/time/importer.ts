import { execFile } from 'node:child_process'
import { createReadStream, existsSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { transaction, type DB } from '../db.js'
import { now } from '../ids.js'
import { pathKey } from '../paths.js'
import { minuteKey } from './periods.js'
import type { SyncResult } from './types.js'

const exec = promisify(execFile)
const NEWLINE = 0x0a
/** Cheap pre-filter before JSON.parse: only these line types matter. */
const INTERESTING = /"type":"(user|assistant|cost-state)"/

export type { SyncResult } from './types.js'

export function emptySyncResult(): SyncResult {
  return {
    claudeDirFound: false,
    files: 0,
    filesRead: 0,
    linesRead: 0,
    skippedLines: 0,
    signals: 0,
    sessions: 0,
    commits: 0,
    errors: [],
    durationMs: 0,
  }
}

interface SessionUpdate {
  cwd: string
  cost: number | null
  modelUsage: unknown
  first: string | null
  last: string | null
}

/** Imports new lines of every Claude Code transcript under `dir`. */
export async function importTranscripts(db: DB, dir: string, result: SyncResult): Promise<void> {
  if (!existsSync(dir)) return
  result.claudeDirFound = true
  let files: string[]
  try {
    files = (await readdir(dir, { recursive: true })).filter((f) => f.endsWith('.jsonl')).map((f) => join(dir, f))
  } catch (error) {
    result.errors.push({ source: dir, message: error instanceof Error ? error.message : String(error) })
    return
  }
  result.files += files.length
  for (const file of files) {
    try {
      await importFile(db, file, result)
    } catch (error) {
      result.errors.push({ source: file, message: error instanceof Error ? error.message : String(error) })
    }
  }
}

async function importFile(db: DB, file: string, result: SyncResult): Promise<void> {
  const key = `claude:${pathKey(file)}`
  const { size } = await stat(file)
  const state = db.prepare('SELECT offset FROM import_state WHERE source_key = ?').get(key) as { offset: number } | undefined
  let offset = state?.offset ?? 0
  if (size === offset) return
  if (size < offset) offset = 0 // truncated or rewritten: start over (writes are idempotent)
  result.filesRead++

  const signals = new Map<string, { cwd: string; minute: string; sessionId: string | null }>()
  const sessionMinutes = new Set<string>()
  const sessions = new Map<string, SessionUpdate>()
  let consumed = offset
  let pending: Buffer[] = []

  const handleLine = (buffer: Buffer) => {
    result.linesRead++
    const line = buffer.toString('utf8')
    if (!INTERESTING.test(line)) return
    let entry: Record<string, unknown>
    try {
      entry = JSON.parse(line)
    } catch {
      result.skippedLines++
      return
    }
    const sessionId = typeof entry.sessionId === 'string' ? entry.sessionId : null
    if (entry.type === 'cost-state') {
      if (!sessionId || typeof entry.totalCostUSD !== 'number') return
      const s = sessionFor(sessions, sessionId)
      if (s.cost === null || entry.totalCostUSD > s.cost) {
        s.cost = entry.totalCostUSD
        s.modelUsage = entry.modelUsage ?? {}
      }
      return
    }
    if (entry.type !== 'user' && entry.type !== 'assistant') return
    const cwd = typeof entry.cwd === 'string' ? entry.cwd : null
    const ms = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : NaN
    if (!cwd || Number.isNaN(ms)) return
    const minute = minuteKey(ms)
    const cwdKey = pathKey(cwd)
    signals.set(`${cwdKey}|${minute}`, { cwd, minute, sessionId })
    if (sessionId) {
      sessionMinutes.add(`${sessionId}|${minute}`)
      const s = sessionFor(sessions, sessionId)
      if (!s.cwd) s.cwd = cwd
      const iso = new Date(ms).toISOString()
      if (!s.first || iso < s.first) s.first = iso
      if (!s.last || iso > s.last) s.last = iso
    }
  }

  for await (const chunk of createReadStream(file, { start: offset })) {
    let buffer = chunk as Buffer
    let index: number
    while ((index = buffer.indexOf(NEWLINE)) !== -1) {
      const piece = buffer.subarray(0, index)
      const line = pending.length ? Buffer.concat([...pending, piece]) : piece
      pending = []
      consumed += line.length + 1
      if (line.length) handleLine(line)
      buffer = buffer.subarray(index + 1)
    }
    if (buffer.length) pending.push(Buffer.from(buffer))
  }
  // A trailing line without '\n' is still being written: leave it for the next sync.

  transaction(db, () => {
    const insertSignal = db.prepare(
      "INSERT OR IGNORE INTO activity (cwd_key, cwd, minute, source, session_id) VALUES (?, ?, ?, 'claude', ?)",
    )
    for (const s of signals.values()) {
      result.signals += Number(insertSignal.run(pathKey(s.cwd), s.cwd, s.minute, s.sessionId).changes)
    }
    const insertSessionMinute = db.prepare('INSERT OR IGNORE INTO session_minutes (session_id, minute) VALUES (?, ?)')
    for (const key of sessionMinutes) {
      const [sessionId, minute] = key.split('|')
      insertSessionMinute.run(sessionId, minute)
    }
    for (const [sessionId, s] of sessions) upsertSession(db, sessionId, s)
    result.sessions += sessions.size
    db.prepare(
      `INSERT INTO import_state (source_key, offset, size, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(source_key) DO UPDATE SET offset = excluded.offset, size = excluded.size, updated_at = excluded.updated_at`,
    ).run(key, consumed, size, now())
  })
}

function sessionFor(sessions: Map<string, SessionUpdate>, id: string): SessionUpdate {
  let s = sessions.get(id)
  if (!s) sessions.set(id, (s = { cwd: '', cost: null, modelUsage: null, first: null, last: null }))
  return s
}

function upsertSession(db: DB, sessionId: string, s: SessionUpdate): void {
  const existing = db.prepare('SELECT * FROM ai_sessions WHERE session_id = ?').get(sessionId) as
    | { cwd: string; cost_usd: number; model_usage: string; first_at: string | null; last_at: string | null }
    | undefined
  const cwd = existing?.cwd || s.cwd // may stay '' until a message with a cwd arrives
  const higherCost = s.cost !== null && s.cost > (existing?.cost_usd ?? -1)
  const cost = higherCost ? s.cost! : (existing?.cost_usd ?? 0)
  const usage = higherCost ? JSON.stringify(s.modelUsage ?? {}) : (existing?.model_usage ?? '{}')
  const first = [existing?.first_at, s.first].filter(Boolean).sort()[0] ?? null
  const last = [existing?.last_at, s.last].filter(Boolean).sort().at(-1) ?? null
  db.prepare(
    `INSERT INTO ai_sessions (session_id, cwd_key, cwd, cost_usd, model_usage, first_at, last_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET cwd_key = excluded.cwd_key, cwd = excluded.cwd,
       cost_usd = excluded.cost_usd, model_usage = excluded.model_usage,
       first_at = excluded.first_at, last_at = excluded.last_at, updated_at = excluded.updated_at`,
  ).run(sessionId, cwd ? pathKey(cwd) : '', cwd, cost, usage, first, last, now())
}

/** Imports commits authored by the local git user in each repository since the last import. */
export async function importGit(
  db: DB,
  projects: { id: string; path: string }[],
  result: SyncResult,
  concurrency = 8,
): Promise<void> {
  const repos = projects.filter((p) => existsSync(join(p.path, '.git')))
  let next = 0
  const worker = async () => {
    while (next < repos.length) {
      const repo = repos[next++]
      try {
        await importRepo(db, repo, result)
      } catch (error) {
        result.errors.push({ source: repo.path, message: error instanceof Error ? error.message : String(error) })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, repos.length) }, worker))
}

async function importRepo(db: DB, repo: { id: string; path: string }, result: SyncResult): Promise<void> {
  // `git config` exits 1 when the key is unset: that just means "no git signals for this repo".
  const email = await git(repo.path, ['config', 'user.email']).catch(() => '')
  if (!email) return
  // Full history every time: commits can arrive out of date order (pulls from other machines),
  // and INSERT OR IGNORE keeps it idempotent. "<email>" matches the exact address only.
  const out = await git(repo.path, ['log', '--all', '-F', `--author=<${email}>`, '--format=%aI'])
  const dates = out
    .split('\n')
    .map((l) => Date.parse(l.trim()))
    .filter((ms) => !Number.isNaN(ms))
  transaction(db, () => {
    const insert = db.prepare(
      "INSERT OR IGNORE INTO activity (cwd_key, cwd, minute, source, session_id) VALUES (?, ?, ?, 'git', NULL)",
    )
    for (const ms of dates) result.commits += Number(insert.run(pathKey(repo.path), repo.path, minuteKey(ms)).changes)
  })
}

/** Runs a read-only git command; rejects with a readable message on failure or timeout. */
async function git(dir: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await exec('git', ['-c', 'safe.directory=*', '-C', dir, ...args], {
      timeout: 30_000,
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    })
    return stdout.trim()
  } catch (error) {
    const e = error as { killed?: boolean; stderr?: string; message?: string }
    throw new Error(e.killed ? `git ${args[0]} timed out` : (e.stderr?.trim() || e.message || 'git failed'))
  }
}
