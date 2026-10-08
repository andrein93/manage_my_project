import type { App } from './app.js'
import { addDays, localToday } from './dates.js'
import { occurrences } from './finance/accrual.js'
import { formatCents } from './finance/money.js'
import { formatMinutes } from './time/duration.js'
import { resolvePeriod } from './time/periods.js'
import type { HealthFlag } from './types.js'

export interface UpcomingItem {
  date: string
  /** pay = a cost coming up; invoice = a recurring fee to bill. */
  direction: 'pay' | 'invoice'
  label: string
  projectId: string | null
  projectName: string | null
  amountCents: number
}

export interface Overview {
  today: string
  currency: string
  week: {
    from: string
    to: string
    minutes: number
    costUsd: number
    tasksCompleted: number
    topProjects: { id: string; name: string; minutes: number }[]
  }
  month: { from: string; to: string; earnedCents: number; collectedCents: number; marginCents: number }
  attention: {
    overdueTasks: { id: string; title: string; dueDate: string; projectId: string; projectName: string }[]
    health: { projectId: string; projectName: string; flags: HealthFlag[] }[]
    owed: { clientId: string; clientName: string; owedCents: number }[]
    upcoming: UpcomingItem[]
  }
}

export interface Digest {
  from: string
  to: string
  currency: string
  minutes: number
  costUsd: number
  earnedCents: number
  collectedCents: number
  topProjects: { name: string; minutes: number }[]
  tasksCompleted: { title: string; projectName: string }[]
  overdueTasks: number
  health: Record<string, string[]>
  owedCents: number
  upcoming: UpcomingItem[]
}

/** Recurring costs to pay and recurring fees to invoice in the next `days` days (inclusive of today). */
export function upcoming(app: App, days = 30, today = localToday()): UpcomingItem[] {
  const until = addDays(today, days)
  const items: UpcomingItem[] = []
  for (const e of app.finance.repo.expenses()) {
    const dates = e.interval ? occurrences(e.startDate, e.endDate, e.interval, until) : [e.startDate]
    for (const date of dates.filter((d) => d >= today && d <= until)) {
      items.push({ date, direction: 'pay', label: e.note || 'Expense', projectId: e.projectId, projectName: e.projectName, amountCents: e.amountCents })
    }
  }
  for (const a of app.finance.repo.agreements()) {
    if (a.kind !== 'recurring' || !a.interval) continue
    for (const date of occurrences(a.startDate, a.endDate, a.interval, until).filter((d) => d >= today)) {
      items.push({ date, direction: 'invoice', label: a.note || 'Recurring fee', projectId: a.projectId, projectName: a.projectName, amountCents: a.amountCents })
    }
  }
  return items.sort((x, y) => x.date.localeCompare(y.date) || x.direction.localeCompare(y.direction))
}

export function overview(app: App, today = localToday()): Overview {
  const { weekStart, currency } = app.settings.get()
  const week = resolvePeriod('week', today, weekStart)
  const month = resolvePeriod('month', today, weekStart)
  const time = app.time.repo.report(week, 'project')
  const money = app.finance.report({ range: month })
  const completedThisWeek = app.tasks
    .list({ status: ['done'], all: true })
    .filter((t) => t.completedAt && localDateOfIso(t.completedAt) >= week.from && localDateOfIso(t.completedAt) <= week.to)

  return {
    today,
    currency,
    week: {
      ...week,
      minutes: time.totals.minutes,
      costUsd: time.totals.costUsd,
      tasksCompleted: completedThisWeek.length,
      topProjects: time.rows.slice(0, 5).map((r) => ({ id: r.key, name: r.label, minutes: r.minutes })),
    },
    month: {
      ...month,
      earnedCents: money.totals.earnedCents,
      collectedCents: money.totals.collectedCents,
      marginCents: money.totals.marginCents,
    },
    attention: {
      overdueTasks: app.tasks
        .list({ due: 'overdue' })
        .map((t) => ({ id: t.id, title: t.title, dueDate: t.dueDate!, projectId: t.project.id, projectName: t.project.name })),
      health: app.projects
        .list({ attention: true })
        .map((p) => ({ projectId: p.id, projectName: p.name, flags: p.health })),
      owed: app.finance
        .owed()
        .filter((o) => o.owedCents > 0)
        .map((o) => ({ clientId: o.clientId, clientName: o.clientName, owedCents: o.owedCents })),
      upcoming: upcoming(app, 30, today),
    },
  }
}

/** A week in review: this week so far, or last week. */
export function digest(app: App, which: 'this' | 'last' = 'this', today = localToday()): Digest {
  const { weekStart, currency } = app.settings.get()
  const range = resolvePeriod(which === 'this' ? 'week' : 'last-week', today, weekStart)
  const time = app.time.repo.report(range, 'project')
  const money = app.finance.report({ range })
  const health: Record<string, string[]> = {}
  for (const p of app.projects.list({ attention: true })) {
    for (const f of p.health) (health[f.kind] ??= []).push(p.name)
  }
  return {
    ...range,
    currency,
    minutes: time.totals.minutes,
    costUsd: time.totals.costUsd,
    earnedCents: money.totals.earnedCents,
    collectedCents: money.totals.collectedCents,
    topProjects: time.rows.slice(0, 5).map((r) => ({ name: r.label, minutes: r.minutes })),
    tasksCompleted: app.tasks
      .list({ status: ['done'], all: true })
      .filter((t) => t.completedAt && localDateOfIso(t.completedAt) >= range.from && localDateOfIso(t.completedAt) <= range.to)
      .map((t) => ({ title: t.title, projectName: t.project.name })),
    overdueTasks: app.tasks.list({ due: 'overdue' }).length,
    health,
    owedCents: app.finance.owed().reduce((sum, o) => sum + Math.max(0, o.owedCents), 0),
    upcoming: upcoming(app, 14, today),
  }
}

const HEALTH_LABELS: Record<string, string> = {
  missing: 'Folder missing',
  no_git: 'Not under git',
  no_remote: 'No remote (no backup)',
  unpushed: 'Unpushed commits',
  uncommitted: 'Uncommitted changes',
  dormant: 'Active but untouched for 90+ days',
}

export function digestMarkdown(d: Digest): string {
  const m = (c: number) => formatCents(c, d.currency)
  const lines = [
    `# Week ${d.from} → ${d.to}`,
    '',
    `- **Time worked:** ${formatMinutes(d.minutes)}`,
    `- **AI cost (API-equivalent):** $${d.costUsd.toFixed(2)}`,
    `- **Earned:** ${m(d.earnedCents)}, **collected:** ${m(d.collectedCents)}`,
    `- **Owed to you (all time):** ${m(d.owedCents)}`,
    `- **Overdue tasks:** ${d.overdueTasks}`,
  ]
  if (d.topProjects.length) {
    lines.push('', '## Where the time went', ...d.topProjects.map((p) => `- ${p.name}: ${formatMinutes(p.minutes)}`))
  }
  if (d.tasksCompleted.length) {
    lines.push('', '## Done', ...d.tasksCompleted.map((t) => `- ${t.title} (${t.projectName})`))
  }
  const healthKinds = Object.keys(d.health)
  if (healthKinds.length) {
    lines.push('', '## Needs attention', ...healthKinds.map((k) => `- ${HEALTH_LABELS[k] ?? k}: ${d.health[k].join(', ')}`))
  }
  if (d.upcoming.length) {
    lines.push(
      '',
      '## Coming up',
      ...d.upcoming.map((u) => `- ${u.date}: ${u.direction === 'pay' ? 'pay' : 'invoice'} ${m(u.amountCents)} — ${u.label}${u.projectName ? ` (${u.projectName})` : ''}`),
    )
  }
  return lines.join('\n') + '\n'
}

function localDateOfIso(iso: string): string {
  return localToday(new Date(iso))
}
