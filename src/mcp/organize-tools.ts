import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { App } from '../core/app.js'
import { resolveCategoryFilter, resolveClientFilter } from '../core/filters.js'
import { TASK_PRIORITIES, TASK_STATUSES, type TaskPriority, type TaskStatus } from '../core/types.js'
import { tool } from './tool.js'

const dueDate = z.string().describe('YYYY-MM-DD')

export function registerOrganizeTools(server: McpServer, app: App): void {
  server.registerTool(
    'list_clients',
    { title: 'List clients', description: 'All clients with their project and open-task counts.', inputSchema: {} },
    tool(() => app.clients.list()),
  )

  server.registerTool(
    'create_client',
    {
      title: 'Create client',
      description: 'Create a client. Then assign it to projects with update_project.',
      inputSchema: { name: z.string(), email: z.string().optional(), notes: z.string().optional() },
    },
    tool((a: { name: string; email?: string; notes?: string }) => app.clients.create(a)),
  )

  server.registerTool(
    'update_client',
    {
      title: 'Update client',
      description: 'Rename a client or change its email or notes.',
      inputSchema: {
        ref: z.string().describe('Client id, id prefix or name'),
        name: z.string().optional(),
        email: z.string().optional(),
        notes: z.string().optional(),
      },
    },
    tool((a: { ref: string; name?: string; email?: string; notes?: string }) =>
      app.clients.update(app.clients.resolve(a.ref).id, { name: a.name, email: a.email, notes: a.notes }),
    ),
  )

  server.registerTool(
    'list_categories',
    { title: 'List categories', description: 'Project categories defined by the user.', inputSchema: {} },
    tool(() => app.categories.list()),
  )

  server.registerTool(
    'list_tasks',
    {
      title: 'List tasks',
      description:
        'List tasks, sorted by due date then priority. Defaults to open tasks (todo, in_progress) of ' +
        'non-archived projects. due: overdue = before today; today = due today or earlier; week = within 7 days or earlier.',
      inputSchema: {
        project: z.string().optional().describe('Project id, path or name'),
        client: z.string().optional().describe('Client name/id, or "none"'),
        category: z.string().optional().describe('Category name/id, or "none"'),
        status: z.array(z.enum(TASK_STATUSES)).optional(),
        priority: z.array(z.enum(TASK_PRIORITIES)).optional(),
        due: z.enum(['overdue', 'today', 'week']).optional(),
        all: z.boolean().optional().describe('Include tasks of archived and ignored projects'),
      },
    },
    tool(
      (a: {
        project?: string
        client?: string
        category?: string
        status?: TaskStatus[]
        priority?: TaskPriority[]
        due?: 'overdue' | 'today' | 'week'
        all?: boolean
      }) =>
        app.tasks.list({
          projectId: a.project ? app.projects.resolve(a.project).id : undefined,
          clientId: resolveClientFilter(app, a.client),
          categoryId: resolveCategoryFilter(app, a.category),
          status: a.status,
          priority: a.priority,
          due: a.due,
          all: a.all,
        }),
    ),
  )

  server.registerTool(
    'create_tasks',
    {
      title: 'Create tasks',
      description: 'Create one or more tasks in a project (all or nothing).',
      inputSchema: {
        project: z.string().describe('Project id, path or name'),
        tasks: z
          .array(
            z.object({
              title: z.string(),
              description: z.string().optional(),
              priority: z.enum(TASK_PRIORITIES).optional(),
              due_date: dueDate.optional(),
            }),
          )
          .min(1),
      },
    },
    tool(
      (a: {
        project: string
        tasks: { title: string; description?: string; priority?: TaskPriority; due_date?: string }[]
      }) =>
        app.tasks.create(
          app.projects.resolve(a.project).id,
          a.tasks.map((t) => ({ title: t.title, description: t.description, priority: t.priority, dueDate: t.due_date })),
        ),
    ),
  )

  server.registerTool(
    'update_task',
    {
      title: 'Update task',
      description: 'Edit a task. Set status to "done" to complete it. Pass due_date null to clear it.',
      inputSchema: {
        ref: z.string().describe('Task id or id prefix (≥ 6 characters)'),
        title: z.string().optional(),
        description: z.string().optional(),
        status: z.enum(TASK_STATUSES).optional(),
        priority: z.enum(TASK_PRIORITIES).optional(),
        due_date: dueDate.nullable().optional(),
      },
    },
    tool(
      (a: {
        ref: string
        title?: string
        description?: string
        status?: TaskStatus
        priority?: TaskPriority
        due_date?: string | null
      }) =>
        app.tasks.update(app.tasks.resolve(a.ref).id, {
          title: a.title,
          description: a.description,
          status: a.status,
          priority: a.priority,
          dueDate: a.due_date,
        }),
    ),
  )

  server.registerTool(
    'delete_task',
    {
      title: 'Delete task',
      description: 'Delete a task.',
      inputSchema: { ref: z.string().describe('Task id or id prefix (≥ 6 characters)') },
    },
    tool((a: { ref: string }) => app.tasks.remove(app.tasks.resolve(a.ref).id)),
  )
}
