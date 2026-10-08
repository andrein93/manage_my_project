import { dirname, join } from 'node:path'
import { loadConfig, type Config } from '../config.js'
import { CategoryRepository } from './categories.js'
import { ClientRepository } from './clients.js'
import { openDatabase, type DB } from './db.js'
import { normalizePath } from './paths.js'
import { ProjectRepository } from './projects.js'
import { detect, scan } from './scanner.js'
import { SettingsRepository } from './settings.js'
import { TaskRepository } from './tasks.js'
import { FinanceService } from './finance/report.js'
import { SyncService } from './sync/engine.js'
import { TimeService } from './time/service.js'
import { UserError, type Project, type ScanResult } from './types.js'
import { assertDirectory, WorkspaceRepository } from './workspaces.js'

export interface App {
  config: Config
  db: DB
  projects: ProjectRepository
  workspaces: WorkspaceRepository
  settings: SettingsRepository
  clients: ClientRepository
  categories: CategoryRepository
  tasks: TaskRepository
  time: TimeService
  finance: FinanceService
  sync: SyncService
  scan(): Promise<ScanResult>
  /** Registers a single folder as a manual project (or returns the existing one). */
  addProject(path: string): Promise<Project>
  close(): void
}

export interface CreateAppOptions {
  config?: Config
  /** Override the database file (e.g. ':memory:' in tests). */
  dbFile?: string
  /** Override "today" (YYYY-MM-DD) for due-date logic, e.g. in tests. */
  today?: () => string
  /** HTTP client for team sync (tests pass a fake server). */
  fetch?: typeof fetch
}

/** Wires configuration, database and services. Every entry point (CLI, server, MCP) uses this. */
export function createApp(options: CreateAppOptions = {}): App {
  const config = options.config ?? loadConfig()
  const db = openDatabase(options.dbFile ?? join(config.dataDir, 'mmp.db'))
  const projects = new ProjectRepository(db)
  const workspaces = new WorkspaceRepository(db)
  const settings = new SettingsRepository(db)
  const clients = new ClientRepository(db)
  const categories = new CategoryRepository(db)
  const tasks = new TaskRepository(db, options.today)
  const time = new TimeService(db, projects, settings)
  const finance = new FinanceService(db, projects, settings, time.repo, options.today)
  const sync = new SyncService(db, config.dataDir, time.repo, options.fetch)

  // First run only (counting removed rows too, so a deliberately removed workspace stays removed):
  // the folder that contains mmp becomes the default workspace.
  const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
  if (count('workspaces') === 0 && count('projects') === 0) {
    try {
      workspaces.add(dirname(normalizePath(config.installDir)))
    } catch {
      // Parent not accessible: the user can add workspaces manually.
    }
  }

  let running: Promise<ScanResult> | undefined
  let queued: Promise<ScanResult> | undefined
  const start = () =>
    (running = scan({ projects, workspaces, settings, installDir: config.installDir }).finally(() => {
      running = undefined
    }))

  return {
    config,
    db,
    projects,
    workspaces,
    settings,
    clients,
    categories,
    tasks,
    time,
    finance,
    sync,
    scan() {
      // One scan at a time per process. Callers arriving mid-scan share a single follow-up
      // scan, so they always see changes made before their call (e.g. a new workspace).
      if (!running) return start()
      return (queued ??= running.catch(() => {}).then(() => {
        queued = undefined
        return start()
      }))
    },
    async addProject(path) {
      const normalized = normalizePath(path)
      assertDirectory(normalized)
      const existing = projects.findByPath(normalized)
      const fields = await detect(normalized)
      if (existing) {
        if (!existing.deleted) throw new UserError(`Already registered as "${existing.name}"`, 'conflict')
        projects.restore(existing.id, fields, { source: 'manual', workspaceId: null })
        return projects.get(existing.id)!
      }
      const project = projects.insert({ ...fields, path: normalized, source: 'manual', workspaceId: null })
      if (!project) throw new UserError('Already registered', 'conflict')
      return project
    },
    close: () => db.close(),
  }
}
