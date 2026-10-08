import type {
  Category,
  CategoryInput,
  CategoryRef,
  Client,
  ClientInput,
  DueGroup,
  NamedRef,
  Project,
  ProjectStatus,
  ScanResult,
  Task,
  TaskInput,
  TaskPriority,
  TaskStatus,
  Workspace,
} from '../../src/core/types'

export type {
  Category,
  CategoryInput,
  CategoryRef,
  Client,
  ClientInput,
  DueGroup,
  NamedRef,
  Project,
  ProjectStatus,
  ScanResult,
  Task,
  TaskInput,
  TaskPriority,
  TaskStatus,
  Workspace,
}

export interface Meta {
  version: string
  mcpCommand: string
  statuses: ProjectStatus[]
  stacks: string[]
  tags: string[]
  clients: NamedRef[]
  categories: CategoryRef[]
  counts: Record<ProjectStatus, number>
}

export interface Settings {
  ignoreNames: string[]
}

export interface ProjectPatch {
  name?: string
  description?: string
  status?: ProjectStatus
  tags?: string[]
  clientId?: string | null
  categoryId?: string | null
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${url}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError('offline', 0)
  }
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(data.error ?? res.statusText, res.status)
  return data as T
}

const query = (params: Record<string, string | undefined>) =>
  new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1])).toString()

export const api = {
  projects: (params: Record<string, string | undefined>) => request<Project[]>('GET', `/projects?${query(params)}`),
  project: (id: string) => request<Project>('GET', `/projects/${id}`),
  updateProject: (id: string, patch: ProjectPatch) => request<Project>('PATCH', `/projects/${id}`, patch),
  open: (id: string, target: 'folder' | 'vscode') => request<void>('POST', `/projects/${id}/open`, { target }),
  addProject: (path: string) => request<Project>('POST', '/projects', { path }),
  scan: () => request<ScanResult>('POST', '/scan', {}),
  workspaces: () => request<Workspace[]>('GET', '/workspaces'),
  addWorkspace: (path: string) => request<{ workspace: Workspace; scan: ScanResult }>('POST', '/workspaces', { path }),
  removeWorkspace: (id: string) => request<void>('DELETE', `/workspaces/${id}`),
  settings: () => request<Settings>('GET', '/settings'),
  updateSettings: (patch: Partial<Settings>) => request<Settings>('PUT', '/settings', patch),
  meta: () => request<Meta>('GET', '/meta'),

  clients: () => request<Client[]>('GET', '/clients'),
  client: (id: string) => request<Client & { projects: Project[] }>('GET', `/clients/${id}`),
  createClient: (input: ClientInput) => request<Client>('POST', '/clients', input),
  updateClient: (id: string, input: ClientInput) => request<Client>('PATCH', `/clients/${id}`, input),
  removeClient: (id: string) => request<void>('DELETE', `/clients/${id}`),

  categories: () => request<Category[]>('GET', '/categories'),
  createCategory: (input: CategoryInput) => request<Category>('POST', '/categories', input),
  updateCategory: (id: string, input: CategoryInput) => request<Category>('PATCH', `/categories/${id}`, input),
  removeCategory: (id: string) => request<void>('DELETE', `/categories/${id}`),

  tasks: (params: Record<string, string | undefined>) => request<Task[]>('GET', `/tasks?${query(params)}`),
  createTask: (projectId: string, input: TaskInput & { title: string }) =>
    request<Task>('POST', '/tasks', { projectId, ...input }),
  updateTask: (id: string, input: TaskInput) => request<Task>('PATCH', `/tasks/${id}`, input),
  removeTask: (id: string) => request<void>('DELETE', `/tasks/${id}`),
}
