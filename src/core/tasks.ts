import { cleanText } from './clients.js'
import { addDays, cleanDate, dueGroup, localToday } from './dates.js'
import { localUserId, transaction, type DB } from './db.js'
import { newId, now } from './ids.js'
import { resolveRef } from './refs.js'
import {
  HIDDEN_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  UserError,
  type Task,
  type TaskFilters,
  type TaskInput,
  type TaskPriority,
  type TaskStatus,
} from './types.js'

interface TaskRow {
  id: string
  project_id: string
  project_name: string
  project_status: string
  client_id: string | null
  client_name: string | null
  category_id: string | null
  category_name: string | null
  category_color: string | null
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  due_date: string | null
  position: number
  completed_at: string | null
  created_at: string
  updated_at: string
}

const SELECT = `
  SELECT t.*, p.name AS project_name, p.status AS project_status,
    p.client_id, c.name AS client_name, p.category_id, g.name AS category_name, g.color AS category_color
  FROM tasks t
  JOIN projects p ON p.id = t.project_id AND p.deleted_at IS NULL
  LEFT JOIN clients c ON c.id = p.client_id AND c.deleted_at IS NULL
  LEFT JOIN categories g ON g.id = p.category_id AND g.deleted_at IS NULL
  WHERE t.deleted_at IS NULL`

const OPEN: TaskStatus[] = ['todo', 'in_progress']
const PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 }

export interface NewTask extends TaskInput {
  title: string
}

export class TaskRepository {
  /** `today` is injectable so due groups are testable. */
  constructor(
    private readonly db: DB,
    private readonly today: () => string = () => localToday(),
  ) {}

  /** Sorted by due date (none last), then priority, then manual position. */
  list(filters: TaskFilters = {}): Task[] {
    const statuses = filters.status?.length ? filters.status : OPEN
    const today = this.today()
    const rows = this.db.prepare(SELECT).all() as unknown as TaskRow[]
    return rows
      .filter((r) => {
        if (!statuses.includes(r.status)) return false
        if (filters.projectId && r.project_id !== filters.projectId) return false
        if (!filters.projectId && !filters.all && HIDDEN_STATUSES.includes(r.project_status as never)) return false
        if (filters.clientId && (r.client_name ? r.client_id : 'none') !== filters.clientId) return false
        if (filters.categoryId && (r.category_name ? r.category_id : 'none') !== filters.categoryId) return false
        if (filters.priority?.length && !filters.priority.includes(r.priority)) return false
        if (filters.due) {
          if (!r.due_date || r.status === 'done') return false
          if (filters.due === 'overdue' && !(r.due_date < today)) return false
          if (filters.due === 'today' && !(r.due_date <= today)) return false
          if (filters.due === 'week' && !(r.due_date <= addDays(today, 7))) return false
        }
        return true
      })
      .sort(
        (a, b) =>
          (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') ||
          PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
          a.position - b.position,
      )
      .map((r) => toTask(r, today))
  }

  get(id: string): Task | null {
    const row = this.db.prepare(`${SELECT} AND t.id = ?`).get(id) as TaskRow | undefined
    return row ? toTask(row, this.today()) : null
  }

  /** id or id prefix (≥ 6 chars), among all tasks including done ones. */
  resolve(ref: string): Task {
    return resolveRef(this.list({ status: [...TASK_STATUSES], all: true }), ref, 'task')
  }

  /** Creates several tasks in one transaction (all or nothing). */
  create(projectId: string, inputs: NewTask[]): Task[] {
    if (!this.db.prepare('SELECT 1 FROM projects WHERE id = ? AND deleted_at IS NULL').get(projectId)) {
      throw new UserError(`Project not found: ${projectId}`, 'not_found')
    }
    if (inputs.length === 0) throw new UserError('No tasks to create')
    const ids = transaction(this.db, () =>
      inputs.map((input) => {
        const fields = validate(input)
        const status = fields.status ?? 'todo'
        const id = newId()
        const ts = now()
        this.db
          .prepare(
            `INSERT INTO tasks (id, owner_id, project_id, title, description, status, priority, due_date, position,
              completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            id,
            localUserId(this.db),
            projectId,
            fields.title!,
            fields.description ?? '',
            status,
            fields.priority ?? 'normal',
            fields.dueDate ?? null,
            fields.position ?? this.nextPosition(projectId, status),
            status === 'done' ? ts : null,
            ts,
            ts,
          )
        return id
      }),
    )
    return ids.map((id) => this.get(id)!)
  }

  update(id: string, input: TaskInput): Task {
    return transaction(this.db, () => this.updateUnlocked(id, input))
  }

  private updateUnlocked(id: string, input: TaskInput): Task {
    const task = this.get(id)
    if (!task) throw new UserError(`Task not found: ${id}`, 'not_found')
    const fields = validate(input, false)
    const status = fields.status ?? task.status
    const statusChanged = status !== task.status
    const position = fields.position ?? (statusChanged ? this.nextPosition(task.project.id, status) : task.position)
    const completedAt = status === 'done' ? (task.completedAt ?? now()) : null
    this.db
      .prepare(
        `UPDATE tasks SET title = ?, description = ?, status = ?, priority = ?, due_date = ?, position = ?,
          completed_at = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        fields.title ?? task.title,
        fields.description ?? task.description,
        status,
        fields.priority ?? task.priority,
        fields.dueDate === undefined ? task.dueDate : fields.dueDate,
        position,
        completedAt,
        now(),
        id,
      )
    this.renumberIfCrowded(task.project.id, status)
    return this.get(id)!
  }

  /**
   * Fractional positions (drag between two cards) eventually collide; when two neighbours get
   * too close, rewrite the column as 1, 2, 3… keeping the current order.
   */
  private renumberIfCrowded(projectId: string, status: TaskStatus): void {
    const rows = this.db
      .prepare(
        'SELECT id, position FROM tasks WHERE project_id = ? AND status = ? AND deleted_at IS NULL ORDER BY position, updated_at',
      )
      .all(projectId, status) as { id: string; position: number }[]
    const crowded = rows.some((r, i) => i > 0 && r.position - rows[i - 1].position < 1e-6)
    if (!crowded) return
    rows.forEach((r, i) => this.db.prepare('UPDATE tasks SET position = ? WHERE id = ?').run(i + 1, r.id))
  }

  remove(id: string): Task {
    const task = this.get(id)
    if (!task) throw new UserError(`Task not found: ${id}`, 'not_found')
    const ts = now()
    this.db.prepare('UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ?').run(ts, ts, id)
    return task
  }

  private nextPosition(projectId: string, status: TaskStatus): number {
    const row = this.db
      .prepare('SELECT MAX(position) AS p FROM tasks WHERE project_id = ? AND status = ? AND deleted_at IS NULL')
      .get(projectId, status) as { p: number | null }
    return (row.p ?? 0) + 1
  }
}

function validate(input: TaskInput, requireTitle = true): TaskInput {
  const out: TaskInput = {}
  if (input.title !== undefined || requireTitle) {
    const title = (input.title ?? '').trim()
    if (!title) throw new UserError('Task title cannot be empty')
    if (title.length > 500) throw new UserError('Task title is too long (max 500)')
    out.title = title
  }
  if (input.description !== undefined) out.description = cleanText(input.description, 20_000)
  if (input.status !== undefined) {
    if (!TASK_STATUSES.includes(input.status)) {
      throw new UserError(`Invalid status "${input.status}". Use one of: ${TASK_STATUSES.join(', ')}`)
    }
    out.status = input.status
  }
  if (input.priority !== undefined) {
    if (!TASK_PRIORITIES.includes(input.priority)) {
      throw new UserError(`Invalid priority "${input.priority}". Use one of: ${TASK_PRIORITIES.join(', ')}`)
    }
    out.priority = input.priority
  }
  if (input.dueDate !== undefined) out.dueDate = input.dueDate === null ? null : cleanDate(input.dueDate)
  if (input.position !== undefined) {
    if (!Number.isFinite(input.position)) throw new UserError('Invalid position')
    out.position = input.position
  }
  return out
}

function toTask(row: TaskRow, today: string): Task {
  return {
    id: row.id,
    project: { id: row.project_id, name: row.project_name },
    client: row.client_id && row.client_name ? { id: row.client_id, name: row.client_name } : null,
    category:
      row.category_id && row.category_name
        ? { id: row.category_id, name: row.category_name, color: row.category_color! }
        : null,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dueDate: row.due_date,
    dueGroup: row.status === 'done' ? null : dueGroup(row.due_date, today),
    position: Number(row.position),
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
