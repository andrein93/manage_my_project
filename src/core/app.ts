import { dirname, join } from 'node:path'
import { loadConfig, type Config } from '../config.js'
import { openDatabase, type DB } from './db.js'
import { normalizePath } from './paths.js'
import { ProjectRepository } from './projects.js'
import { detect, scan } from './scanner.js'
import { SettingsRepository } from './settings.js'
import { UserError, type Project, type ScanResult } from './types.js'
import { assertDirectory, WorkspaceRepository } from './workspaces.js'

export interface App {
  config: Config
  db: DB
  projects: ProjectRepository
  workspaces: WorkspaceRepository
  settings: SettingsRepository
  scan(): Promise<ScanResult>
  /** Registers a single folder as a manual project (or returns the existing one). */
  addProject(path: string): Promise<Project>
  close(): void
}

export interface CreateAppOptions {
  config?: Config
  /** Override the database file (e.g. ':memory:' in tests). */
  dbFile?: string
}

/** Wires configuration, database and services. Every entry point (CLI, server, MCP) uses this. */
export function createApp(options: CreateAppOptions = {}): App {
  const config = options.config ?? loadConfig()
  const db = openDatabase(options.dbFile ?? join(config.dataDir, 'mmp.db'))
  const projects = new ProjectRepository(db)
  const workspaces = new WorkspaceRepository(db)
  const settings = new SettingsRepository(db)

  // First run: the folder that contains mmp is the default workspace.
  if (workspaces.list().length === 0 && projects.allForScan().length === 0) {
    try {
      workspaces.add(dirname(normalizePath(config.installDir)))
    } catch {
      // Parent not accessible: the user can add workspaces manually.
    }
  }

  return {
    config,
    db,
    projects,
    workspaces,
    settings,
    scan: () => scan({ projects, workspaces, settings, installDir: config.installDir }),
    async addProject(path) {
      const normalized = normalizePath(path)
      assertDirectory(normalized)
      const existing = projects.findByPath(normalized)
      const fields = await detect(normalized)
      if (existing) {
        if (!existing.deleted) throw new UserError(`Already registered as "${existing.name}"`, 'conflict')
        projects.updateDetected(existing.id, fields)
        return projects.get(existing.id)!
      }
      return projects.insert({ ...fields, path: normalized, source: 'manual', workspaceId: null })
    },
    close: () => db.close(),
  }
}
