import { Option, type Command } from 'commander'
import type { App } from '../core/app.js'
import { localToday } from '../core/dates.js'
import { resolveClientFilter } from '../core/filters.js'
import { formatCents } from '../core/finance/money.js'
import { INTERVALS, type AgreementKind, type Interval } from '../core/finance/types.js'
import { UserError } from '../core/types.js'
import { formatMinutes } from '../core/time/duration.js'
import { PERIODS, rangeFrom } from '../core/time/periods.js'
import { formatTable } from './format.js'

type Out = (line: string) => void
const short = (id: string) => id.slice(0, 8)

export function registerFinanceCommands(program: Command, getApp: () => App, out: Out): void {
  const money = (app: App) => {
    const currency = app.settings.get().currency
    return (cents: number | null) => (cents === null ? '-' : formatCents(cents, currency))
  }

  // ---------- finance ----------
  const finance = program.command('finance').description('earnings, costs, margin and effective hourly rate')
  finance
    .command('report')
    .description('profitability per project or client (default: this month)')
    .addOption(new Option('--period <period>').choices([...PERIODS]))
    .option('--from <date>', 'YYYY-MM-DD (inclusive)')
    .option('--to <date>', 'YYYY-MM-DD (inclusive)')
    .option('--lifetime', 'from the first record until today')
    .addOption(new Option('--by <group>', 'default: project').choices(['project', 'client']))
    .option('--project <ref>')
    .option('--client <ref>', 'client name or id, or "none"')
    .option('--no-sync', 'skip importing new activity first')
    .option('--json', 'print JSON')
    .action(
      async (o: {
        period?: string
        from?: string
        to?: string
        lifetime?: boolean
        by?: 'project' | 'client'
        project?: string
        client?: string
        sync: boolean
        json?: boolean
      }) => {
        const app = getApp()
        if (o.sync) await app.time.sync()
        const range = o.lifetime
          ? undefined
          : rangeFrom({ period: o.period ?? (o.from ? undefined : 'month'), from: o.from, to: o.to }, localToday(), app.settings.get().weekStart)
        const report = app.finance.report({ range, lifetime: o.lifetime }, o.by ?? 'project', {
          projectId: o.project ? app.projects.resolve(o.project).id : undefined,
          clientId: resolveClientFilter(app, o.client),
        })
        if (o.json) return out(JSON.stringify(report, null, 2))
        const m = money(app)
        const t = report.totals
        out(`${report.range.from} → ${report.range.to}${report.lifetime ? ' (lifetime)' : ''}`)
        out(
          `Earned ${m(t.earnedCents)}, collected ${m(t.collectedCents)}, costs ${m(t.costCents)}, margin ${m(t.marginCents)}` +
            (t.effectiveRateCents === null ? '' : ` (${m(t.effectiveRateCents)}/h over ${formatMinutes(t.minutes)})`),
        )
        if (t.overheadCents) out(`(costs include ${m(t.overheadCents)} not attributable to a project)`)
        if (!report.rows.length) return out('\nNo money recorded in this period. Add agreements with `mmp deal add`.')
        out('')
        out(
          formatTable(
            [(o.by ?? 'project').toUpperCase(), 'HOURS', 'EARNED', 'COSTS', 'MARGIN', 'PER HOUR'],
            report.rows.map((r) => [
              r.label,
              formatMinutes(r.minutes),
              m(r.earnedCents),
              m(r.costCents),
              m(r.marginCents),
              r.effectiveRateCents === null ? '-' : m(r.effectiveRateCents),
            ]),
          ),
        )
      },
    )
  finance
    .command('owed')
    .description('who still owes you money (lifetime earned minus collected)')
    .option('--no-sync', 'skip importing new activity first')
    .option('--json', 'print JSON')
    .action(async (o: { json?: boolean; sync: boolean }) => {
      const app = getApp()
      if (o.sync) await app.time.sync()
      const rows = app.finance.owed()
      if (o.json) return out(JSON.stringify(rows, null, 2))
      if (!rows.length) return out('Nobody owes you anything.')
      const m = money(app)
      out(formatTable(['CLIENT', 'EARNED', 'COLLECTED', 'OWED'], rows.map((r) => [r.clientName, m(r.earnedCents), m(r.collectedCents), m(r.owedCents)])))
      out('\nNegative amounts are prepaid credit.')
    })

  // ---------- deal ----------
  const deal = program.command('deal').description('pricing agreements: hourly rates, fixed prices, recurring fees')
  deal
    .command('add <project>')
    .description('add an agreement, e.g. mmp deal add shop --fixed 3000 --from 2026-09-01 --to 2026-11-30')
    .option('--hourly <rate>', 'hourly rate')
    .option('--fixed <amount>', 'fixed price, spread between --from and --to')
    .option('--recurring <amount>', 'fee charged every --every period')
    .addOption(new Option('--every <interval>', 'for --recurring (default month)').choices([...INTERVALS]))
    .option('--from <date>', 'start date, default today')
    .option('--to <date>', 'end date (optional)')
    .option('--note <text>')
    .action((projectRef: string, o: { hourly?: string; fixed?: string; recurring?: string; every?: Interval; from?: string; to?: string; note?: string }) => {
      const app = getApp()
      const kinds = (['hourly', 'fixed', 'recurring'] as AgreementKind[]).filter((k) => o[k] !== undefined)
      if (kinds.length !== 1) throw new UserError('Use exactly one of --hourly, --fixed or --recurring')
      const kind = kinds[0]
      const a = app.finance.repo.addAgreement({
        projectId: app.projects.resolve(projectRef).id,
        kind,
        amount: o[kind],
        interval: kind === 'recurring' ? (o.every ?? 'month') : undefined,
        startDate: o.from,
        endDate: o.to,
        note: o.note,
      })
      out(`Agreement added [${short(a.id)}]: ${describeAgreement(a, money(app))}`)
    })
  deal
    .command('list')
    .description('list agreements')
    .option('--project <ref>')
    .action((o: { project?: string }) => {
      const app = getApp()
      const list = app.finance.repo.agreements(o.project ? app.projects.resolve(o.project).id : undefined)
      if (!list.length) return out('No agreements yet.')
      const m = money(app)
      out(formatTable(['ID', 'PROJECT', 'TERMS', 'FROM', 'TO', 'NOTE'], list.map((a) => [short(a.id), a.projectName, describeAgreement(a, m), a.startDate, a.endDate ?? '-', a.note || '-'])))
    })
  deal
    .command('end <id>')
    .description('set the end date of an agreement (default today)')
    .option('--date <date>')
    .action((ref: string, o: { date?: string }) => {
      const app = getApp()
      const a = app.finance.repo.updateAgreement(app.finance.repo.resolve('agreements', ref), { endDate: o.date ?? localToday() })
      out(`Agreement ends on ${a.endDate}`)
    })
  deal
    .command('remove <id>')
    .description('delete an agreement')
    .action((ref: string) => {
      const app = getApp()
      const a = app.finance.repo.removeAgreement(app.finance.repo.resolve('agreements', ref))
      out(`Agreement removed (${a.projectName})`)
    })

  // ---------- payment ----------
  const payment = program.command('payment').description('money received')
  payment
    .command('add <project> <amount>')
    .description('record a payment, e.g. mmp payment add shop 1500 --note "Deposit"')
    .option('--date <date>', 'default today')
    .option('--deal <id>', 'agreement this payment belongs to')
    .option('--note <text>')
    .action((projectRef: string, amount: string, o: { date?: string; deal?: string; note?: string }) => {
      const app = getApp()
      const p = app.finance.repo.addPayment({
        projectId: app.projects.resolve(projectRef).id,
        amount,
        date: o.date,
        agreementId: o.deal ? app.finance.repo.resolve('agreements', o.deal) : undefined,
        note: o.note,
      })
      out(`Payment recorded [${short(p.id)}]: ${money(app)(p.amountCents)} on ${p.date} (${p.projectName})`)
    })
  payment
    .command('list')
    .description('list payments')
    .option('--project <ref>')
    .option('--client <ref>')
    .action((o: { project?: string; client?: string }) => {
      const app = getApp()
      const list = app.finance.repo.payments({
        projectId: o.project ? app.projects.resolve(o.project).id : undefined,
        clientId: o.client ? app.clients.resolve(o.client).id : undefined,
      })
      if (!list.length) return out('No payments yet.')
      const m = money(app)
      out(formatTable(['ID', 'DATE', 'PROJECT', 'CLIENT', 'AMOUNT', 'NOTE'], list.map((p) => [short(p.id), p.date, p.projectName, p.clientName ?? '-', m(p.amountCents), p.note || '-'])))
    })
  payment
    .command('remove <id>')
    .description('delete a payment')
    .action((ref: string) => {
      const app = getApp()
      const p = app.finance.repo.removePayment(app.finance.repo.resolve('payments', ref))
      out(`Payment removed: ${money(app)(p.amountCents)} on ${p.date}`)
    })

  // ---------- expense ----------
  const expense = program.command('expense').description('costs: per project or shared across projects')
  expense
    .command('add <amount>')
    .description('record a cost, e.g. mmp expense add 20 --every month --note "VPS"')
    .requiredOption('--note <text>', 'what it is')
    .option('--project <ref>', 'charge to one project (omit for a shared cost split by hours)')
    .addOption(new Option('--every <interval>', 'recurring cost').choices([...INTERVALS]))
    .option('--from <date>', 'date of the cost (first charge if recurring), default today')
    .option('--to <date>', 'last charge (recurring only)')
    .action((amount: string, o: { note: string; project?: string; every?: Interval; from?: string; to?: string }) => {
      const app = getApp()
      const e = app.finance.repo.addExpense({
        projectId: o.project ? app.projects.resolve(o.project).id : null,
        amount,
        interval: o.every,
        startDate: o.from,
        endDate: o.to,
        note: o.note,
      })
      out(`Expense added [${short(e.id)}]: ${money(app)(e.amountCents)}${e.interval ? ` every ${e.interval}` : ''} (${e.projectName ?? 'shared'})`)
    })
  expense
    .command('list')
    .description('list expenses')
    .option('--project <ref>')
    .option('--shared', 'only shared expenses')
    .action((o: { project?: string; shared?: boolean }) => {
      const app = getApp()
      const list = app.finance.repo.expenses({ projectId: o.project ? app.projects.resolve(o.project).id : undefined, shared: o.shared || undefined })
      if (!list.length) return out('No expenses yet.')
      const m = money(app)
      out(
        formatTable(
          ['ID', 'PROJECT', 'AMOUNT', 'EVERY', 'FROM', 'TO', 'NOTE'],
          list.map((e) => [short(e.id), e.projectName ?? 'shared', m(e.amountCents), e.interval ?? 'once', e.startDate, e.endDate ?? '-', e.note || '-']),
        ),
      )
    })
  expense
    .command('remove <id>')
    .description('delete an expense')
    .action((ref: string) => {
      const app = getApp()
      const e = app.finance.repo.removeExpense(app.finance.repo.resolve('expenses', ref))
      out(`Expense removed: ${e.note || money(app)(e.amountCents)}`)
    })

  // ---------- ai-plan ----------
  const plan = program.command('ai-plan').description('how you pay for Claude: pay-as-you-go or a monthly subscription')
  plan
    .command('add')
    .description('add a plan period, e.g. mmp ai-plan add --subscription 90 --from 2026-05-01')
    .option('--subscription <monthly>', 'monthly fee in your currency')
    .option('--api', 'pay-as-you-go: use the cost reported by Claude Code')
    .option('--from <date>', 'default today')
    .option('--to <date>')
    .option('--note <text>')
    .action((o: { subscription?: string; api?: boolean; from?: string; to?: string; note?: string }) => {
      const app = getApp()
      if (!!o.subscription === !!o.api) throw new UserError('Use either --subscription <monthly> or --api')
      const p = app.finance.repo.addAiPlan({
        kind: o.api ? 'api' : 'subscription',
        monthlyAmount: o.subscription,
        startDate: o.from,
        endDate: o.to,
        note: o.note,
      })
      out(`AI plan added [${short(p.id)}]: ${p.kind === 'api' ? 'pay-as-you-go' : `${money(app)(p.monthlyCents)}/month`} from ${p.startDate}`)
    })
  plan
    .command('list')
    .description('list AI plan periods')
    .action(() => {
      const app = getApp()
      const list = app.finance.repo.aiPlans()
      if (!list.length) return out('No AI plan set: costs reported by Claude Code are used as they are.')
      const m = money(app)
      out(formatTable(['ID', 'PLAN', 'FROM', 'TO', 'NOTE'], list.map((p) => [short(p.id), p.kind === 'api' ? 'pay-as-you-go' : `${m(p.monthlyCents)}/month`, p.startDate, p.endDate ?? '-', p.note || '-'])))
    })
  plan
    .command('end <id>')
    .description('set the end date of a plan (default today)')
    .option('--date <date>')
    .action((ref: string, o: { date?: string }) => {
      const app = getApp()
      const p = app.finance.repo.updateAiPlan(app.finance.repo.resolve('ai_plans', ref), { endDate: o.date ?? localToday() })
      out(`AI plan ends on ${p.endDate}`)
    })
  plan
    .command('remove <id>')
    .description('delete an AI plan period')
    .action((ref: string) => {
      const app = getApp()
      app.finance.repo.removeAiPlan(app.finance.repo.resolve('ai_plans', ref))
      out('AI plan removed')
    })
}

function describeAgreement(a: { kind: AgreementKind; amountCents: number; interval: Interval | null }, m: (c: number) => string): string {
  if (a.kind === 'hourly') return `${m(a.amountCents)}/hour`
  if (a.kind === 'fixed') return `fixed ${m(a.amountCents)}`
  return `${m(a.amountCents)} every ${a.interval}`
}
