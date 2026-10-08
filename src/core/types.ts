export const PROJECT_STATUSES = ['active', 'paused', 'archived', 'ignored'] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

/** Statuses hidden from default listings. */
export const HIDDEN_STATUSES: ProjectStatus[] = ['archived', 'ignored']

export interface GitInfo {
  branch: string | null
  lastCommitAt: string | null
  remote: string | null
  dirty: boolean
  /** Commits on HEAD not on any remote ref; null when unknown or without a remote. */
  unpushed?: number | null
  /** git could not be read this time (timeout, lock…); other fields are placeholders. */
  error?: boolean
}

export const HEALTH_KINDS = ['missing', 'no_git', 'no_remote', 'unpushed', 'uncommitted', 'dormant'] as const
export type HealthKind = (typeof HEALTH_KINDS)[number]

export interface HealthFlag {
  kind: HealthKind
  /** e.g. number of unpushed commits */
  count?: number
}

export interface NamedRef {
  id: string
  name: string
}

export interface CategoryRef extends NamedRef {
  color: string
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
  client: NamedRef | null
  category: CategoryRef | null
  /** Framework/runtime versions detected from lockfiles, e.g. { laravel: "10.48.2" }. */
  versions: Record<string, string>
  /** Attention flags (active/paused projects only). */
  health: HealthFlag[]
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
  /** Client id, or 'none' for projects without a client. */
  client?: string
  /** Category id, or 'none' for projects without a category. */
  category?: string
  /** Only projects with at least one health flag. */
  attention?: boolean
  /** "framework@major", e.g. "laravel@9". */
  version?: string
  /** Include archived and ignored projects when no explicit status is given. */
  all?: boolean
}

export interface ProjectPatch {
  name?: string
  description?: string
  status?: ProjectStatus
  /** null clears the client. */
  clientId?: string | null
  /** null clears the category. */
  categoryId?: string | null
}

export interface Client {
  id: string
  name: string
  email: string
  notes: string
  projectCount: number
  openTaskCount: number
  createdAt: string
  updatedAt: string
}

export interface ClientInput {
  name?: string
  email?: string
  notes?: string
}

export interface Category {
  id: string
  name: string
  color: string
  position: number
  projectCount: number
  createdAt: string
  updatedAt: string
}

export interface CategoryInput {
  name?: string
  color?: string
  position?: number
}

export const TASK_STATUSES = ['todo', 'in_progress', 'done'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
export type TaskPriority = (typeof TASK_PRIORITIES)[number]

export const DUE_GROUPS = ['overdue', 'today', 'week', 'later', 'none'] as const
export type DueGroup = (typeof DUE_GROUPS)[number]

export interface Task {
  id: string
  project: NamedRef
  client: NamedRef | null
  category: CategoryRef | null
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  /** YYYY-MM-DD */
  dueDate: string | null
  /** null for done tasks. */
  dueGroup: DueGroup | null
  position: number
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface TaskInput {
  title?: string
  description?: string
  status?: TaskStatus
  priority?: TaskPriority
  /** YYYY-MM-DD, or null to clear. */
  dueDate?: string | null
  position?: number
}

export interface TaskFilters {
  projectId?: string
  /** Client id or 'none'. */
  clientId?: string
  /** Category id or 'none'. */
  categoryId?: string
  /** Defaults to open tasks (todo, in_progress). */
  status?: TaskStatus[]
  priority?: TaskPriority[]
  due?: 'overdue' | 'today' | 'week'
  /** Include tasks of archived and ignored projects. */
  all?: boolean
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
