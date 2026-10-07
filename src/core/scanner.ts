import { existsSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { lastActivity } from './detect/activity.js'
import { readGit } from './detect/git.js'
import { detectStack } from './detect/stack.js'
import { pathKey } from './paths.js'
import type { DetectedFields, ProjectRepository } from './projects.js'
import type { SettingsRepository } from './settings.js'
import type { ScanResult } from './types.js'
import type { WorkspaceRepository } from './workspaces.js'

const CONCURRENCY = 8

export interface ScannerDeps {
  projects: ProjectRepository
  workspaces: WorkspaceRepository
  settings: SettingsRepository
  /** mmp's own folder, never registered as a project. */
  installDir: string
}

interface Candidate {
  path: string
  key: string
  workspaceId: string
}

export async function detect(dir: string): Promise<DetectedFields> {
  const [stack, git] = await Promise.all([detectStack(dir), readGit(dir)])
  return { stack, git, lastActivityAt: await lastActivity(dir, git?.lastCommitAt ?? null) }
}

/** Discovers project folders in every workspace and reconciles them with the registry. */
export async function scan(deps: ScannerDeps): Promise<ScanResult> {
  const started = Date.now()
  const result: ScanResult = { added: 0, updated: 0, missing: 0, restored: 0, total: 0, durationMs: 0, errors: [] }
  const ignore = new Set(deps.settings.get().ignoreNames.map((n) => n.toLowerCase()))
  const installKey = pathKey(deps.installDir)

  const candidates = new Map<string, Candidate>()
  for (const workspace of deps.workspaces.list()) {
    try {
      for (const path of await childDirectories(workspace.path)) {
        const name = path.slice(workspace.path.length + 1)
        const key = pathKey(path)
        if (name.startsWith('.') || ignore.has(name.toLowerCase()) || key === installKey) continue
        if (!candidates.has(key)) candidates.set(key, { path, key, workspaceId: workspace.id })
      }
    } catch (error) {
      result.errors.push({ path: workspace.path, message: errorMessage(error) })
    }
  }

  type Job = () => Promise<void>
  const jobs: Job[] = []

  // Refresh every known project: still present → update, gone → mark missing.
  for (const known of deps.projects.allForScan()) {
    candidates.delete(known.pathKey)
    if (!existsSync(known.path)) {
      deps.projects.markMissing(known.id)
      result.missing++
      continue
    }
    jobs.push(async () => {
      const wasMissing = deps.projects.get(known.id)?.missingSince != null
      deps.projects.updateDetected(known.id, await detect(known.path))
      if (wasMissing) result.restored++
      else result.updated++
    })
  }

  // New folders (or previously soft-deleted ones that reappeared in a workspace).
  for (const candidate of candidates.values()) {
    jobs.push(async () => {
      const fields = await detect(candidate.path)
      const previous = deps.projects.findByPath(candidate.path)
      if (previous) {
        deps.projects.updateDetected(previous.id, fields)
        result.restored++
      } else {
        deps.projects.insert({ ...fields, path: candidate.path, source: 'scan', workspaceId: candidate.workspaceId })
        result.added++
      }
    })
  }

  await runLimited(jobs, CONCURRENCY, (error, index) => {
    result.errors.push({ path: `job #${index}`, message: errorMessage(error) })
  })

  result.total = deps.projects.list({ all: true }).length
  result.durationMs = Date.now() - started
  return result
}

async function childDirectories(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const dirs: string[] = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) dirs.push(path)
    else if (entry.isSymbolicLink()) {
      try {
        if ((await stat(path)).isDirectory()) dirs.push(path)
      } catch {
        // dangling link
      }
    }
  }
  return dirs
}

async function runLimited(jobs: (() => Promise<void>)[], limit: number, onError: (e: unknown, i: number) => void) {
  let next = 0
  const worker = async () => {
    while (next < jobs.length) {
      const index = next++
      try {
        await jobs[index]()
      } catch (error) {
        onError(error, index)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
