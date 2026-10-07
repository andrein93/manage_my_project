import type { Project, ProjectStatus, ScanResult, Workspace } from '../../src/core/types'

export type { Project, ProjectStatus, ScanResult, Workspace }

export interface Meta {
  version: string
  mcpCommand: string
  statuses: ProjectStatus[]
  stacks: string[]
  tags: string[]
  counts: Record<ProjectStatus, number>
}

export interface Settings {
  ignoreNames: string[]
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

export const api = {
  projects: (params: Record<string, string>) => request<Project[]>('GET', `/projects?${new URLSearchParams(params)}`),
  project: (id: string) => request<Project>('GET', `/projects/${id}`),
  updateProject: (id: string, patch: Partial<Pick<Project, 'name' | 'description' | 'status'>>) =>
    request<Project>('PATCH', `/projects/${id}`, patch),
  setTags: (id: string, tags: string[]) => request<Project>('PUT', `/projects/${id}/tags`, { tags }),
  open: (id: string, target: 'folder' | 'vscode') => request<void>('POST', `/projects/${id}/open`, { target }),
  addProject: (path: string) => request<Project>('POST', '/projects', { path }),
  scan: () => request<ScanResult>('POST', '/scan', {}),
  workspaces: () => request<Workspace[]>('GET', '/workspaces'),
  addWorkspace: (path: string) => request<{ workspace: Workspace; scan: ScanResult }>('POST', '/workspaces', { path }),
  removeWorkspace: (id: string) => request<void>('DELETE', `/workspaces/${id}`),
  settings: () => request<Settings>('GET', '/settings'),
  updateSettings: (patch: Partial<Settings>) => request<Settings>('PUT', '/settings', patch),
  meta: () => request<Meta>('GET', '/meta'),
}
