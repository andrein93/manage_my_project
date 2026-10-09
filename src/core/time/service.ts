import { isAbsolute } from 'node:path'
import { pathKey } from '../paths.js'
import { UserError } from '../types.js'
import { minuteKey } from './periods.js'
import type { DB } from '../db.js'
import type { ProjectRepository } from '../projects.js'
import type { SettingsRepository } from '../settings.js'
import { emptySyncResult, importGit, importTranscripts, type SyncResult } from './importer.js'
import { TimeRepository } from './repository.js'

export interface SyncStatus {
  running: boolean
  lastSync: (SyncResult & { finishedAt: string }) | null
  claudeProjectsDir: string
}

/** Imports activity (one sync at a time per process) and exposes time queries. */
export class TimeService {
  readonly repo: TimeRepository
  private running: Promise<SyncResult> | undefined
  private last: SyncStatus['lastSync'] = null

  constructor(
    private readonly db: DB,
    private readonly projects: ProjectRepository,
    private readonly settings: SettingsRepository,
  ) {
    this.repo = new TimeRepository(db, projects, settings)
  }

  /**
   * Records an editor heartbeat: the minute of `at` was active in `path` (a workspace folder).
   * Same minute model as Claude Code and git, so overlapping sources never double count.
   * Returns false when that minute was already recorded for the folder.
   */
  recordEditor(path: string, at: number = Date.now(), now: number = Date.now()): boolean {
    if (typeof path !== 'string' || !isAbsolute(path) || path.length > 1000) throw new UserError('path must be an absolute folder path')
    if (!Number.isFinite(at)) throw new UserError('at must be a time')
    if (at < now - 24 * 3_600_000) throw new UserError('Heartbeat too old (more than 24 hours)')
    if (at > now + 5 * 60_000) throw new UserError('Heartbeat is in the future')
    const result = this.db
      .prepare("INSERT OR IGNORE INTO activity (cwd_key, cwd, minute, source, session_id) VALUES (?, ?, ?, 'editor', NULL)")
      .run(pathKey(path), path, minuteKey(at))
    return Number(result.changes) > 0
  }

  /** Concurrent callers share the running sync. */
  sync(): Promise<SyncResult> {
    return (this.running ??= this.run().finally(() => {
      this.running = undefined
    }))
  }

  /**
   * Syncs unless one finished within `maxAgeMs`; waits at most `timeoutMs` (the sync keeps
   * running in the background and later calls see its data).
   */
  async freshen(maxAgeMs = 60_000, timeoutMs = 8_000): Promise<void> {
    const last = this.last ? Date.parse(this.last.finishedAt) : 0
    if (!this.running && Date.now() - last < maxAgeMs) return
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      this.sync().catch(() => undefined),
      new Promise((resolve) => (timer = setTimeout(resolve, timeoutMs))),
    ])
    clearTimeout(timer)
  }

  status(): SyncStatus {
    return { running: !!this.running, lastSync: this.last, claudeProjectsDir: this.settings.get().claudeProjectsDir }
  }

  private async run(): Promise<SyncResult> {
    const started = Date.now()
    const result = emptySyncResult()
    await importTranscripts(this.db, this.settings.get().claudeProjectsDir, result)
    await importGit(
      this.db,
      this.projects.list({ all: true }).filter((p) => !p.missingSince),
      result,
    )
    result.durationMs = Date.now() - started
    this.last = { ...result, finishedAt: new Date().toISOString() }
    return result
  }
}
