import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { App } from '../core/app.js'
import { localToday } from '../core/dates.js'
import { resolveCategoryFilter, resolveClientFilter } from '../core/filters.js'
import { formatMinutes } from '../core/time/duration.js'
import { PERIODS, rangeFrom } from '../core/time/periods.js'
import { GROUP_BY, type GroupBy } from '../core/time/repository.js'
import { tool } from './tool.js'

export function registerTimeTools(server: McpServer, app: App): void {
  server.registerTool(
    'time_report',
    {
      title: 'Time report',
      description:
        'Hours worked and AI cost (USD, API-equivalent) for a period, grouped by project, client, category or day. ' +
        'Time is estimated automatically from Claude Code sessions and git commits, plus manual entries. ' +
        'Use period, or from/to (YYYY-MM-DD, inclusive). Defaults to this week.',
      inputSchema: {
        period: z.enum(PERIODS).optional(),
        from: z.string().optional().describe('YYYY-MM-DD'),
        to: z.string().optional().describe('YYYY-MM-DD'),
        by: z.enum(GROUP_BY).optional(),
        project: z.string().optional().describe('Project id, path or name'),
        client: z.string().optional().describe('Client name/id, or "none"'),
        category: z.string().optional().describe('Category name/id, or "none"'),
      },
    },
    tool(
      async (a: {
        period?: string
        from?: string
        to?: string
        by?: GroupBy
        project?: string
        client?: string
        category?: string
      }) => {
        await app.time.sync()
        const range = rangeFrom(a, localToday(), app.settings.get().weekStart)
        const report = app.time.repo.report(range, a.by ?? 'project', {
          projectId: a.project ? app.projects.resolve(a.project).id : undefined,
          clientId: resolveClientFilter(app, a.client),
          categoryId: resolveCategoryFilter(app, a.category),
        })
        // Human-readable durations help the model answer without arithmetic.
        return {
          ...report,
          totals: { ...report.totals, formatted: formatMinutes(report.totals.minutes) },
          rows: report.rows.map((r) => ({ ...r, formatted: formatMinutes(r.minutes) })),
          days: a.by === 'day' ? undefined : report.days.filter((d) => d.minutes > 0 || d.costUsd > 0),
        }
      },
    ),
  )

  server.registerTool(
    'log_time',
    {
      title: 'Log time',
      description: 'Add a manual time entry (e.g. a call or meeting) to a project.',
      inputSchema: {
        project: z.string().describe('Project id, path or name'),
        duration: z.string().describe('e.g. 45m, 1h30m, 1.5h, or minutes as a number string'),
        date: z.string().optional().describe('YYYY-MM-DD, defaults to today'),
        note: z.string().optional(),
      },
    },
    tool((a: { project: string; duration: string; date?: string; note?: string }) =>
      app.time.repo.addEntry({ projectId: app.projects.resolve(a.project).id, minutes: a.duration, date: a.date, note: a.note }),
    ),
  )

  server.registerTool(
    'sync_time',
    {
      title: 'Sync time',
      description: 'Import new activity from Claude Code transcripts and git commits now.',
      inputSchema: {},
    },
    tool(() => app.time.sync()),
  )
}
