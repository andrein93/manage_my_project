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
