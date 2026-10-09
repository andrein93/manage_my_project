import type { FastifyInstance } from 'fastify'
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { App } from '../core/app.js'
import { PROJECT_STATUSES, UserError } from '../core/types.js'
import { majorOf } from '../core/detect/versions.js'
import { readBuildInfo } from '../build-info.js'
import { VERSION } from '../version.js'
import { vscodeUrl, type Opener } from './open.js'

const listQuery = z.object({
  status: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',').filter(Boolean) : undefined))
    .pipe(z.array(z.enum(PROJECT_STATUSES)).optional()),
  stack: z.string().optional(),
  tag: z.string().optional(),
  inactive: z.coerce.number().int().min(0).optional(),
  q: z.string().optional(),
  client: z.string().optional(),
  category: z.string().optional(),
  attention: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  version: z.string().optional(),
  all: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => v === 'true' || v === '1'),
})

const projectPatch = z
  .object({
    name: z.string().max(200).optional(),
    description: z.string().max(5000).optional(),
    status: z.enum(PROJECT_STATUSES).optional(),
    tags: z.array(z.string().max(50)).max(50).optional(),
    clientId: z.string().nullable().optional(),
    categoryId: z.string().nullable().optional(),
    shared: z.boolean().optional(),
  })
  .strict()

const tagsBody = z.object({ tags: z.array(z.string().max(50)).max(50) })
const pathBody = z.object({ path: z.string().min(1) })
const openBody = z.object({ target: z.enum(['folder', 'vscode']) })
const settingsBody = z
  .object({
    ignoreNames: z.array(z.string().max(255)).max(500).optional(),
    idleMinutes: z.number().int().optional(),
    claudeProjectsDir: z.string().max(1000).optional(),
    weekStart: z.enum(['monday', 'sunday']).optional(),
    currency: z.string().max(3).optional(),
    usdRate: z.number().optional(),
    notifications: z.object({ desktop: z.boolean() }).strict().optional(),
    billing: z
      .object({
        name: z.string(),
        address: z.string(),
        taxId: z.string(),
        iban: z.string(),
        footer: z.string(),
        numberPrefix: z.string(),
        vatRate: z.number(),
        dueDays: z.number(),
      })
      .partial()
      .strict()
      .optional(),
  })
  .strict()
const idParams = z.object({ id: z.string().min(1) })

export function registerRoutes(api: FastifyInstance, app: App, opener: Opener): void {
  // The build this server started with; the dashboard compares it to notice a restart on a new build.
  const build = readBuildInfo(app.config.installDir)?.id ?? null
  const getProject = (id: string) => {
    const project = app.projects.get(id)
    if (!project) throw new UserError(`Project not found: ${id}`, 'not_found')
    return project
  }

  api.get('/projects', async (request) => {
    const q = listQuery.parse(request.query)
    return app.projects.list({
      status: q.status,
      stack: q.stack,
      tag: q.tag,
      inactiveDays: q.inactive,
      query: q.q,
      client: q.client,
      category: q.category,
      attention: q.attention,
      version: q.version,
      all: q.all,
    })
  })

  api.post('/projects', async (request, reply) => {
    const project = await app.addProject(pathBody.parse(request.body).path)
    return reply.code(201).send(project)
  })

  api.get('/projects/:id', async (request) => getProject(idParams.parse(request.params).id))

  api.patch('/projects/:id', async (request) => {
    const { id } = idParams.parse(request.params)
    // Validate the whole body before writing anything.
    const { tags, ...patch } = projectPatch.parse(request.body)
    const project = app.projects.update(getProject(id).id, patch)
    return tags ? app.projects.setTags(project.id, tags) : project
  })

  api.put('/projects/:id/tags', async (request) => {
    const { id } = idParams.parse(request.params)
    return app.projects.setTags(getProject(id).id, tagsBody.parse(request.body).tags)
  })

  api.post('/projects/:id/open', async (request, reply) => {
    const project = getProject(idParams.parse(request.params).id)
    if (!project.local) throw new UserError('This team project has no folder on this computer')
    if (project.missingSince || !isDirectory(project.path)) throw new UserError('The project folder is missing')
    const { target } = openBody.parse(request.body)
    if (target === 'folder') opener.folder(project.path)
    else opener.url(vscodeUrl(project.path))
    return reply.code(204).send()
  })

  api.post('/scan', async () => app.scan())

  api.get('/workspaces', async () => app.workspaces.list())

  api.post('/workspaces', async (request, reply) => {
    const workspace = app.workspaces.add(pathBody.parse(request.body).path)
    const scan = await app.scan()
    return reply.code(201).send({ workspace, scan })
  })

  api.delete('/workspaces/:id', async (request, reply) => {
    app.workspaces.remove(idParams.parse(request.params).id)
    return reply.code(204).send()
  })

  api.get('/settings', async () => app.settings.get())

  api.put('/settings', async (request) => app.settings.update(settingsBody.parse(request.body)))

  api.get('/meta', async () => {
    const all = app.projects.list({ all: true })
    return {
      version: VERSION,
      build,
      mcpCommand: `claude mcp add --scope user mmp -- node "${join(app.config.installDir, 'bin', 'mmp.js').replace(/\\/g, '/')}" mcp`,
      statuses: PROJECT_STATUSES,
      stacks: [...new Set(all.flatMap((p) => p.stack))].sort(),
      tags: app.projects.allTags(),
      clients: app.clients.list().map(({ id, name }) => ({ id, name })),
      // "framework@major" values present across projects, for the version filter.
      versions: [
        ...new Set(
          all.flatMap((p) =>
            Object.entries(p.versions)
              .map(([k, v]) => [k, majorOf(v)] as const)
              .filter(([, major]) => major !== null)
              .map(([k, major]) => `${k}@${major}`),
          ),
        ),
      ].sort(
        (a, b) => a.localeCompare(b, undefined, { numeric: true }),
      ),
      attention: all.filter((p) => p.health.length > 0).length,
      categories: app.categories.list().map(({ id, name, color }) => ({ id, name, color })),
      counts: Object.fromEntries(PROJECT_STATUSES.map((s) => [s, all.filter((p) => p.status === s).length])),
    }
  })
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}
