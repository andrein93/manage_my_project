import { Option, type Command } from 'commander'
import type { App } from '../core/app.js'
import { localToday } from '../core/dates.js'
import { resolveCategoryFilter, resolveClientFilter } from '../core/filters.js'
import { formatMinutes } from '../core/time/duration.js'
import { PERIODS, rangeFrom } from '../core/time/periods.js'
import { GROUP_BY, type GroupBy } from '../core/time/repository.js'
import { formatTable } from './format.js'

type Out = (line: string) => void

const usd = (n: number) => `$${n.toFixed(2)}`
const time = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })

interface RangeOptions {
  period?: string
  from?: string
  to?: string
}

const withRange = (cmd: Command, defaultPeriod: string) =>
  cmd
    .addOption(new Option('--period <period>', `default: ${defaultPeriod}`).choices([...PERIODS]))
    .option('--from <date>', 'YYYY-MM-DD (inclusive)')
    .option('--to <date>', 'YYYY-MM-DD (inclusive)')

export function registerTimeCommands(program: Command, getApp: () => App, out: Out): void {
  const timeCmd = program.command('time').description('time spent and AI cost per project')
  const range = (app: App, o: RangeOptions, fallback: string) =>
    rangeFrom({ period: o.period ?? (o.from ? undefined : fallback), from: o.from, to: o.to }, localToday(), app.settings.get().weekStart)

  timeCmd
    .command('sync')
    .description('import new activity from Claude Code transcripts and git now')
    .option('--json', 'print JSON')
    .action(async (opts: { json?: boolean }) => {
      const r = await getApp().time.sync()
      if (opts.json) return out(JSON.stringify(r, null, 2))
      if (!r.claudeDirFound) out('Claude Code transcripts folder not found (see Settings → Time).')
      out(`Synced in ${r.durationMs} ms: ${r.filesRead} transcript(s) read, ${r.signals} new activity minute(s), ${r.commits} commit(s)`)
      for (const e of r.errors) out(`  ! ${e.source}: ${e.message}`)
    })

  withRange(
    timeCmd
      .command('report')
      .description('hours and AI cost for a period')
      .addOption(new Option('--by <group>', 'default: project').choices([...GROUP_BY]))
      .option('--project <ref>')
      .option('--client <ref>', 'client name or id, or "none"')
      .option('--category <ref>', 'category name or id, or "none"')
      .option('--no-sync', 'skip importing new activity first')
      .option('--json', 'print JSON'),
    'week',
  ).action(
    async (
      opts: RangeOptions & { by?: GroupBy; project?: string; client?: string; category?: string; sync: boolean; json?: boolean },
    ) => {
      const app = getApp()
      if (opts.sync) await app.time.sync()
      const r = range(app, opts, 'week')
      const report = app.time.repo.report(r, opts.by ?? 'project', {
        projectId: opts.project ? app.projects.resolve(opts.project).id : undefined,
        clientId: resolveClientFilter(app, opts.client),
        categoryId: resolveCategoryFilter(app, opts.category),
      })
      if (opts.json) return out(JSON.stringify(report, null, 2))
      out(`${r.from} → ${r.to}: ${formatMinutes(report.totals.minutes)} (manual ${formatMinutes(report.totals.manualMinutes)}), AI ${usd(report.totals.costUsd)}`)
      const rows = report.rows.filter((row) => row.minutes > 0 || row.costUsd > 0)
      if (rows.length) {
        out('')
        out(
          formatTable(
            [(opts.by ?? 'project').toUpperCase(), 'TIME', 'SHARE', 'AI COST'],
            rows.map((row) => [row.label, formatMinutes(row.minutes), `${Math.round(row.share * 100)}%`, usd(row.costUsd)]),
          ),
        )
      }
      if (report.unassigned.length) {
        out('\nNot a project (register with `mmp add <path>`):')
        out(formatTable(['FOLDER', 'TIME', 'AI COST'], report.unassigned.map((u) => [u.cwd, formatMinutes(u.minutes), usd(u.costUsd)])))
      }
    },
  )

  withRange(
    timeCmd
      .command('blocks')
      .description('work blocks and manual entries of a project')
      .requiredOption('-p, --project <ref>', 'project id, path or name'),
    'week',
  ).action((opts: RangeOptions & { project: string }) => {
    const app = getApp()
    const project = app.projects.resolve(opts.project)
    const r = range(app, opts, 'week')
    const blocks = app.time.repo.blocks(project.id, r)
    const entries = app.time.repo.entries(r, project.id)
    if (!blocks.length && !entries.length) return out(`No time recorded for ${project.name} between ${r.from} and ${r.to}.`)
    if (blocks.length) {
      out(formatTable(['START', 'END', 'TIME', 'SOURCE'], blocks.map((b) => [time(b.start), time(b.end), formatMinutes(b.minutes), b.sources.join('+')])))
    }
    if (entries.length) {
      out('\nManual entries:')
      out(formatTable(['ID', 'DATE', 'TIME', 'NOTE'], entries.map((e) => [e.id.slice(0, 8), e.date, formatMinutes(e.minutes), e.note || '-'])))
    }
  })

  timeCmd
    .command('add <project> <duration>')
    .description('log time manually, e.g. mmp time add shop 1h30m --note "Call"')
    .option('--date <date>', 'YYYY-MM-DD, default today')
    .option('--note <text>')
    .action((projectRef: string, duration: string, opts: { date?: string; note?: string }) => {
      const app = getApp()
      const entry = app.time.repo.addEntry({ projectId: app.projects.resolve(projectRef).id, minutes: duration, ...opts })
      out(`Logged ${formatMinutes(entry.minutes)} on ${entry.projectName} (${entry.date}) [${entry.id.slice(0, 8)}]`)
    })

  timeCmd
    .command('remove <id>')
    .description('delete a manual time entry')
    .action((ref: string) => {
      const app = getApp()
      const entry = app.time.repo.removeEntry(app.time.repo.resolveEntry(ref).id)
      out(`Removed ${formatMinutes(entry.minutes)} on ${entry.projectName} (${entry.date})`)
    })
}
