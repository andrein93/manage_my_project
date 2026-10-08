import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import type { App } from '../core/app.js'
import { PROJECT_STATUSES, type ProjectStatus } from '../core/types.js'
import { VERSION } from '../version.js'
import { resolveCategoryFilter, resolveCategoryPatch, resolveClientFilter, resolveClientPatch } from '../core/filters.js'
import { registerOrganizeTools } from './organize-tools.js'
import { registerTimeTools } from './time-tools.js'
import { tool } from './tool.js'

const ref = z.string().describe('Project id, absolute path or name')

export function createMcpServer(app: App): McpServer {
  const server = new McpServer(
    { name: 'mmp', version: VERSION },
    {
      instructions:
        "mmp is the user's registry of local software projects, with clients, categories and tasks. " +
        'Use get_current_project with your working directory to learn which project you are in before ' +
        'creating or listing tasks for "this project". Project refs accept an id, an absolute path or a name; ' +
        'client, category and task refs accept an id, an id prefix or a name.',
    },
  )

  server.registerTool(
    'list_projects',
    {
      title: 'List projects',
      description:
        'List registered projects. Archived and ignored projects are hidden unless `all` is true or `status` is given.',
      inputSchema: {
        status: z.array(z.enum(PROJECT_STATUSES)).optional(),
        stack: z.string().optional().describe('e.g. laravel, vue, wordpress, python'),
        tag: z.string().optional(),
        inactive_days: z.number().int().min(0).optional().describe('Only projects with no activity in the last N days'),
        query: z.string().optional().describe('Search name, description, path, tags, client and category'),
        client: z.string().optional().describe('Client name/id, or "none" for projects without a client'),
        category: z.string().optional().describe('Category name/id, or "none"'),
        all: z.boolean().optional(),
      },
    },
    tool(
      (a: {
        status?: ProjectStatus[]
        stack?: string
        tag?: string
        inactive_days?: number
        query?: string
        client?: string
        category?: string
        all?: boolean
      }) =>
        app.projects.list({
          status: a.status,
          stack: a.stack,
          tag: a.tag,
          inactiveDays: a.inactive_days,
          query: a.query,
          client: resolveClientFilter(app, a.client),
          category: resolveCategoryFilter(app, a.category),
          all: a.all,
        }),
    ),
  )

  server.registerTool(
    'get_project',
    { title: 'Get project', description: 'Full details of one project.', inputSchema: { ref } },
    tool((a: { ref: string }) => app.projects.resolve(a.ref)),
  )

  server.registerTool(
    'get_current_project',
    {
      title: 'Get current project',
      description: 'Return the registered project that contains the given path (e.g. your working directory), or null.',
      inputSchema: { path: z.string().describe('Absolute path') },
    },
    tool((a: { path: string }) => app.projects.findContaining(a.path)),
  )

  server.registerTool(
    'scan_projects',
    {
      title: 'Scan projects',
      description: 'Rescan all workspaces: discover new folders and refresh stack, git and activity info.',
      inputSchema: {},
    },
    tool(() => app.scan()),
  )

  server.registerTool(
    'add_project',
    {
      title: 'Add project',
      description: 'Register a single folder as a project (for folders outside the scanned workspaces).',
      inputSchema: { path: z.string().describe('Absolute path of the project folder') },
    },
    tool((a: { path: string }) => app.addProject(a.path)),
  )

  server.registerTool(
    'add_workspace',
    {
      title: 'Add workspace',
      description: 'Add a folder whose direct subfolders are all projects, then scan it.',
      inputSchema: { path: z.string().describe('Absolute path of the folder containing projects') },
    },
    tool(async (a: { path: string }) => {
      const workspace = app.workspaces.add(a.path)
      return { workspace, scan: await app.scan() }
    }),
  )

  server.registerTool(
    'update_project',
    {
      title: 'Update project',
      description:
        'Change the name, description, status, client or category of a project. Pass null for client/category to clear it.',
      inputSchema: {
        ref,
        name: z.string().optional(),
        description: z.string().optional(),
        status: z.enum(PROJECT_STATUSES).optional(),
        client: z.string().nullable().optional().describe('Existing client name/id (create it first with create_client)'),
        category: z.string().nullable().optional().describe('Existing category name/id'),
      },
    },
    tool(
      (a: {
        ref: string
        name?: string
        description?: string
        status?: ProjectStatus
        client?: string | null
        category?: string | null
      }) =>
        app.projects.update(app.projects.resolve(a.ref).id, {
          name: a.name,
          description: a.description,
          status: a.status,
          clientId: resolveClientPatch(app, a.client),
          categoryId: resolveCategoryPatch(app, a.category),
        }),
    ),
  )

  server.registerTool(
    'tag_project',
    {
      title: 'Tag project',
      description: 'Add and/or remove tags on a project.',
      inputSchema: { ref, add: z.array(z.string()).optional(), remove: z.array(z.string()).optional() },
    },
    tool((a: { ref: string; add?: string[]; remove?: string[] }) =>
      app.projects.editTags(app.projects.resolve(a.ref).id, a.add, a.remove),
    ),
  )

  registerOrganizeTools(server, app)
  registerTimeTools(server, app)
  return server
}

export async function startMcpServer(app: App): Promise<void> {
  await createMcpServer(app).connect(new StdioServerTransport())
}
