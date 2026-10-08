import { basename, isAbsolute } from 'node:path'
import { localUserId, transaction, type DB } from './db.js'
import { newId, now } from './ids.js'
import { majorOf } from './detect/versions.js'
import { healthFlags } from './health.js'
import { isWithin, normalizePath, pathKey } from './paths.js'
import {
  HIDDEN_STATUSES,
  PROJECT_STATUSES,
  UserError,
  type GitInfo,
  type Project,
  type ProjectFilters,
  type ProjectPatch,
  type ProjectStatus,
} from './types.js'

interface ProjectRow {
  id: string
  owner_id: string
  workspace_id: string | null
  source: 'scan' | 'manual'
  name: string
  description: string
  status: ProjectStatus
  path: string
  path_key: string
  stack: string
  git: string | null
  last_activity_at: string | null
  missing_since: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
  tags: string | null
  client_id: string | null
  client_name: string | null
  category_id: string | null
  category_name: string | null
  category_color: string | null
  versions: string
}

export interface DetectedFields {
  stack: string[]
  git: GitInfo | null
  versions?: Record<string, string>
  lastActivityAt: string | null
}

export interface NewProject extends DetectedFields {
  path: string
  source: 'scan' | 'manual'
  workspaceId: string | null
  name?: string
}

const SELECT = `
  SELECT p.*, (
    SELECT json_group_array(t.name) FROM (
      SELECT t.name FROM project_tags pt JOIN tags t ON t.id = pt.tag_id
      WHERE pt.project_id = p.id ORDER BY t.name
    ) t
  ) AS tags,
  c.name AS client_name, g.name AS category_name, g.color AS category_color
  FROM projects p
  LEFT JOIN clients c ON c.id = p.client_id AND c.deleted_at IS NULL
  LEFT JOIN categories g ON g.id = p.category_id AND g.deleted_at IS NULL`

const DAY_MS = 86_400_000

export class ProjectRepository {
  constructor(private readonly db: DB) {}

  list(filters: ProjectFilters = {}): Project[] {
    const statuses = filters.status?.length
      ? filters.status
      : filters.all
        ? [...PROJECT_STATUSES]
        : PROJECT_STATUSES.filter((s) => !HIDDEN_STATUSES.includes(s))
    const rows = this.db
      .prepare(`${SELECT} WHERE p.deleted_at IS NULL ORDER BY p.name COLLATE NOCASE`)
      .all() as unknown as ProjectRow[]

    const query = filters.query?.trim().toLowerCase()
    const cutoff = filters.inactiveDays != null ? Date.now() - filters.inactiveDays * DAY_MS : null

    return rows.map(toProject).filter((p) => {
      if (!statuses.includes(p.status)) return false
      if (filters.stack && !p.stack.includes(filters.stack.toLowerCase())) return false
      if (filters.tag && !p.tags.some((t) => t.toLowerCase() === filters.tag!.toLowerCase())) return false
      if (cutoff != null && p.lastActivityAt && Date.parse(p.lastActivityAt) > cutoff) return false
      if (filters.client && (p.client?.id ?? 'none') !== filters.client) return false
      if (filters.category && (p.category?.id ?? 'none') !== filters.category) return false
      if (filters.attention && p.health.length === 0) return false
      if (filters.version) {
        const [framework, major] = filters.version.toLowerCase().split('@')
        const version = p.versions[framework]
        if (!version || (major && majorOf(version) !== major)) return false
      }
      const haystack = [p.name, p.description, p.path, ...p.tags, p.client?.name ?? '', p.category?.name ?? '']
      if (query && !haystack.some((v) => v.toLowerCase().includes(query))) {
        return false
      }
      return true
    })
  }

  get(id: string): Project | null {
    const row = this.db.prepare(`${SELECT} WHERE p.id = ? AND p.deleted_at IS NULL`).get(id) as ProjectRow | undefined
    return row ? toProject(row) : null
  }

  /** Includes soft-deleted rows so a rediscovered folder can be restored. */
  findByPath(path: string): (Project & { deleted: boolean }) | null {
    const row = this.db.prepare(`${SELECT} WHERE p.path_key = ?`).get(pathKey(path)) as ProjectRow | undefined
    return row ? { ...toProject(row), deleted: row.deleted_at !== null } : null
  }

  /** Resolves an id, exact path or case-insensitive name to a single project. */
  resolve(ref: string): Project {
    const trimmed = ref.trim()
    const byId = this.get(trimmed)
    if (byId) return byId
    // Only treat explicit paths as paths, so a bare name never resolves against the cwd.
    if (isAbsolute(trimmed) || /[\\/]/.test(trimmed)) {
      const byPath = this.findByPath(trimmed)
      if (byPath && !byPath.deleted) return this.get(byPath.id)!
    }
    const byName = this.list({ all: true }).filter((p) => p.name.toLowerCase() === trimmed.toLowerCase())
    if (byName.length === 1) return byName[0]
    if (byName.length > 1) {
      throw new UserError(
        `"${ref}" matches ${byName.length} projects; use an id or path:\n${byName.map((p) => `  ${p.id}  ${p.path}`).join('\n')}`,
        'conflict',
      )
    }
    throw new UserError(`Project not found: ${ref}`, 'not_found')
  }

  /** The project whose folder contains `path` (deepest match), or null. */
  findContaining(path: string): Project | null {
    const key = pathKey(path)
    const rows = this.db
      .prepare('SELECT id, path_key FROM projects WHERE deleted_at IS NULL')
      .all() as { id: string; path_key: string }[]
    const match = rows
      .filter((r) => isWithin(key, r.path_key))
      .sort((a, b) => b.path_key.length - a.path_key.length)[0]
    return match ? this.get(match.id) : null
  }

  /** Inserts a project; if another process registered the same path meanwhile, returns null. */
  insert(input: NewProject): Project | null {
    const id = newId()
    const ts = now()
    const path = normalizePath(input.path)
    const { changes } = this.db
      .prepare(
        `INSERT INTO projects (id, owner_id, workspace_id, source, name, path, path_key, stack, git, versions,
          last_activity_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(path_key) DO NOTHING`,
      )
      .run(
        id,
        localUserId(this.db),
        input.workspaceId,
        input.source,
        input.name ?? basename(path),
        path,
        pathKey(path),
        JSON.stringify(input.stack),
        input.git ? JSON.stringify(input.git) : null,
        JSON.stringify(input.versions ?? {}),
        input.lastActivityAt,
        ts,
        ts,
      )
    return changes ? this.get(id)! : null
  }

  /**
   * Updates only scanner-owned fields and clears the missing marker. Never touches
   * soft-deleted rows, so a scan racing a workspace removal cannot resurrect them.
   */
  updateDetected(id: string, fields: DetectedFields): void {
    this.db
      .prepare(
        `UPDATE projects SET stack = ?, git = ?, versions = ?, last_activity_at = ?, missing_since = NULL, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
      )
      .run(
        JSON.stringify(fields.stack),
        fields.git ? JSON.stringify(fields.git) : null,
        JSON.stringify(fields.versions ?? {}),
        fields.lastActivityAt,
        now(),
        id,
      )
  }

  /** Brings back a soft-deleted project that was rediscovered or re-added, re-homing it. */
  restore(id: string, fields: DetectedFields, origin: { source: 'scan' | 'manual'; workspaceId: string | null }): void {
    this.db
      .prepare('UPDATE projects SET deleted_at = NULL, source = ?, workspace_id = ? WHERE id = ?')
      .run(origin.source, origin.workspaceId, id)
    this.updateDetected(id, fields)
  }

  markMissing(id: string): void {
    const ts = now()
    this.db
      .prepare('UPDATE projects SET missing_since = ?, updated_at = ? WHERE id = ? AND missing_since IS NULL')
      .run(ts, ts, id)
  }

  update(id: string, patch: ProjectPatch): Project {
    return transaction(this.db, () => this.updateUnlocked(id, patch))
  }

  private updateUnlocked(id: string, patch: ProjectPatch): Project {
    const project = this.get(id)
    if (!project) throw new UserError(`Project not found: ${id}`, 'not_found')
    const name = patch.name?.trim() ?? project.name
    if (!name) throw new UserError('Name cannot be empty')
    const status = patch.status ?? project.status
    if (!PROJECT_STATUSES.includes(status)) {
      throw new UserError(`Invalid status "${status}". Use one of: ${PROJECT_STATUSES.join(', ')}`)
    }
    const clientId = patch.clientId === undefined ? (project.client?.id ?? null) : patch.clientId
    const categoryId = patch.categoryId === undefined ? (project.category?.id ?? null) : patch.categoryId
    if (clientId && !this.exists('clients', clientId)) throw new UserError(`Client not found: ${clientId}`, 'not_found')
    if (categoryId && !this.exists('categories', categoryId)) {
      throw new UserError(`Category not found: ${categoryId}`, 'not_found')
    }
    this.db
      .prepare(
        'UPDATE projects SET name = ?, description = ?, status = ?, client_id = ?, category_id = ?, updated_at = ? WHERE id = ?',
      )
      .run(name, patch.description ?? project.description, status, clientId, categoryId, now(), id)
    return this.get(id)!
  }

  private exists(table: 'clients' | 'categories', id: string): boolean {
    return !!this.db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND deleted_at IS NULL`).get(id)
  }

  /** Adds and removes tags; tag names are trimmed and lower-cased. */
  editTags(id: string, add: string[] = [], remove: string[] = []): Project {
    if (!this.get(id)) throw new UserError(`Project not found: ${id}`, 'not_found')
    transaction(this.db, () => {
      for (const name of normalizeTags(add)) {
        this.db.prepare('INSERT OR IGNORE INTO tags (id, name) VALUES (?, ?)').run(newId(), name)
        this.db
          .prepare('INSERT OR IGNORE INTO project_tags (project_id, tag_id) SELECT ?, id FROM tags WHERE name = ?')
          .run(id, name)
      }
      for (const name of normalizeTags(remove)) {
        this.db
          .prepare('DELETE FROM project_tags WHERE project_id = ? AND tag_id = (SELECT id FROM tags WHERE name = ?)')
          .run(id, name)
      }
      this.db.prepare('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM project_tags)').run()
      this.db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now(), id)
    })
    return this.get(id)!
  }

  /** Replaces the full tag set. */
  setTags(id: string, tags: string[]): Project {
    const project = this.get(id)
    if (!project) throw new UserError(`Project not found: ${id}`, 'not_found')
    const next = normalizeTags(tags)
    return this.editTags(id, next, project.tags.filter((t) => !next.includes(t)))
  }

  allTags(): string[] {
    return (this.db.prepare('SELECT name FROM tags ORDER BY name').all() as { name: string }[]).map((r) => r.name)
  }

  /** All active (non-deleted) project rows, for the scanner. */
  allForScan(): { id: string; path: string; pathKey: string; source: 'scan' | 'manual' }[] {
    return (
      this.db.prepare('SELECT id, path, path_key, source FROM projects WHERE deleted_at IS NULL').all() as {
        id: string
        path: string
        path_key: string
        source: 'scan' | 'manual'
      }[]
    ).map((r) => ({ id: r.id, path: r.path, pathKey: r.path_key, source: r.source }))
  }
}

function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))]
}

function toProject(row: ProjectRow): Project {
  const git: GitInfo | null = row.git ? JSON.parse(row.git) : null
  return {
    id: row.id,
    ownerId: row.owner_id,
    workspaceId: row.workspace_id,
    source: row.source,
    name: row.name,
    description: row.description,
    status: row.status,
    path: row.path,
    stack: JSON.parse(row.stack),
    git,
    tags: row.tags ? JSON.parse(row.tags) : [],
    versions: row.versions ? JSON.parse(row.versions) : {},
    health: healthFlags({ status: row.status, git, missingSince: row.missing_since, lastActivityAt: row.last_activity_at }),
    client: row.client_id && row.client_name ? { id: row.client_id, name: row.client_name } : null,
    category:
      row.category_id && row.category_name
        ? { id: row.category_id, name: row.category_name, color: row.category_color! }
        : null,
    lastActivityAt: row.last_activity_at,
    missingSince: row.missing_since,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
