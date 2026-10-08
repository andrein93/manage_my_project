import type { Command } from 'commander'
import type { App } from '../core/app.js'
import { formatCents } from '../core/finance/money.js'
import { digest, digestMarkdown, upcoming } from '../core/overview.js'
import type { HealthFlag } from '../core/types.js'
import { formatTable } from './format.js'

type Out = (line: string) => void

export function describeFlag(f: HealthFlag): string {
  switch (f.kind) {
    case 'missing':
      return 'folder missing'
    case 'no_git':
      return 'not under git'
    case 'no_remote':
      return 'no remote (no backup)'
    case 'unpushed':
      return `${f.count} unpushed commit(s)`
    case 'uncommitted':
      return 'uncommitted changes'
    case 'dormant':
      return 'active but untouched for 90+ days'
  }
}

export function registerExtrasCommands(program: Command, getApp: () => App, out: Out): void {
  program
    .command('digest')
    .description('weekly summary: time, AI cost, money, tasks, health and upcoming charges')
    .option('--last', 'last week instead of this week so far')
    .option('--no-sync', 'skip importing new activity first')
    .option('--json', 'print JSON')
    .action(async (o: { last?: boolean; sync: boolean; json?: boolean }) => {
      const app = getApp()
      if (o.sync) await app.time.sync()
      const d = digest(app, o.last ? 'last' : 'this')
      out(o.json ? JSON.stringify(d, null, 2) : digestMarkdown(d).trimEnd())
    })

  program
    .command('health')
    .description('active or paused projects that need attention (no backup, unpushed work, dormant…)')
    .option('--json', 'print JSON')
    .action((o: { json?: boolean }) => {
      const projects = getApp().projects.list({ attention: true })
      if (o.json) return out(JSON.stringify(projects.map((p) => ({ name: p.name, path: p.path, flags: p.health })), null, 2))
      if (!projects.length) return out('All good: nothing needs attention.')
      out(formatTable(['PROJECT', 'ATTENTION', 'PATH'], projects.map((p) => [p.name, p.health.map(describeFlag).join(', '), p.path])))
    })

  program
    .command('upcoming')
    .description('recurring costs to pay and fees to invoice in the coming days')
    .option('--days <n>', 'how far ahead (default 30)', (v) => Number(v))
    .action((o: { days?: number }) => {
      const app = getApp()
      const items = upcoming(app, o.days && o.days > 0 ? Math.min(o.days, 366) : 30)
      if (!items.length) return out('Nothing coming up.')
      const currency = app.settings.get().currency
      out(
        formatTable(
          ['DATE', 'WHAT', 'AMOUNT', 'FOR', 'PROJECT'],
          items.map((i) => [i.date, i.direction === 'pay' ? 'to pay' : 'to invoice', formatCents(i.amountCents, currency), i.label || (i.direction === 'pay' ? 'Expense' : 'Recurring fee'), i.projectName ?? 'shared']),
        ),
      )
    })
}
