import { cleanText } from '../clients.js'
import { cleanDate, localToday } from '../dates.js'
import { localUserId, transaction, type DB } from '../db.js'
import { newId, now } from '../ids.js'
import { UserError } from '../types.js'
import { parseAmount } from './money.js'
import {
  AGREEMENT_KINDS,
  AI_PLAN_KINDS,
  INTERVALS,
  type Agreement,
  type AgreementKind,
  type AiPlan,
  type AiPlanKind,
  type Expense,
  type Interval,
  type Payment,
} from './types.js'

export interface AgreementInput {
  projectId?: string
  kind?: AgreementKind
  amount?: string | number
  interval?: Interval | null
  startDate?: string
  endDate?: string | null
  note?: string
}

export interface PaymentInput {
  projectId?: string
  agreementId?: string | null
  /** Set by statements; payments recorded by hand have none. */
  statementId?: string
  date?: string
  amount?: string | number
  note?: string
}

export interface ExpenseInput {
  projectId?: string | null
  amount?: string | number
  interval?: Interval | null
  startDate?: string
  endDate?: string | null
  note?: string
}

export interface AiPlanInput {
  kind?: AiPlanKind
  monthlyAmount?: string | number | null
  startDate?: string
  endDate?: string | null
  note?: string
}

type Row = Record<string, unknown>

/** Two inclusive date ranges (null end = open) overlap. */
function overlaps(aStart: string, aEnd: string | null, bStart: string, bEnd: string | null): boolean {
  return aStart <= (bEnd ?? '9999-12-31') && bStart <= (aEnd ?? '9999-12-31')
}

function cleanEnd(start: string, end: string | null | undefined): string | null {
  if (end === null || end === undefined || end === '') return null
  const day = cleanDate(end)
  if (day < start) throw new UserError('The end date cannot be before the start date')
  return day
}

function cleanInterval(value: unknown): Interval {
  if (!INTERVALS.includes(value as Interval)) throw new UserError(`Invalid interval "${value}". Use month or year.`)
  return value as Interval
}

export class FinanceRepository {
  constructor(private readonly db: DB) {}

  // ---------- Agreements ----------

  agreements(projectId?: string): Agreement[] {
    const rows = this.db
      .prepare(
        `SELECT a.*, p.name AS project_name FROM agreements a JOIN projects p ON p.id = a.project_id AND p.deleted_at IS NULL
         WHERE a.deleted_at IS NULL ${projectId ? 'AND a.project_id = ?' : ''} ORDER BY a.start_date DESC, a.created_at DESC`,
      )
      .all(...(projectId ? [projectId] : [])) as Row[]
    return rows.map(toAgreement)
  }

  addAgreement(input: AgreementInput): Agreement {
    return transaction(this.db, () => {
      const fields = this.validateAgreement(input, null)
      const id = newId()
      const ts = now()
      this.db
        .prepare(
          `INSERT INTO agreements (id, owner_id, project_id, kind, amount_cents, interval, start_date, end_date, note, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, localUserId(this.db), fields.projectId, fields.kind, fields.amountCents, fields.interval, fields.startDate, fields.endDate, fields.note, ts, ts)
      return this.agreement(id)!
    })
  }

  updateAgreement(id: string, input: AgreementInput): Agreement {
    return transaction(this.db, () => {
      const current = this.agreement(id)
      if (!current) throw new UserError(`Agreement not found: ${id}`, 'not_found')
      if (input.projectId && input.projectId !== current.projectId) {
        throw new UserError('An agreement cannot move to another project; remove it and add a new one')
      }
      const kind = input.kind ?? current.kind
      // A fixed price without an end date is booked on its start date; ending it later would
      // silently re-spread revenue that past reports already showed.
      if (kind === 'fixed' && current.kind === 'fixed' && current.endDate === null && input.endDate) {
        throw new UserError('This fixed price has no end date, so it is booked on its start date. Remove it and add it again with an end date to spread it.')
      }
      const merged: AgreementInput = {
        projectId: current.projectId,
        kind,
        amount: input.amount ?? current.amountCents / 100,
        interval: kind === 'recurring' ? (input.interval === undefined ? (current.interval ?? 'month') : input.interval) : (input.interval ?? null),
        startDate: input.startDate ?? current.startDate,
        endDate: input.endDate === undefined ? current.endDate : input.endDate,
        note: input.note ?? current.note,
      }
      const f = this.validateAgreement(merged, id)
      this.db
        .prepare(
          `UPDATE agreements SET project_id = ?, kind = ?, amount_cents = ?, interval = ?, start_date = ?, end_date = ?, note = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(f.projectId, f.kind, f.amountCents, f.interval, f.startDate, f.endDate, f.note, now(), id)
      return this.agreement(id)!
    })
  }

  removeAgreement(id: string): Agreement {
    const agreement = this.agreement(id)
    if (!agreement) throw new UserError(`Agreement not found: ${id}`, 'not_found')
    this.softDelete('agreements', id)
    return agreement
  }

  private agreement(id: string): Agreement | null {
    return this.agreements().find((a) => a.id === id) ?? null
  }

  private validateAgreement(input: AgreementInput, selfId: string | null) {
    const projectId = this.requireProject(input.projectId)
    if (!AGREEMENT_KINDS.includes(input.kind as AgreementKind)) {
      throw new UserError(`Invalid agreement type "${input.kind}". Use hourly, fixed or recurring.`)
    }
    const kind = input.kind as AgreementKind
    if (input.amount === undefined) throw new UserError(kind === 'hourly' ? 'Hourly rate is required' : 'Amount is required')
    const amountCents = parseAmount(input.amount)
    const interval = kind === 'recurring' ? cleanInterval(input.interval ?? 'month') : null
    if (kind !== 'recurring' && input.interval) throw new UserError('Only recurring agreements have an interval')
    const startDate = cleanDate(input.startDate ?? localToday())
    const endDate = cleanEnd(startDate, input.endDate)
    if (kind === 'hourly') {
      const clash = this.agreements(projectId).find(
        (a) => a.kind === 'hourly' && a.id !== selfId && overlaps(a.startDate, a.endDate, startDate, endDate),
      )
      if (clash) {
        throw new UserError(
          `This project already has an hourly rate from ${clash.startDate}${clash.endDate ? ` to ${clash.endDate}` : ''}. ` +
            'Set an end date on it first.',
          'conflict',
        )
      }
    }
    return { projectId, kind, amountCents, interval, startDate, endDate, note: cleanText(input.note, 2000) }
  }

  // ---------- Payments ----------

  payments(filter: { projectId?: string; clientId?: string } = {}): Payment[] {
    const rows = this.db
      .prepare(
        `SELECT pay.*, p.name AS project_name, p.client_id, c.name AS client_name FROM payments pay
         JOIN projects p ON p.id = pay.project_id AND p.deleted_at IS NULL
         LEFT JOIN clients c ON c.id = p.client_id AND c.deleted_at IS NULL
         WHERE pay.deleted_at IS NULL ORDER BY pay.date DESC, pay.created_at DESC`,
      )
      .all() as Row[]
    return rows
      .filter((r) => (!filter.projectId || r.project_id === filter.projectId) && (!filter.clientId || r.client_id === filter.clientId))
      .map(toPayment)
  }

  addPayment(input: PaymentInput): Payment {
    const projectId = this.requireProject(input.projectId)
    if (input.amount === undefined) throw new UserError('Amount is required')
    const amountCents = parseAmount(input.amount)
    const agreementId = input.agreementId || null
    if (agreementId && !this.agreements(projectId).some((a) => a.id === agreementId)) {
      throw new UserError('That agreement does not belong to this project', 'not_found')
    }
    const id = newId()
    const ts = now()
    this.db
      .prepare(
        `INSERT INTO payments (id, owner_id, project_id, agreement_id, statement_id, date, amount_cents, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        localUserId(this.db),
        projectId,
        agreementId,
        input.statementId ?? null,
        cleanDate(input.date ?? localToday()),
        amountCents,
        cleanText(input.note, 2000),
        ts,
        ts,
      )
    return this.payments().find((p) => p.id === id)!
  }

  removePayment(id: string): Payment {
    const payment = this.payments().find((p) => p.id === id)
    if (!payment) throw new UserError(`Payment not found: ${id}`, 'not_found')
    this.softDelete('payments', id)
    return payment
  }

  // ---------- Expenses ----------

  expenses(filter: { projectId?: string; shared?: boolean } = {}): Expense[] {
    const rows = this.db
      .prepare(
        `SELECT e.*, p.name AS project_name FROM expenses e LEFT JOIN projects p ON p.id = e.project_id
         WHERE e.deleted_at IS NULL AND (e.project_id IS NULL OR p.deleted_at IS NULL)
         ORDER BY e.start_date DESC, e.created_at DESC`,
      )
      .all() as Row[]
    return rows
      .filter((r) => {
        if (filter.shared === true && r.project_id !== null) return false
        if (filter.shared === false && r.project_id === null) return false
        return !filter.projectId || r.project_id === filter.projectId
      })
      .map(toExpense)
  }

  addExpense(input: ExpenseInput): Expense {
    const projectId = input.projectId ? this.requireProject(input.projectId) : null
    if (input.amount === undefined) throw new UserError('Amount is required')
    const amountCents = parseAmount(input.amount)
    const interval = input.interval ? cleanInterval(input.interval) : null
    const startDate = cleanDate(input.startDate ?? localToday())
    const endDate = interval ? cleanEnd(startDate, input.endDate) : null
    if (!interval && input.endDate) throw new UserError('Only recurring expenses have an end date')
    const id = newId()
    const ts = now()
    this.db
      .prepare(
        `INSERT INTO expenses (id, owner_id, project_id, amount_cents, interval, start_date, end_date, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, localUserId(this.db), projectId, amountCents, interval, startDate, endDate, cleanText(input.note, 2000), ts, ts)
    return this.expenses().find((e) => e.id === id)!
  }

  updateExpense(id: string, input: { endDate?: string | null; note?: string; amount?: string | number }): Expense {
    const expense = this.expenses().find((e) => e.id === id)
    if (!expense) throw new UserError(`Expense not found: ${id}`, 'not_found')
    if (input.endDate !== undefined && !expense.interval) throw new UserError('Only recurring expenses have an end date')
    this.db
      .prepare('UPDATE expenses SET amount_cents = ?, end_date = ?, note = ?, updated_at = ? WHERE id = ?')
      .run(
        input.amount === undefined ? expense.amountCents : parseAmount(input.amount),
        input.endDate === undefined ? expense.endDate : cleanEnd(expense.startDate, input.endDate),
        input.note === undefined ? expense.note : cleanText(input.note, 2000),
        now(),
        id,
      )
    return this.expenses().find((e) => e.id === id)!
  }

  removeExpense(id: string): Expense {
    const expense = this.expenses().find((e) => e.id === id)
    if (!expense) throw new UserError(`Expense not found: ${id}`, 'not_found')
    this.softDelete('expenses', id)
    return expense
  }

  // ---------- AI plans ----------

  aiPlans(): AiPlan[] {
    return (this.db.prepare('SELECT * FROM ai_plans WHERE deleted_at IS NULL ORDER BY start_date').all() as Row[]).map(toAiPlan)
  }

  addAiPlan(input: AiPlanInput): AiPlan {
    return transaction(this.db, () => {
      const f = this.validatePlan(input, null)
      const id = newId()
      const ts = now()
      this.db
        .prepare(
          `INSERT INTO ai_plans (id, owner_id, kind, monthly_cents, start_date, end_date, note, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, localUserId(this.db), f.kind, f.monthlyCents, f.startDate, f.endDate, f.note, ts, ts)
      return this.aiPlans().find((p) => p.id === id)!
    })
  }

  updateAiPlan(id: string, input: AiPlanInput): AiPlan {
    return transaction(this.db, () => {
      const plan = this.aiPlans().find((p) => p.id === id)
      if (!plan) throw new UserError(`AI plan not found: ${id}`, 'not_found')
      const f = this.validatePlan(
        {
          kind: input.kind ?? plan.kind,
          monthlyAmount: input.monthlyAmount === undefined ? (plan.monthlyCents === null ? null : plan.monthlyCents / 100) : input.monthlyAmount,
          startDate: input.startDate ?? plan.startDate,
          endDate: input.endDate === undefined ? plan.endDate : input.endDate,
          note: input.note ?? plan.note,
        },
        id,
      )
      this.db
        .prepare('UPDATE ai_plans SET kind = ?, monthly_cents = ?, start_date = ?, end_date = ?, note = ?, updated_at = ? WHERE id = ?')
        .run(f.kind, f.monthlyCents, f.startDate, f.endDate, f.note, now(), id)
      return this.aiPlans().find((p) => p.id === id)!
    })
  }

  removeAiPlan(id: string): AiPlan {
    const plan = this.aiPlans().find((p) => p.id === id)
    if (!plan) throw new UserError(`AI plan not found: ${id}`, 'not_found')
    this.softDelete('ai_plans', id)
    return plan
  }

  private validatePlan(input: AiPlanInput, selfId: string | null) {
    if (!AI_PLAN_KINDS.includes(input.kind as AiPlanKind)) throw new UserError('AI plan type must be api or subscription')
    const kind = input.kind as AiPlanKind
    let monthlyCents: number | null = null
    if (kind === 'subscription') {
      if (input.monthlyAmount === undefined || input.monthlyAmount === null) throw new UserError('Monthly fee is required for a subscription')
      monthlyCents = parseAmount(input.monthlyAmount)
    }
    const startDate = cleanDate(input.startDate ?? localToday())
    const endDate = cleanEnd(startDate, input.endDate)
    const clash = this.aiPlans().find((p) => p.id !== selfId && overlaps(p.startDate, p.endDate, startDate, endDate))
    if (clash) {
      throw new UserError(
        `Overlaps the ${clash.kind} plan from ${clash.startDate}${clash.endDate ? ` to ${clash.endDate}` : ''}. Set an end date on it first.`,
        'conflict',
      )
    }
    return { kind, monthlyCents, startDate, endDate, note: cleanText(input.note, 2000) }
  }

  // ---------- Shared ----------

  /** Resolves an id or id prefix (≥ 6 chars) in one of the finance tables. */
  resolve(table: 'agreements' | 'payments' | 'expenses' | 'ai_plans', ref: string): string {
    const value = ref.trim().toLowerCase()
    if (value.length < 6) throw new UserError('Use at least 6 characters of the id')
    // Plain prefix comparison: no LIKE wildcards from user input.
    const rows = this.db
      .prepare(`SELECT id FROM ${table} WHERE deleted_at IS NULL AND substr(id, 1, ?) = ?`)
      .all(value.length, value) as { id: string }[]
    if (rows.length === 1) return rows[0].id
    if (rows.length > 1) throw new UserError(`"${ref}" matches ${rows.length} records; use more characters`, 'conflict')
    throw new UserError(`Not found: ${ref}`, 'not_found')
  }

  private requireProject(id: string | undefined | null): string {
    if (!id || !this.db.prepare('SELECT 1 FROM projects WHERE id = ? AND deleted_at IS NULL').get(id)) {
      throw new UserError(`Project not found: ${id ?? ''}`, 'not_found')
    }
    return id
  }

  private softDelete(table: 'agreements' | 'payments' | 'expenses' | 'ai_plans', id: string): void {
    const ts = now()
    this.db.prepare(`UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE id = ?`).run(ts, ts, id)
  }
}

const str = (v: unknown) => (v === null || v === undefined ? null : String(v))

function toAgreement(r: Row): Agreement {
  return {
    id: String(r.id),
    projectId: String(r.project_id),
    projectName: String(r.project_name),
    kind: r.kind as AgreementKind,
    amountCents: Number(r.amount_cents),
    interval: (r.interval as Interval | null) ?? null,
    startDate: String(r.start_date),
    endDate: str(r.end_date),
    note: String(r.note),
    createdAt: String(r.created_at),
  }
}

function toPayment(r: Row): Payment {
  return {
    id: String(r.id),
    projectId: String(r.project_id),
    projectName: String(r.project_name),
    clientName: str(r.client_name),
    agreementId: str(r.agreement_id),
    statementId: str(r.statement_id),
    date: String(r.date),
    amountCents: Number(r.amount_cents),
    note: String(r.note),
    createdAt: String(r.created_at),
  }
}

function toExpense(r: Row): Expense {
  return {
    id: String(r.id),
    projectId: str(r.project_id),
    projectName: str(r.project_name),
    amountCents: Number(r.amount_cents),
    interval: (r.interval as Interval | null) ?? null,
    startDate: String(r.start_date),
    endDate: str(r.end_date),
    note: String(r.note),
    createdAt: String(r.created_at),
  }
}

function toAiPlan(r: Row): AiPlan {
  return {
    id: String(r.id),
    kind: r.kind as AiPlanKind,
    monthlyCents: r.monthly_cents === null ? null : Number(r.monthly_cents),
    startDate: String(r.start_date),
    endDate: str(r.end_date),
    note: String(r.note),
    createdAt: String(r.created_at),
  }
}
