import { statSync } from 'node:fs'
import type { DB } from './db.js'
import { newId, now } from './ids.js'
import { normalizePath, pathKey } from './paths.js'
import { UserError, type Workspace } from './types.js'

interface WorkspaceRow {
  id: string
  path: string
  created_at: string
  updated_at: string
}

export class WorkspaceRepository {
  constructor(private readonly db: DB) {}

  list(): Workspace[] {
    return (
      this.db
        .prepare('SELECT * FROM workspaces WHERE deleted_at IS NULL ORDER BY path COLLATE NOCASE')
        .all() as unknown as WorkspaceRow[]
    ).map(toWorkspace)
  }

  /** Adds a folder to scan. Re-adding a removed workspace restores it. */
  add(path: string): Workspace {
    const normalized = normalizePath(path)
    assertDirectory(normalized)
    const key = pathKey(normalized)
    const existing = this.db.prepare('SELECT * FROM workspaces WHERE path_key = ?').get(key) as WorkspaceRow | undefined
    const ts = now()
    if (existing) {
      this.db.prepare('UPDATE workspaces SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(ts, existing.id)
      return toWorkspace({ ...existing, updated_at: ts })
    }
    const id = newId()
    this.db
      .prepare('INSERT INTO workspaces (id, path, path_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, normalized, key, ts, ts)
    return { id, path: normalized, createdAt: ts, updatedAt: ts }
  }

  /**
   * Removes a workspace by id or path. Its scanned projects are soft-deleted
   * (they come back if the workspace is added again).
   */
  remove(ref: string): Workspace {
    const row = (this.db.prepare('SELECT * FROM workspaces WHERE id = ? AND deleted_at IS NULL').get(ref) ??
      this.db
        .prepare('SELECT * FROM workspaces WHERE path_key = ? AND deleted_at IS NULL')
        .get(pathKey(ref))) as WorkspaceRow | undefined
    if (!row) throw new UserError(`Workspace not found: ${ref}`, 'not_found')
    const ts = now()
    this.db.prepare('UPDATE workspaces SET deleted_at = ?, updated_at = ? WHERE id = ?').run(ts, ts, row.id)
    this.db
      .prepare(
        "UPDATE projects SET deleted_at = ?, updated_at = ? WHERE workspace_id = ? AND source = 'scan' AND deleted_at IS NULL",
      )
      .run(ts, ts, row.id)
    return toWorkspace(row)
  }
}

export function assertDirectory(path: string): void {
  let isDir = false
  try {
    isDir = statSync(path).isDirectory()
  } catch {
    // handled below
  }
  if (!isDir) throw new UserError(`Not a directory: ${path}`)
}

function toWorkspace(row: WorkspaceRow): Workspace {
  return { id: row.id, path: row.path, createdAt: row.created_at, updatedAt: row.updated_at }
}
