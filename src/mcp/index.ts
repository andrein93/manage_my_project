import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import type { App } from '../core/app.js'
import { PROJECT_STATUSES, UserError } from '../core/types.js'
import { VERSION } from '../version.js'

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean }

/** Wraps a handler: JSON result as text content, user errors as `isError` results. */
function tool<A>(handler: (args: A) => unknown | Promise<unknown>) {
  return async (args: A): Promise<ToolResult> => {
    try {
      const result = await handler(args)
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    } catch (error) {
      if (error instanceof UserError) return { content: [{ type: 'text', text: error.message }], isError: true }
      throw error
    }
  }
}

const ref = z.string().describe('Project id, absolute path or name')

export function createMcpServer(app: App): McpServer {
  const server = new McpServer(
    { name: 'mmp', version: VERSION },
    {
      instructions:
        'mmp is the user\'s registry of local software projects. Use get_current_project with your working ' +
        'directory to learn which project you are in. Project refs accept an id, an absolute path or a name.',
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
        query: z.string().optional().describe('Search name, description, path and tags'),
        all: z.boolean().optional(),
      },
    },
    tool((a: { status?: (typeof PROJECT_STATUSES)[number][]; stack?: string; tag?: string; inactive_days?: number; query?: string; all?: boolean }) =>
      app.projects.list({ status: a.status, stack: a.stack, tag: a.tag, inactiveDays: a.inactive_days, query: a.query, all: a.all }),
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
      description: 'Change the name, description or status of a project.',
      inputSchema: {
        ref,
        name: z.string().optional(),
        description: z.string().optional(),
        status: z.enum(PROJECT_STATUSES).optional(),
      },
    },
    tool((a: { ref: string; name?: string; description?: string; status?: (typeof PROJECT_STATUSES)[number] }) =>
      app.projects.update(app.projects.resolve(a.ref).id, { name: a.name, description: a.description, status: a.status }),
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

  return server
}

export async function startMcpServer(app: App): Promise<void> {
  await createMcpServer(app).connect(new StdioServerTransport())
}
