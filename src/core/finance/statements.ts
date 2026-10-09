import type { ClientRepository } from '../clients.js'
import { addDays, cleanDate, localToday } from '../dates.js'
import { localUserId, transaction, type DB } from '../db.js'
import { newId, now } from '../ids.js'
import type { ProjectRepository } from '../projects.js'
import type { SettingsRepository } from '../settings.js'
import { UserError } from '../types.js'
import type { FinanceService } from './report.js'
import type { FinanceRepository } from './repository.js'
import {
  STATEMENT_STATUSES,
  type Agreement,
  type Statement,
  type StatementLine,
  type StatementLineInput,
  type StatementSnapshot,
  type StatementStatus,
} from './types.js'

type Row = Record<string, unknown>

/** The few words mmp writes into prefilled lines, per statement language (English fallback). */
const WORDS: Record<string, { fixed: string; recurring: string; share: string; month: string; year: string; hours: string }> = {
  en: { fixed: 'Fixed price', recurring: 'Recurring fee', share: 'share for the period', month: 'month', year: 'year', hours: 'h' },
  it: { fixed: 'Prezzo fisso', recurring: 'Canone', share: 'quota del periodo', month: 'mese', year: 'anno', hours: 'h' },
  es: { fixed: 'Precio fijo', recurring: 'Cuota', share: 'parte del periodo', month: 'mes', year: 'año', hours: 'h' },
  de: { fixed: 'Festpreis', recurring: 'Wiederkehrende Gebühr', share: 'Anteil für den Zeitraum', month: 'Monat', year: 'Jahr', hours: 'Std.' },
  fr: { fixed: 'Prix forfaitaire', recurring: 'Abonnement', share: 'part de la période', month: 'mois', year: 'an', hours: 'h' },
  zh: { fixed: '固定价格', recurring: '定期费用', share: '本期份额', month: '月', year: '年', hours: '小时' },
}
const words = (language: string) => WORDS[language.split('-')[0]] ?? WORDS.en

const KIND_ORDER: Record<Agreement['kind'], number> = { hourly: 0, fixed: 1, recurring: 2 }
const MAX_LINES = 200

/**
 * Pro-forma statements: drafts prefilled from what was earned, issued with a per-year number,
 * marked paid by recording payments. They have no fiscal value.
 */
export class StatementRepository {
  constructor(
    private readonly db: DB,
    private readonly finance: FinanceService,
    private readonly settings: SettingsRepository,
    private readonly clients: ClientRepository,
    private readonly projects: ProjectRepository,
    private readonly today: () => string = () => localToday(),
  ) {}

  /** The app's "today" (tests pin it), for default periods in the CLI and MCP. */
  currentDay(): string {
    return this.today()
  }

  private get financeRepo(): FinanceRepository {
    return this.finance.repo
  }

  list(filter: { clientId?: string; status?: StatementStatus } = {}): Statement[] {
    const rows = this.db
      .prepare('SELECT * FROM statements WHERE deleted_at IS NULL ORDER BY COALESCE(issue_date, created_at) DESC, created_at DESC')
      .all() as Row[]
    return rows
      .filter((r) => (!filter.clientId || r.client_id === filter.clientId) && (!filter.status || r.status === filter.status))
      .map((r) => this.toStatement(r))
  }

  get(id: string): Statement {
    const row = this.db.prepare('SELECT * FROM statements WHERE id = ? AND deleted_at IS NULL').get(id) as Row | undefined
    if (!row) throw new UserError(`Statement not found: ${id}`, 'not_found')
    return this.toStatement(row)
  }

  /** Statement number (case-insensitive) or id. */
  resolve(ref: string): string {
    const key = ref.trim()
    const row = this.db
      .prepare('SELECT id FROM statements WHERE deleted_at IS NULL AND (id = ? OR number = ? COLLATE NOCASE)')
      .get(key, key) as { id: string } | undefined
    if (!row) throw new UserError(`Statement not found: ${ref}`, 'not_found')
    return row.id
  }

  create(input: { clientId: string; from: string; to: string; language?: string }): Statement {
    const client = this.clients.get(input.clientId)
    if (!client) throw new UserError(`Client not found: ${input.clientId}`, 'not_found')
    const { from, to } = this.cleanPeriod(input.from, input.to)
    const id = newId()
    const ts = now()
    transaction(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO statements (id, owner_id, client_id, status, period_from, period_to, vat_rate, language, currency, created_at, updated_at)
           VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          localUserId(this.db),
          client.id,
          from,
          to,
          this.settings.get().billing.vatRate,
          cleanLanguage(input.language),
          this.settings.get().currency,
          ts,
          ts,
        )
      this.writeLines(id, this.prefill(client.id, from, to, cleanLanguage(input.language)))
    })
    return this.get(id)
  }

  update(id: string, input: { periodFrom?: string; periodTo?: string; vatRate?: number; language?: string; notes?: string; dueDate?: string | null }): Statement {
    const s = this.requireDraft(id)
    const { from, to } = this.cleanPeriod(input.periodFrom ?? s.periodFrom, input.periodTo ?? s.periodTo)
    const vatRate = input.vatRate ?? s.vatRate
    if (typeof vatRate !== 'number' || !(vatRate >= 0 && vatRate <= 100)) throw new UserError('vatRate must be a percentage between 0 and 100')
    const notes = input.notes === undefined ? s.notes : String(input.notes).trim()
    if (notes.length > 5000) throw new UserError('Notes are too long (max 5000 characters)')
    const dueDate = input.dueDate === undefined ? s.dueDate : input.dueDate ? cleanDate(input.dueDate) : null
    this.db
      .prepare('UPDATE statements SET period_from = ?, period_to = ?, vat_rate = ?, language = ?, notes = ?, due_date = ?, updated_at = ? WHERE id = ?')
      .run(from, to, vatRate, input.language === undefined ? s.language : cleanLanguage(input.language), notes, dueDate, now(), id)
    return this.get(id)
  }

  setLines(id: string, lines: StatementLineInput[]): Statement {
    const s = this.requireDraft(id)
    if (!Array.isArray(lines) || lines.length > MAX_LINES) throw new UserError(`A statement can have at most ${MAX_LINES} lines`)
    const clean = lines.map((l, i) => {
      this.requireClientProject(s.clientId, s.clientName, l.projectId, i + 1)
      const description = String(l.description ?? '').trim()
      if (!description || description.length > 500) throw new UserError(`Line ${i + 1}: the description must be 1–500 characters`)
      if (typeof l.quantity !== 'number' || !Number.isFinite(l.quantity) || l.quantity <= 0) throw new UserError(`Line ${i + 1}: quantity must be a positive number`)
      if (!Number.isInteger(l.unitCents)) throw new UserError(`Line ${i + 1}: the unit price must be in whole cents`)
      const amountCents = l.amountCents ?? Math.round(l.quantity * l.unitCents)
      if (!Number.isInteger(amountCents)) throw new UserError(`Line ${i + 1}: the amount must be in whole cents`)
      return { projectId: l.projectId, agreementId: null, description, quantity: l.quantity, unitCents: l.unitCents, amountCents }
    })
    transaction(this.db, () => {
      this.writeLines(id, clean)
      this.touch(id)
    })
    return this.get(id)
  }

  /** Replaces the lines with what was earned in the statement's period. */
  refill(id: string): Statement {
    const s = this.requireDraft(id)
    transaction(this.db, () => {
      this.writeLines(id, this.prefill(s.clientId, s.periodFrom, s.periodTo, s.language))
      this.touch(id)
    })
    return this.get(id)
  }

  issue(id: string, input: { issueDate?: string } = {}): Statement {
    const s = this.requireDraft(id)
    if (!s.lines.length) throw new UserError('A statement needs at least one line before it can be issued')
    if (s.subtotalCents === 0) throw new UserError('A statement with a zero total cannot be issued')
    s.lines.forEach((l, i) => this.requireClientProject(s.clientId, s.clientName, l.projectId, i + 1))
    // "Paid" records one payment per project, and payments cannot be negative.
    const perProject = new Map<string, { name: string; cents: number }>()
    for (const l of s.lines) {
      const p = perProject.get(l.projectId) ?? { name: l.projectName, cents: 0 }
      p.cents += l.amountCents
      perProject.set(l.projectId, p)
    }
    for (const p of perProject.values()) {
      if (p.cents < 0) throw new UserError(`The lines of ${p.name} add up to a negative amount: put discounts on the same project as the work they reduce`)
    }
    const issueDate = cleanDate(input.issueDate ?? this.today())
    const billing = this.settings.get().billing
    const client = this.clients.get(s.clientId)!
    const snapshot: StatementSnapshot = {
      issuer: { name: billing.name, address: billing.address, taxId: billing.taxId, iban: billing.iban, footer: billing.footer },
      client: { name: client.billingName || client.name, address: client.billingAddress, taxId: client.billingTaxId },
    }
    const year = Number(issueDate.slice(0, 4))
    transaction(this.db, () => {
      const max = this.db.prepare('SELECT MAX(seq) AS seq FROM statements WHERE year = ?').get(year) as { seq: number | null }
      const seq = (max.seq ?? 0) + 1
      const number = `${billing.numberPrefix}${year}-${String(seq).padStart(3, '0')}`
      const result = this.db
        .prepare(
          `UPDATE statements SET status = 'issued', number = ?, year = ?, seq = ?, issue_date = ?, due_date = ?, snapshot = ?, updated_at = ?
           WHERE id = ? AND status = 'draft'`,
        )
        .run(number, year, seq, issueDate, s.dueDate ?? addDays(issueDate, billing.dueDays), JSON.stringify(snapshot), now(), id)
      // Another process (dashboard vs AI) may have issued it meanwhile: never renumber.
      if (Number(result.changes) === 0) throw new UserError('This statement was issued meanwhile; reload it')
    })
    return this.get(id)
  }

  /** Records one net payment per project of the lines. Already paid: no-op. */
  markPaid(id: string, input: { date?: string } = {}): Statement {
    const s = this.get(id)
    if (s.status === 'paid') return s
    if (s.status !== 'issued') throw new UserError('Only an issued statement can be marked as paid')
    const date = cleanDate(input.date ?? this.today())
    const perProject = new Map<string, number>()
    for (const l of s.lines) perProject.set(l.projectId, (perProject.get(l.projectId) ?? 0) + l.amountCents)
    transaction(this.db, () => {
      const result = this.db.prepare("UPDATE statements SET status = 'paid', paid_date = ?, updated_at = ? WHERE id = ? AND status = 'issued'").run(date, now(), id)
      if (Number(result.changes) === 0) throw new UserError('This statement changed meanwhile; reload it')
      for (const [projectId, cents] of perProject) {
        if (cents === 0) continue
        this.financeRepo.addPayment({ projectId, amount: cents / 100, date, note: `Statement ${s.number}`, statementId: s.id })
      }
    })
    return this.get(id)
  }

  /** Removes the payments recorded by `markPaid` (whatever is left of them). */
  markUnpaid(id: string): Statement {
    const s = this.get(id)
    if (s.status !== 'paid') throw new UserError('Only a paid statement can be marked as unpaid')
    transaction(this.db, () => {
      const result = this.db.prepare("UPDATE statements SET status = 'issued', paid_date = NULL, updated_at = ? WHERE id = ? AND status = 'paid'").run(now(), id)
      if (Number(result.changes) === 0) throw new UserError('This statement changed meanwhile; reload it')
      for (const p of this.financeRepo.payments().filter((p) => p.statementId === id)) this.financeRepo.removePayment(p.id)
    })
    return this.get(id)
  }

  void(id: string): Statement {
    const s = this.get(id)
    if (s.status !== 'issued') throw new UserError('Only an issued, unpaid statement can be voided (delete drafts instead)')
    const result = this.db.prepare("UPDATE statements SET status = 'void', updated_at = ? WHERE id = ? AND status = 'issued'").run(now(), id)
    if (Number(result.changes) === 0) throw new UserError('This statement changed meanwhile; reload it')
    return this.get(id)
  }

  remove(id: string): void {
    this.requireDraft(id)
    const ts = now()
    transaction(this.db, () => {
      this.db.prepare('DELETE FROM statement_lines WHERE statement_id = ?').run(id)
      this.db.prepare('UPDATE statements SET deleted_at = ?, updated_at = ? WHERE id = ?').run(ts, ts, id)
    })
  }

  overdue(): Statement[] {
    return this.list({ status: 'issued' }).filter((s) => s.overdue)
  }

  // ---------- internals ----------

  private prefill(clientId: string, from: string, to: string, language: string) {
    const w = words(language)
    const agreements = new Map(this.financeRepo.agreements().map((a) => [a.id, a]))
    const lines = []
    for (const e of this.finance.earnedByAgreement({ from, to })) {
      const cents = Math.round(e.cents)
      const a = agreements.get(e.agreementId)
      const project = this.projects.get(e.projectId)
      if (!a || !project || project.client?.id !== clientId || cents === 0) continue
      if (a.kind === 'hourly') {
        const hours = Math.round((e.minutes / 60) * 100) / 100
        // Bill the hours shown (2 decimals) × rate, so the printed line adds up; it may differ from the
        // exact accrual in the finance report by a few cents.
        lines.push({ a, name: project.name, projectId: project.id, description: `${project.name} — ${hours} ${w.hours}`, quantity: hours, unitCents: a.amountCents, amountCents: Math.round(hours * a.amountCents) })
      } else if (a.kind === 'fixed') {
        lines.push({ a, name: project.name, projectId: project.id, description: `${project.name} — ${a.note || w.fixed} (${w.share})`, quantity: 1, unitCents: cents, amountCents: cents })
      } else {
        const label = `${e.occurrences} × ${a.interval === 'year' ? w.year : w.month}`
        lines.push({ a, name: project.name, projectId: project.id, description: `${project.name} — ${a.note || w.recurring} (${label})`, quantity: e.occurrences, unitCents: a.amountCents, amountCents: cents })
      }
    }
    lines.sort((x, y) => x.name.localeCompare(y.name) || KIND_ORDER[x.a.kind] - KIND_ORDER[y.a.kind] || x.a.startDate.localeCompare(y.a.startDate))
    return lines.map(({ a, projectId, description, quantity, unitCents, amountCents }) => ({ projectId, agreementId: a.id, description, quantity, unitCents, amountCents }))
  }

  private writeLines(id: string, lines: { projectId: string; agreementId: string | null; description: string; quantity: number; unitCents: number; amountCents: number }[]) {
    this.db.prepare('DELETE FROM statement_lines WHERE statement_id = ?').run(id)
    const insert = this.db.prepare(
      `INSERT INTO statement_lines (id, statement_id, position, project_id, agreement_id, description, quantity, unit_cents, amount_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    lines.forEach((l, i) => insert.run(newId(), id, i, l.projectId, l.agreementId, l.description, l.quantity, l.unitCents, l.amountCents))
  }

  private touch(id: string) {
    this.db.prepare('UPDATE statements SET updated_at = ? WHERE id = ?').run(now(), id)
  }

  private requireDraft(id: string): Statement {
    const s = this.get(id)
    if (s.status !== 'draft') throw new UserError(`Statement ${s.number ?? id} is ${s.status}: only drafts can be changed or deleted`)
    return s
  }

  private requireClientProject(clientId: string, clientName: string, projectId: string, line: number) {
    const project = this.projects.get(projectId)
    if (!project) throw new UserError(`Line ${line}: project not found`, 'not_found')
    if (project.client?.id !== clientId) throw new UserError(`Line ${line}: project ${project.name} does not belong to ${clientName} any more`)
  }

  private cleanPeriod(fromRaw: string, toRaw: string) {
    const from = cleanDate(fromRaw)
    const to = cleanDate(toRaw)
    if (to < from) throw new UserError('The period end cannot be before its start')
    return { from, to }
  }

  private toStatement(r: Row): Statement {
    const id = String(r.id)
    const lines = (this.db.prepare('SELECT * FROM statement_lines WHERE statement_id = ? ORDER BY position').all(id) as Row[]).map(
      (l): StatementLine => ({
        id: String(l.id),
        position: Number(l.position),
        projectId: String(l.project_id),
        projectName: this.projects.get(String(l.project_id))?.name ?? '(deleted project)',
        agreementId: l.agreement_id ? String(l.agreement_id) : null,
        description: String(l.description),
        quantity: Number(l.quantity),
        unitCents: Number(l.unit_cents),
        amountCents: Number(l.amount_cents),
      }),
    )
    const vatRate = Number(r.vat_rate)
    const subtotalCents = lines.reduce((s, l) => s + l.amountCents, 0)
    const vatCents = Math.round((subtotalCents * vatRate) / 100)
    const status = String(r.status) as StatementStatus
    const dueDate = r.due_date ? String(r.due_date) : null
    return {
      id,
      clientId: String(r.client_id),
      clientName: this.clients.get(String(r.client_id))?.name ?? '(deleted client)',
      status: STATEMENT_STATUSES.includes(status) ? status : 'draft',
      number: r.number ? String(r.number) : null,
      periodFrom: String(r.period_from),
      periodTo: String(r.period_to),
      issueDate: r.issue_date ? String(r.issue_date) : null,
      dueDate,
      paidDate: r.paid_date ? String(r.paid_date) : null,
      vatRate,
      language: String(r.language),
      notes: String(r.notes),
      snapshot: r.snapshot ? (JSON.parse(String(r.snapshot)) as StatementSnapshot) : null,
      lines,
      subtotalCents,
      vatCents,
      totalCents: subtotalCents + vatCents,
      currency: String(r.currency || '') || this.settings.get().currency,
      overdue: status === 'issued' && !!dueDate && dueDate < this.today(),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    }
  }
}

/** A locale code like "it" or "zh"; anything else falls back to English. */
function cleanLanguage(value: string | undefined): string {
  const code = String(value ?? 'en').trim()
  return /^[a-z]{2}(-[A-Z]{2})?$/.test(code) ? code : 'en'
}
