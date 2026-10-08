import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { App } from '../core/app.js'
import { localToday } from '../core/dates.js'
import { resolveClientFilter } from '../core/filters.js'
import { formatCents } from '../core/finance/money.js'
import { AGREEMENT_KINDS, INTERVALS, type AgreementKind, type FinanceNumbers, type Interval } from '../core/finance/types.js'
import { formatMinutes } from '../core/time/duration.js'
import { PERIODS, rangeFrom } from '../core/time/periods.js'
import { tool } from './tool.js'

const amount = z.string().describe('Amount in the base currency, e.g. "1500" or "1.500,50" (net of VAT)')
const day = z.string().describe('YYYY-MM-DD')

/** Adds human-readable money and hours so the model does not do arithmetic on cents. */
function readable(n: FinanceNumbers, currency: string) {
  const m = (c: number) => formatCents(c, currency)
  return {
    hours: formatMinutes(n.minutes),
    earned: m(n.earnedCents),
    collected: m(n.collectedCents),
    costs: m(n.costCents),
    margin: m(n.marginCents),
    effectiveHourlyRate: n.effectiveRateCents === null ? null : `${m(n.effectiveRateCents)}/h`,
  }
}

export function registerFinanceTools(server: McpServer, app: App): void {
  server.registerTool(
    'finance_report',
    {
      title: 'Finance report',
      description:
        'Earned (accrued from agreements), collected (payments), costs (AI + expenses), margin and effective hourly rate ' +
        'per project or client. Use period, from/to (YYYY-MM-DD) or lifetime. Amounts are net of VAT in the base currency.',
      inputSchema: {
        period: z.enum(PERIODS).optional(),
        from: day.optional(),
        to: day.optional(),
        lifetime: z.boolean().optional(),
        by: z.enum(['project', 'client']).optional(),
        project: z.string().optional().describe('Project id, path or name'),
        client: z.string().optional().describe('Client name/id, or "none"'),
      },
    },
    tool(
      async (a: { period?: string; from?: string; to?: string; lifetime?: boolean; by?: 'project' | 'client'; project?: string; client?: string }) => {
        await app.time.freshen()
        const range = a.lifetime ? undefined : rangeFrom({ period: a.period ?? 'month', from: a.from, to: a.to }, localToday(), app.settings.get().weekStart)
        const report = app.finance.report({ range, lifetime: a.lifetime }, a.by ?? 'project', {
          projectId: a.project ? app.projects.resolve(a.project).id : undefined,
          clientId: resolveClientFilter(app, a.client),
        })
        return {
          range: report.range,
          currency: report.currency,
          totals: { ...readable(report.totals, report.currency), overhead: formatCents(report.totals.overheadCents, report.currency) },
          rows: report.rows.map((r) => ({ name: r.label, ...readable(r, report.currency) })),
        }
      },
    ),
  )

  server.registerTool(
    'owed_report',
    {
      title: 'Who owes me',
      description: 'Lifetime earned minus collected per client (positive = owed to the user, negative = prepaid credit).',
      inputSchema: {},
    },
    tool(async () => {
      await app.time.freshen()
      const currency = app.settings.get().currency
      return app.finance.owed().map((r) => ({
        client: r.clientName,
        owed: formatCents(r.owedCents, currency),
        projects: r.projects.map((p) => ({ name: p.name, owed: formatCents(p.owedCents, currency) })),
      }))
    }),
  )

  server.registerTool(
    'list_agreements',
    {
      title: 'List agreements',
      description: 'Pricing agreements (hourly rates, fixed prices, recurring fees), optionally for one project.',
      inputSchema: { project: z.string().optional().describe('Project id, path or name') },
    },
    tool((a: { project?: string }) => app.finance.repo.agreements(a.project ? app.projects.resolve(a.project).id : undefined)),
  )

  server.registerTool(
    'add_agreement',
    {
      title: 'Add agreement',
      description:
        'Record how a project is paid: hourly (amount = rate per hour), fixed (total price, spread between start and end date) ' +
        'or recurring (fee every month or year).',
      inputSchema: {
        project: z.string().describe('Project id, path or name'),
        kind: z.enum(AGREEMENT_KINDS),
        amount,
        interval: z.enum(INTERVALS).optional().describe('Recurring only, default month'),
        start_date: day.optional().describe('Defaults to today'),
        end_date: day.optional(),
        note: z.string().optional(),
      },
    },
    tool((a: { project: string; kind: AgreementKind; amount: string; interval?: Interval; start_date?: string; end_date?: string; note?: string }) =>
      app.finance.repo.addAgreement({
        projectId: app.projects.resolve(a.project).id,
        kind: a.kind,
        amount: a.amount,
        interval: a.interval,
        startDate: a.start_date,
        endDate: a.end_date,
        note: a.note,
      }),
    ),
  )

  server.registerTool(
    'record_payment',
    {
      title: 'Record payment',
      description: 'Record money received for a project (net of VAT).',
      inputSchema: {
        project: z.string().describe('Project id, path or name'),
        amount,
        date: day.optional().describe('Defaults to today'),
        note: z.string().optional(),
      },
    },
    tool((a: { project: string; amount: string; date?: string; note?: string }) =>
      app.finance.repo.addPayment({ projectId: app.projects.resolve(a.project).id, amount: a.amount, date: a.date, note: a.note }),
    ),
  )

  server.registerTool(
    'add_expense',
    {
      title: 'Add expense',
      description:
        'Record a cost. With a project it is charged to that project; without one it is shared and split by hours worked. ' +
        'Set interval for recurring costs (e.g. hosting every month).',
      inputSchema: {
        amount,
        note: z.string().describe('What it is, e.g. "VPS" or "Domain example.com"'),
        project: z.string().optional().describe('Project id, path or name; omit for a shared cost'),
        interval: z.enum(INTERVALS).optional(),
        start_date: day.optional().describe('Date of the cost, or first charge if recurring; defaults to today'),
        end_date: day.optional().describe('Recurring only'),
      },
    },
    tool((a: { amount: string; note: string; project?: string; interval?: Interval; start_date?: string; end_date?: string }) =>
      app.finance.repo.addExpense({
        projectId: a.project ? app.projects.resolve(a.project).id : null,
        amount: a.amount,
        interval: a.interval,
        startDate: a.start_date,
        endDate: a.end_date,
        note: a.note,
      }),
    ),
  )
}
