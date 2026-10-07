export const PROJECT_STATUSES = ['active', 'paused', 'archived', 'ignored'] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

/** Statuses hidden from default listings. */
export const HIDDEN_STATUSES: ProjectStatus[] = ['archived', 'ignored']

export interface GitInfo {
  branch: string | null
  lastCommitAt: string | null
  remote: string | null
  dirty: boolean
}

export interface Project {
  id: string
  ownerId: string
  workspaceId: string | null
  source: 'scan' | 'manual'
  name: string
  description: string
  status: ProjectStatus
  path: string
  stack: string[]
  git: GitInfo | null
  tags: string[]
  lastActivityAt: string | null
  missingSince: string | null
  createdAt: string
  updatedAt: string
}

export interface Workspace {
  id: string
  path: string
  createdAt: string
  updatedAt: string
}

export interface ProjectFilters {
  status?: ProjectStatus[]
  stack?: string
  tag?: string
  /** Only projects with no activity in the last N days. */
  inactiveDays?: number
  query?: string
  /** Include archived and ignored projects when no explicit status is given. */
  all?: boolean
}

export interface ProjectPatch {
  name?: string
  description?: string
  status?: ProjectStatus
}

export interface ScanResult {
  added: number
  updated: number
  missing: number
  restored: number
  total: number
  durationMs: number
  errors: { path: string; message: string }[]
}

/** Error whose message is safe to show to the user (bad input, unknown ref…). */
export class UserError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid' | 'not_found' | 'conflict' = 'invalid',
  ) {
    super(message)
    this.name = 'UserError'
  }
}
