import { addDays, localToday } from '../dates.js'
import type { DB } from '../db.js'
import type { ProjectRepository } from '../projects.js'
import type { SettingsRepository } from '../settings.js'
import { localDateOf, minuteToMs, type DateRange } from '../time/periods.js'
import type { TimeRepository } from '../time/repository.js'
import { addTo, monthOf, occurrences, spreadFixed, type DayAmounts } from './accrual.js'
import { FinanceRepository } from './repository.js'
import type { AiPlan, FinanceNumbers, FinanceReport, FinanceRow, OwedRow } from './types.js'

export interface FinanceFilters {
  projectId?: string
  clientId?: string
}

/** Per-project accumulators (cents as floats until reported). */
interface Acc {
  minutes: number
  earned: number
  collected: number
  ai: number
  expense: number
}

const emptyAcc = (): Acc => ({ minutes: 0, earned: 0, collected: 0, ai: 0, expense: 0 })
const sumMap = (m: Map<string, number>, from: string, to: string) => {
  let total = 0
  for (const [day, v] of m) if (day >= from && day <= to) total += v
  return total
}

export class FinanceService {
  readonly repo: FinanceRepository

  constructor(
    private readonly db: DB,
    private readonly projects: ProjectRepository,
    private readonly settings: SettingsRepository,
    private readonly time: TimeRepository,
    private readonly today: () => string = () => localToday(),
  ) {
    this.repo = new FinanceRepository(db)
  }

  report(input: { range?: DateRange; lifetime?: boolean }, by: 'project' | 'client' = 'project', filters: FinanceFilters = {}): FinanceReport {
    const lifetime = !!input.lifetime || !input.range
    const range = lifetime ? this.lifetimeRange() : input.range!
    const { perProject, overhead } = this.compute(range)
    const all = this.projects.list({ all: true })
    const filtered = !!(filters.projectId || filters.clientId)
    const included = all.filter(
      (p) => (!filters.projectId || p.id === filters.projectId) && (!filters.clientId || (p.client?.id ?? 'none') === filters.clientId),
    )

    const groups = new Map<string, { label: string; acc: Acc }>()
    for (const project of included) {
      const acc = perProject.get(project.id)
      if (!acc || isEmpty(acc)) continue
      const key = by === 'project' ? project.id : (project.client?.id ?? 'none')
      const label = by === 'project' ? project.name : (project.client?.name ?? 'No client')
      const group = groups.get(key) ?? { label, acc: emptyAcc() }
      merge(group.acc, acc)
      groups.set(key, group)
    }
    const rows: FinanceRow[] = [...groups].map(([key, g]) => ({ key, label: g.label, ...numbers(g.acc) }))
    rows.sort((a, b) => b.marginCents - a.marginCents)

    const total = emptyAcc()
    for (const g of groups.values()) merge(total, g.acc)
    const overheadCents = filtered ? 0 : Math.round(overhead)
    // Hours in totals are wall-clock time (parallel projects count once, as in the Time page).
    total.minutes = this.time.report(range, 'project', {
      projectId: filters.projectId,
      clientId: filters.clientId,
      projectsOnly: true,
    }).totals.minutes
    const totals = numbers(total, overheadCents)
    return { range, lifetime, by, currency: this.settings.get().currency, totals: { ...totals, overheadCents }, rows }
  }

  /** Lifetime earned vs collected per client (and project), up to today. Zero balances omitted. */
  owed(): OwedRow[] {
    const { perProject } = this.compute(this.lifetimeRange())
    // Every payment counts, including ones dated in the future (prepayments).
    for (const acc of perProject.values()) acc.collected = 0
    for (const p of this.repo.payments()) {
      let acc = perProject.get(p.projectId)
      if (!acc) perProject.set(p.projectId, (acc = emptyAcc()))
      acc.collected += p.amountCents
    }
    const byClient = new Map<string, OwedRow>()
    for (const project of this.projects.list({ all: true })) {
      const acc = perProject.get(project.id)
      if (!acc) continue
      const earned = Math.round(acc.earned)
      const collected = Math.round(acc.collected)
      if (earned === 0 && collected === 0) continue
      const clientId = project.client?.id ?? 'none'
      const row =
        byClient.get(clientId) ??
        { clientId, clientName: project.client?.name ?? 'No client', projects: [], earnedCents: 0, collectedCents: 0, owedCents: 0 }
      row.projects.push({ id: project.id, name: project.name, earnedCents: earned, collectedCents: collected, owedCents: earned - collected })
      row.earnedCents += earned
      row.collectedCents += collected
      row.owedCents += earned - collected
      byClient.set(clientId, row)
    }
    return [...byClient.values()].filter((r) => r.owedCents !== 0).sort((a, b) => b.owedCents - a.owedCents)
  }

  /** From the earliest money or activity record to today. */
  lifetimeRange(): DateRange {
    const today = this.today()
    const candidates = [
      this.scalar('SELECT MIN(start_date) FROM agreements WHERE deleted_at IS NULL'),
      this.scalar('SELECT MIN(date) FROM payments WHERE deleted_at IS NULL'),
      this.scalar('SELECT MIN(start_date) FROM expenses WHERE deleted_at IS NULL'),
      this.scalar('SELECT MIN(start_date) FROM ai_plans WHERE deleted_at IS NULL'),
      this.scalar('SELECT MIN(date) FROM time_entries WHERE deleted_at IS NULL'),
    ].filter((d): d is string => !!d)
    const firstMinute = this.scalar('SELECT MIN(minute) FROM activity')
    if (firstMinute) candidates.push(localDateOf(minuteToMs(firstMinute)))
    const from = candidates.sort()[0] ?? today
    return { from: from < today ? from : today, to: today }
  }

  /** Everything accrued in `range`, per project, plus overhead not attributable to a project. */
  private compute(range: DateRange): { perProject: Map<string, Acc>; overhead: number } {
    const { usdRate } = this.settings.get()
    // Whole months around the range: shared costs and subscriptions are split by monthly usage.
    const ext = { from: monthOf(range.from).from, to: monthOf(range.to).to }
    const daily = this.time.daily(ext)
    const perProject = new Map<string, Acc>()
    const acc = (id: string) => {
      let a = perProject.get(id)
      if (!a) perProject.set(id, (a = emptyAcc()))
      return a
    }
    let overhead = 0
    const projectMinutes = (id: string) => daily.get(id)?.minutes ?? new Map<string, number>()

    for (const [key, d] of daily) {
      if (!key.startsWith('cwd:')) acc(key).minutes += sumMap(d.minutes, range.from, range.to)
    }

    // Revenue
    for (const a of this.repo.agreements()) {
      const earned: DayAmounts = new Map()
      if (a.kind === 'hourly') {
        for (const [day, minutes] of projectMinutes(a.projectId)) {
          if (day < range.from || day > range.to || day < a.startDate || (a.endDate && day > a.endDate)) continue
          addTo(earned, day, (minutes * a.amountCents) / 60)
        }
      } else if (a.kind === 'fixed') {
        spreadFixed(a.amountCents, a.startDate, a.endDate, range, earned)
      } else {
        for (const day of occurrences(a.startDate, a.endDate, a.interval ?? 'month', range.to)) {
          if (day >= range.from) addTo(earned, day, a.amountCents)
        }
      }
      for (const v of earned.values()) acc(a.projectId).earned += v
    }
    for (const p of this.repo.payments()) {
      if (p.date >= range.from && p.date <= range.to) acc(p.projectId).collected += p.amountCents
    }

    // Expenses
    for (const e of this.repo.expenses()) {
      const dates = e.interval ? occurrences(e.startDate, e.endDate, e.interval, range.to) : [e.startDate]
      for (const day of dates.filter((d) => d >= range.from && d <= range.to)) {
        if (e.projectId) {
          acc(e.projectId).expense += e.amountCents
          continue
        }
        const month = monthOf(day)
        const shares = [...daily]
          .filter(([key]) => !key.startsWith('cwd:'))
          .map(([key, d]) => [key, sumMap(d.minutes, month.from, month.to)] as const)
          .filter(([, minutes]) => minutes > 0)
        const total = shares.reduce((s, [, m]) => s + m, 0)
        if (!total) overhead += e.amountCents
        else for (const [key, minutes] of shares) acc(key).expense += (e.amountCents * minutes) / total
      }
    }

    // AI: pay-as-you-go days use reported cost; subscription months split the fee by usage.
    const plans = this.repo.aiPlans()
    const planOn = (day: string): AiPlan | null =>
      plans.find((p) => p.startDate <= day && (!p.endDate || day <= p.endDate)) ?? null
    for (const [key, d] of daily) {
      for (const [day, usd] of d.costUsd) {
        if (day < range.from || day > range.to || planOn(day)?.kind === 'subscription') continue
        const cents = usd * usdRate * 100
        if (key.startsWith('cwd:')) overhead += cents
        else acc(key).ai += cents
      }
    }
    for (const plan of plans.filter((p) => p.kind === 'subscription')) {
      for (const day of feeDates(plan, range.to)) {
        if (day < range.from) continue
        // Weights: usage on the days of this month that this plan covers.
        const month = monthOf(day)
        const from = month.from > plan.startDate ? month.from : plan.startDate
        const to = plan.endDate && plan.endDate < month.to ? plan.endDate : month.to
        const usage = [...daily].map(([key, d]) => [key, sumMap(d.costUsd, from, to)] as const).filter(([, u]) => u > 0)
        const total = usage.reduce((s, [, u]) => s + u, 0)
        const fee = plan.monthlyCents ?? 0
        if (!total) {
          overhead += fee
          continue
        }
        for (const [key, u] of usage) {
          const share = (fee * u) / total
          if (key.startsWith('cwd:')) overhead += share
          else acc(key).ai += share
        }
      }
    }
    return { perProject, overhead }
  }

  private scalar(sql: string): string | null {
    const row = this.db.prepare(sql).get() as Record<string, string | null> | undefined
    return row ? (Object.values(row)[0] ?? null) : null
  }
}

/** The 1st of every month a subscription covers (its start date in the first month). */
function feeDates(plan: AiPlan, until: string): string[] {
  const last = plan.endDate && plan.endDate < until ? plan.endDate : until
  const dates: string[] = []
  for (let day = plan.startDate; day <= last; ) {
    dates.push(day)
    const next = monthOf(day).to
    day = addDays(next, 1)
  }
  return dates
}

function isEmpty(a: Acc): boolean {
  return !a.minutes && !a.earned && !a.collected && !a.ai && !a.expense
}

function merge(into: Acc, from: Acc): void {
  into.minutes += from.minutes
  into.earned += from.earned
  into.collected += from.collected
  into.ai += from.ai
  into.expense += from.expense
}

function numbers(a: Acc, overheadCents = 0): FinanceNumbers {
  const earnedCents = Math.round(a.earned)
  const aiCents = Math.round(a.ai)
  const expenseCents = Math.round(a.expense)
  const costCents = aiCents + expenseCents + overheadCents
  const marginCents = earnedCents - costCents
  const minutes = Math.round(a.minutes)
  return {
    minutes,
    earnedCents,
    collectedCents: Math.round(a.collected),
    aiCents,
    expenseCents,
    costCents,
    marginCents,
    effectiveRateCents: minutes > 0 ? Math.round(marginCents / (minutes / 60)) : null,
  }
}

