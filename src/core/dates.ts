import { UserError, type DueGroup } from './types.js'

/** Today's date on this machine as YYYY-MM-DD. */
export function localToday(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Validates a YYYY-MM-DD calendar date. */
export function cleanDate(value: string): string {
  const day = value.trim()
  const parsed = new Date(`${day}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) {
    throw new UserError(`Invalid date "${value}". Use YYYY-MM-DD.`)
  }
  return day
}

export function dueGroup(dueDate: string | null, today: string): DueGroup {
  if (!dueDate) return 'none'
  if (dueDate < today) return 'overdue'
  if (dueDate === today) return 'today'
  if (dueDate <= addDays(today, 7)) return 'week'
  return 'later'
}
