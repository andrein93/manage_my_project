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
