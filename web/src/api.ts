import type { SyncResult, TimeEntry, TimeReport, WorkBlock } from '../../src/core/time/types'
import type {
  Agreement,
  AgreementKind,
  AiPlan,
  AiPlanKind,
  Expense,
  FinanceReport,
  FinanceRow,
  Interval,
  OwedRow,
  Payment,
} from '../../src/core/finance/types'
import type { CommandDoc, ToolDoc } from '../../src/server/help-types'
import type { Digest, Overview, UpcomingItem } from '../../src/core/overview-types'
import type { HealthFlag } from '../../src/core/types'
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

export type { SyncResult, TimeEntry, TimeReport, WorkBlock }
export type { Agreement, AgreementKind, AiPlan, AiPlanKind, Expense, FinanceReport, FinanceRow, Interval, OwedRow, Payment }
export type { CommandDoc, ToolDoc }
export type { Digest, HealthFlag, Overview, UpcomingItem }

export interface SyncStatus {
  running: boolean
  lastSync: (SyncResult & { finishedAt: string }) | null
  claudeProjectsDir: string
}

export interface Meta {
  version: string
  mcpCommand: string
  statuses: ProjectStatus[]
  stacks: string[]
  tags: string[]
  clients: NamedRef[]
  categories: CategoryRef[]
  versions: string[]
  attention: number
  counts: Record<ProjectStatus, number>
}

export interface Settings {
  ignoreNames: string[]
  idleMinutes: number
  claudeProjectsDir: string
  weekStart: 'monday' | 'sunday'
  currency: string
  usdRate: number
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
  moveCategory: (id: string, direction: 'up' | 'down') =>
    request<Category[]>('POST', `/categories/${id}/move`, { direction }),
  removeCategory: (id: string) => request<void>('DELETE', `/categories/${id}`),

  tasks: (params: Record<string, string | undefined>) => request<Task[]>('GET', `/tasks?${query(params)}`),
  createTask: (projectId: string, input: TaskInput & { title: string }) =>
    request<Task>('POST', '/tasks', { projectId, ...input }),
  updateTask: (id: string, input: TaskInput) => request<Task>('PATCH', `/tasks/${id}`, input),
  removeTask: (id: string) => request<void>('DELETE', `/tasks/${id}`),

  timeReport: (params: Record<string, string | undefined>) => request<TimeReport>('GET', `/time/report?${query(params)}`),
  timeBlocks: (params: Record<string, string | undefined>) =>
    request<{ blocks: WorkBlock[]; entries: TimeEntry[] }>('GET', `/time/blocks?${query(params)}`),
  timeEntries: (params: Record<string, string | undefined>) => request<TimeEntry[]>('GET', `/time/entries?${query(params)}`),
  timeStatus: () => request<SyncStatus>('GET', '/time/status'),
  timeSync: () => request<SyncResult>('POST', '/time/sync', {}),
  addTimeEntry: (input: { projectId: string; date?: string; minutes: string | number; note?: string }) =>
    request<TimeEntry>('POST', '/time/entries', input),
  removeTimeEntry: (id: string) => request<void>('DELETE', `/time/entries/${id}`),

  financeReport: (params: Record<string, string | undefined>) => request<FinanceReport>('GET', `/finance/report?${query(params)}`),
  owed: () => request<{ currency: string; rows: OwedRow[] }>('GET', '/finance/owed'),
  agreements: (project?: string) => request<Agreement[]>('GET', `/agreements?${query({ project })}`),
  addAgreement: (input: { projectId: string; kind: AgreementKind; amount: string; interval?: Interval; startDate?: string; endDate?: string | null; note?: string }) =>
    request<Agreement>('POST', '/agreements', input),
  updateAgreement: (id: string, input: { endDate?: string | null; note?: string }) => request<Agreement>('PATCH', `/agreements/${id}`, input),
  removeAgreement: (id: string) => request<void>('DELETE', `/agreements/${id}`),
  payments: (params: { project?: string; client?: string }) => request<Payment[]>('GET', `/payments?${query(params)}`),
  addPayment: (input: { projectId: string; amount: string; date?: string; note?: string; agreementId?: string | null }) =>
    request<Payment>('POST', '/payments', input),
  removePayment: (id: string) => request<void>('DELETE', `/payments/${id}`),
  expenses: (params: { project?: string; shared?: string }) => request<Expense[]>('GET', `/expenses?${query(params)}`),
  addExpense: (input: { projectId?: string | null; amount: string; interval?: Interval | null; startDate?: string; endDate?: string | null; note?: string }) =>
    request<Expense>('POST', '/expenses', input),
  updateExpense: (id: string, input: { endDate?: string | null }) => request<Expense>('PATCH', `/expenses/${id}`, input),
  removeExpense: (id: string) => request<void>('DELETE', `/expenses/${id}`),
  aiPlans: () => request<AiPlan[]>('GET', '/ai-plans'),
  addAiPlan: (input: { kind: AiPlanKind; monthlyAmount?: string | null; startDate?: string; endDate?: string | null; note?: string }) =>
    request<AiPlan>('POST', '/ai-plans', input),
  updateAiPlan: (id: string, input: { endDate?: string | null }) => request<AiPlan>('PATCH', `/ai-plans/${id}`, input),
  removeAiPlan: (id: string) => request<void>('DELETE', `/ai-plans/${id}`),
  help: () => request<{ cli: CommandDoc[]; mcp: ToolDoc[] }>('GET', '/help'),
  overview: () => request<Overview>('GET', '/overview'),
  digest: (week: 'this' | 'last') => request<Digest & { markdown: string }>('GET', `/digest?week=${week}`),
}
