import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { App } from '../core/app.js'
import { digest, digestMarkdown, upcoming } from '../core/overview.js'
import { tool } from './tool.js'

export function registerExtrasTools(server: McpServer, app: App): void {
  server.registerTool(
    'weekly_digest',
    {
      title: 'Weekly digest',
      description:
        'A summary of the week: time worked, AI cost, money earned and collected, tasks done and overdue, ' +
        'projects needing attention and upcoming charges. Returns Markdown ready to show the user.',
      inputSchema: { week: z.enum(['this', 'last']).optional().describe('Default: this week so far') },
    },
    tool(async (a: { week?: 'this' | 'last' }) => {
      await app.time.freshen()
      return digestMarkdown(digest(app, a.week ?? 'this'))
    }),
  )

  server.registerTool(
    'project_health',
    {
      title: 'Project health',
      description:
        'Active or paused projects that need attention: folder missing, not under git, no remote (no backup), ' +
        'unpushed commits, uncommitted changes, or untouched for 90+ days. Also lists detected framework versions.',
      inputSchema: {},
    },
    tool(() =>
      app.projects.list({ attention: true }).map((p) => ({ name: p.name, path: p.path, flags: p.health, versions: p.versions })),
    ),
  )

  server.registerTool(
    'upcoming_charges',
    {
      title: 'Upcoming charges',
      description: 'Recurring costs to pay (domains, hosting) and recurring fees to invoice in the next N days.',
      inputSchema: { days: z.number().int().min(1).max(366).optional().describe('Default 30') },
    },
    tool((a: { days?: number }) => upcoming(app, a.days ?? 30)),
  )
}
