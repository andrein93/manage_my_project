import type { App } from './app.js'
import { addDays } from './dates.js'
import type { DB } from './db.js'
import { formatCents } from './finance/money.js'
import { upcoming } from './overview.js'
import { currentUserId } from './sync/engine.js'
import type { Task } from './types.js'
import type { Reminder, ReminderSeverity } from './reminder-types.js'

export type { Reminder } from './reminder-types.js'

/** Charges to pay or invoice show up this many days ahead (today included). */
const CHARGE_DAYS = 3
/** State rows for reminders that no longer exist are dropped after this many days. */
const PRUNE_DAYS = 60
const SEVERITY_ORDER: Record<ReminderSeverity, number> = { danger: 0, warning: 1, info: 2 }

interface StateRow {
  key: string
  dismissed_at: string | null
  snoozed_until: string | null
  notified_on: string | null
}

/**
 * What needs the user's attention today, from tasks, statements, charges and custom date fields.
 * Dismiss/snooze/notification state is local (not team-synced).
 */
export class ReminderService {
  constructor(
    private readonly db: DB,
    private readonly app: () => App,
  ) {}

  /** Active reminders: not dismissed, not snoozed past `today`; most urgent first. */
  list(today: string): Reminder[] {
    const state = this.state()
    return this.collect(today).filter((r) => {
      const s = state.get(r.key)
      return !s?.dismissed_at && !(s?.snoozed_until && s.snoozed_until > today)
    })
  }

  dismiss(key: string): void {
    this.upsert(key, 'dismissed_at', new Date().toISOString())
  }

  /** Hides the reminder until the day after `today`. */
  snooze(key: string, today: string): void {
    this.upsert(key, 'snoozed_until', addDays(today, 1))
  }

  /** Active reminders not yet sent as a desktop notification today. */
  dueForNotification(today: string): Reminder[] {
    const state = this.state()
    return this.list(today).filter((r) => state.get(r.key)?.notified_on !== today)
  }

  markNotified(keys: string[], today: string): void {
    for (const key of keys) this.upsert(key, 'notified_on', today)
  }

  /** Forgets state for reminders that no longer exist and were last touched over PRUNE_DAYS ago. */
  prune(today: string): void {
    const cutoff = addDays(today, -PRUNE_DAYS)
    this.db
      .prepare(
        `DELETE FROM reminder_state WHERE key NOT IN (SELECT value FROM json_each(?))
          AND MAX(COALESCE(notified_on, ''), COALESCE(substr(dismissed_at, 1, 10), ''), COALESCE(snoozed_until, '')) < ?`,
      )
      .run(JSON.stringify(this.collect(today).map((r) => r.key)), cutoff)
  }

  private collect(today: string): Reminder[] {
    const app = this.app()
    const out: Reminder[] = []
    const { currency } = app.settings.get()
    // In a team, other people's tasks are theirs to chase.
    const me = currentUserId(this.db)
    const mine = (t: Task) => !t.assignee || t.assignee.id === me

    for (const t of app.tasks.list({ due: 'overdue' }).filter(mine)) {
      out.push({
        key: `task_overdue:${t.id}:${t.dueDate}`,
        kind: 'task_overdue',
        severity: 'danger',
        date: t.dueDate!,
        href: `/projects/${t.project.id}`,
        title: `Overdue task: ${t.title}`,
        detail: `${t.project.name} · due ${t.dueDate}`,
        params: { task: t.title, project: t.project.name },
      })
    }
    for (const s of app.statements.overdue()) {
      out.push({
        key: `statement_overdue:${s.id}:${s.dueDate}`,
        kind: 'statement_overdue',
        severity: 'danger',
        date: s.dueDate!,
        href: `/statements/${s.id}`,
        title: `Statement ${s.number} is overdue`,
        detail: `${s.clientName} · ${formatCents(s.totalCents, s.currency)} · due ${s.dueDate}`,
        params: { number: s.number!, client: s.clientName, amountCents: s.totalCents, currency: s.currency },
      })
    }
    for (const t of app.tasks.list({ due: 'today' }).filter((t) => t.dueDate === today && mine(t))) {
      out.push({
        key: `task_due_today:${t.id}:${today}`,
        kind: 'task_due_today',
        severity: 'warning',
        date: today,
        href: `/projects/${t.project.id}`,
        title: `Due today: ${t.title}`,
        detail: t.project.name,
        params: { task: t.title, project: t.project.name },
      })
    }
    for (const c of upcoming(app, CHARGE_DAYS, today)) {
      const label = c.label || (c.direction === 'pay' ? 'Expense' : 'Recurring fee')
      out.push({
        key: `charge_soon:${c.sourceId}:${c.date}`,
        kind: 'charge_soon',
        severity: 'warning',
        date: c.date,
        href: c.projectId ? `/projects/${c.projectId}` : '/finance',
        title: `${c.direction === 'pay' ? 'To pay' : 'To invoice'}: ${label}`,
        detail: `${c.projectName ?? 'Shared'} · ${formatCents(c.amountCents, currency)} · ${c.date}`,
        params: { direction: c.direction, label: c.label, project: c.projectName ?? '', amountCents: c.amountCents, currency },
      })
    }
    for (const d of app.fields.upcomingDates(today)) {
      out.push({
        key: `field_date:${d.projectId}:${d.fieldId}:${d.date}`,
        kind: 'field_date',
        severity: d.daysLeft < 0 ? 'danger' : d.daysLeft <= 7 ? 'warning' : 'info',
        date: d.date,
        href: `/projects/${d.projectId}`,
        title: `${d.fieldName}: ${d.date}`,
        detail: d.daysLeft < 0 ? `${d.projectName} · ${-d.daysLeft} days ago` : `${d.projectName} · in ${d.daysLeft} days`,
        params: { field: d.fieldName, project: d.projectName, days: d.daysLeft },
      })
    }
    return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.date.localeCompare(b.date))
  }

  private state(): Map<string, StateRow> {
    return new Map((this.db.prepare('SELECT * FROM reminder_state').all() as unknown as StateRow[]).map((r) => [r.key, r]))
  }

  private upsert(key: string, column: 'dismissed_at' | 'snoozed_until' | 'notified_on', value: string) {
    this.db
      .prepare(`INSERT INTO reminder_state (key, ${column}) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET ${column} = excluded.${column}`)
      .run(key, value)
  }
}
