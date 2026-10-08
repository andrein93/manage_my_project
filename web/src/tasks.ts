import type { Task, TaskPriority, TaskStatus } from './api'

export const TASK_STATUSES: TaskStatus[] = ['todo', 'in_progress', 'done']
export const TASK_PRIORITIES: TaskPriority[] = ['urgent', 'high', 'normal', 'low']

/** Text color for a priority; normal stays quiet. */
export const priorityClass: Record<TaskPriority, string> = {
  urgent: 'text-danger font-medium',
  high: 'text-aging font-medium',
  normal: 'text-muted',
  low: 'text-dormant',
}

/** "Oct 15" style label for a YYYY-MM-DD date, in the viewer's locale. */
export function shortDate(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** Position for inserting before `index` in an ordered column (append when index = length). */
export function positionAt(column: Task[], index: number): number {
  const before = column[index - 1]?.position
  const after = column[index]?.position
  if (before !== undefined && after !== undefined) return (before + after) / 2
  if (before !== undefined) return before + 1
  if (after !== undefined) return after - 1
  return 1
}
