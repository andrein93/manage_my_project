// Plain types shared by the server and the dashboard (no runtime imports here).

export const AGREEMENT_KINDS = ['hourly', 'fixed', 'recurring'] as const
export type AgreementKind = (typeof AGREEMENT_KINDS)[number]
export const INTERVALS = ['month', 'year'] as const
export type Interval = (typeof INTERVALS)[number]
export const AI_PLAN_KINDS = ['api', 'subscription'] as const
export type AiPlanKind = (typeof AI_PLAN_KINDS)[number]

export interface Agreement {
  id: string
  projectId: string
  projectName: string
  kind: AgreementKind
  /** Hourly rate for `hourly`, otherwise the amount. */
  amountCents: number
  interval: Interval | null
  startDate: string
  endDate: string | null
  note: string
  createdAt: string
}

export interface Payment {
  id: string
  projectId: string
  projectName: string
  clientName: string | null
  agreementId: string | null
  /** Set when the payment was recorded by marking a statement paid. */
  statementId: string | null
  date: string
  amountCents: number
  note: string
  createdAt: string
}

export interface Expense {
  id: string
  /** null = shared across projects. */
  projectId: string | null
  projectName: string | null
  amountCents: number
  interval: Interval | null
  startDate: string
  endDate: string | null
  note: string
  createdAt: string
}

export interface AiPlan {
  id: string
  kind: AiPlanKind
  monthlyCents: number | null
  startDate: string
  endDate: string | null
  note: string
  createdAt: string
}

/** Your details printed on statements, and how statements are numbered. */
export interface Billing {
  name: string
  address: string
  taxId: string
  iban: string
  footer: string
  numberPrefix: string
  /** Default VAT percent shown on new statements (display only: mmp amounts are net). */
  vatRate: number
  dueDays: number
}

export const STATEMENT_STATUSES = ['draft', 'issued', 'paid', 'void'] as const
export type StatementStatus = (typeof STATEMENT_STATUSES)[number]

export interface StatementLine {
  id: string
  position: number
  projectId: string
  projectName: string
  /** The agreement the line was prefilled from; null for lines typed by hand. */
  agreementId: string | null
  description: string
  quantity: number
  unitCents: number
  amountCents: number
}

export interface StatementLineInput {
  projectId: string
  description: string
  quantity: number
  unitCents: number
  /** Defaults to round(quantity × unitCents). */
  amountCents?: number
}

export interface BillingParty {
  name: string
  address: string
  taxId: string
}

/** Billing details frozen when the statement is issued. */
export interface StatementSnapshot {
  issuer: BillingParty & { iban: string; footer: string }
  client: BillingParty
}

export interface Statement {
  id: string
  clientId: string
  clientName: string
  status: StatementStatus
  number: string | null
  periodFrom: string
  periodTo: string
  issueDate: string | null
  dueDate: string | null
  paidDate: string | null
  /** VAT percent shown on the document (amounts are net). */
  vatRate: number
  language: string
  notes: string
  snapshot: StatementSnapshot | null
  lines: StatementLine[]
  subtotalCents: number
  vatCents: number
  totalCents: number
  currency: string
  /** Issued, unpaid and past its due date. */
  overdue: boolean
  createdAt: string
  updatedAt: string
}

/** What one agreement earned in a range (unrounded cents), with the details statements need. */
export interface AgreementEarning {
  agreementId: string
  projectId: string
  cents: number
  /** Minutes billed by an hourly agreement; 0 for other kinds. */
  minutes: number
  /** Recurring fee dates in the range; 0 for other kinds. */
  occurrences: number
}

export interface FinanceNumbers {
  minutes: number
  earnedCents: number
  collectedCents: number
  aiCents: number
  expenseCents: number
  costCents: number
  marginCents: number
  /** Margin per hour worked, null without hours. */
  effectiveRateCents: number | null
}

export interface FinanceRow extends FinanceNumbers {
  /** Project or client id, or 'none'. */
  key: string
  label: string
}

export interface FinanceReport {
  range: { from: string; to: string }
  lifetime: boolean
  by: 'project' | 'client'
  currency: string
  /** Totals include overhead (costs not attributable to a project) when unfiltered. */
  totals: FinanceNumbers & { overheadCents: number }
  rows: FinanceRow[]
}

export interface OwedRow {
  /** Client id or 'none' for projects without a client. */
  clientId: string
  clientName: string
  projects: { id: string; name: string; earnedCents: number; collectedCents: number; owedCents: number }[]
  earnedCents: number
  collectedCents: number
  /** Positive: the client owes you. Negative: prepaid credit. */
  owedCents: number
}
