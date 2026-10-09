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
  Statement,
  StatementLine,
  StatementLineInput,
  StatementStatus,
  Billing,
} from '../../src/core/finance/types'
import type { CommandDoc, ToolDoc } from '../../src/server/help-types'
import type { Digest, Overview, UpcomingItem } from '../../src/core/overview-types'
import type { HealthFlag } from '../../src/core/types'
import type { SyncRunResult, SyncStatus as TeamSyncStatus, TeamMember } from '../../src/core/sync/types'
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
export type { Billing, Statement, StatementLine, StatementLineInput, StatementStatus }
export type { CommandDoc, ToolDoc }
export type { Digest, HealthFlag, Overview, UpcomingItem }
export type { SyncRunResult, TeamMember, TeamSyncStatus }

export interface SyncStatus {
  running: boolean
  lastSync: (SyncResult & { finishedAt: string }) | null
  claudeProjectsDir: string
}

export interface Meta {
  version: string
  /** Stamp id of the build the server runs; null on a dev server. */
  build: string | null
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
  billing: Billing
}

export interface ProjectPatch {
  shared?: boolean
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
  updateSettings: (patch: Partial<Omit<Settings, 'billing'>> & { billing?: Partial<Billing> }) => request<Settings>('PUT', '/settings', patch),
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

  /** `tasksCompleted` is missing on servers older than the dashboard. */
  timeReport: (params: Record<string, string | undefined>) => request<TimeReport & { tasksCompleted?: number }>('GET', `/time/report?${query(params)}`),
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
  syncStatus: () => request<TeamSyncStatus>('GET', '/sync/status'),
  syncLogin: (url: string, token: string) => request<TeamSyncStatus>('POST', '/sync/login', { url, token }),
  syncRun: () => request<SyncRunResult>('POST', '/sync/run', {}),
  syncLogout: () => request<TeamSyncStatus>('POST', '/sync/logout', {}),
  members: () => request<TeamMember[]>('GET', '/members'),
  teamTime: (projectId: string) =>
    request<{ range: { from: string; to: string }; members: { userId: string; name: string; minutes: number }[] }>(
      'GET',
      `/projects/${projectId}/team-time`,
    ),
  statements: (params: { client?: string; status?: StatementStatus } = {}) => request<Statement[]>('GET', `/statements?${query(params)}`),
  statement: (id: string) => request<Statement>('GET', `/statements/${id}`),
  createStatement: (input: { clientId: string; from: string; to: string; language?: string }) => request<Statement>('POST', '/statements', input),
  updateStatement: (id: string, patch: { periodFrom?: string; periodTo?: string; vatRate?: number; language?: string; notes?: string; dueDate?: string | null }) =>
    request<Statement>('PATCH', `/statements/${id}`, patch),
  setStatementLines: (id: string, lines: StatementLineInput[]) => request<Statement>('PUT', `/statements/${id}/lines`, { lines }),
  refillStatement: (id: string) => request<Statement>('POST', `/statements/${id}/refill`, {}),
  issueStatement: (id: string, issueDate?: string) => request<Statement>('POST', `/statements/${id}/issue`, issueDate ? { issueDate } : {}),
  markStatementPaid: (id: string, date?: string) => request<Statement>('POST', `/statements/${id}/paid`, date ? { date } : {}),
  markStatementUnpaid: (id: string) => request<Statement>('POST', `/statements/${id}/unpaid`, {}),
  voidStatement: (id: string) => request<Statement>('POST', `/statements/${id}/void`, {}),
  removeStatement: (id: string) => request<void>('DELETE', `/statements/${id}`),
  digest: (week: 'this' | 'last') => request<Digest & { markdown: string }>('GET', `/digest?week=${week}`),
}
