// Plain types shared by the server and the dashboard (no runtime imports here).

export const REMINDER_KINDS = ['task_overdue', 'task_due_today', 'statement_overdue', 'charge_soon', 'field_date'] as const
export type ReminderKind = (typeof REMINDER_KINDS)[number]
export type ReminderSeverity = 'danger' | 'warning' | 'info'

export interface Reminder {
  /** Stable identity: dismissing it hides this reminder until a new one (new date, new item) appears. */
  key: string
  kind: ReminderKind
  severity: ReminderSeverity
  /** YYYY-MM-DD the reminder is about (due date, charge date, field date). */
  date: string
  /** Dashboard route to open. */
  href: string
  /** English text, for the CLI, the AI and desktop notifications. */
  title: string
  detail: string
  /** Raw values so the dashboard can write its own translated text. */
  params: Record<string, string | number>
}
