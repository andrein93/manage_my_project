import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { App } from '../core/app.js'
import { PROJECT_STATUSES, UserError } from '../core/types.js'
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
  })
  .strict()

const tagsBody = z.object({ tags: z.array(z.string().max(50)).max(50) })
const pathBody = z.object({ path: z.string().min(1) })
const openBody = z.object({ target: z.enum(['folder', 'vscode']) })
const settingsBody = z.object({ ignoreNames: z.array(z.string().max(255)).max(500).optional() }).strict()
const idParams = z.object({ id: z.string().min(1) })

export function registerRoutes(api: FastifyInstance, app: App, opener: Opener): void {
  const getProject = (id: string) => {
    const project = app.projects.get(id)
    if (!project) throw new UserError(`Project not found: ${id}`, 'not_found')
    return project
  }

  api.get('/projects', async (request) => {
    const q = listQuery.parse(request.query)
    return app.projects.list({ status: q.status, stack: q.stack, tag: q.tag, inactiveDays: q.inactive, query: q.q, all: q.all })
  })

  api.post('/projects', async (request, reply) => {
    const project = await app.addProject(pathBody.parse(request.body).path)
    return reply.code(201).send(project)
  })

  api.get('/projects/:id', async (request) => getProject(idParams.parse(request.params).id))

  api.patch('/projects/:id', async (request) => {
    const { id } = idParams.parse(request.params)
    return app.projects.update(getProject(id).id, projectPatch.parse(request.body))
  })

  api.put('/projects/:id/tags', async (request) => {
    const { id } = idParams.parse(request.params)
    return app.projects.setTags(getProject(id).id, tagsBody.parse(request.body).tags)
  })

  api.post('/projects/:id/open', async (request, reply) => {
    const project = getProject(idParams.parse(request.params).id)
    if (project.missingSince) throw new UserError('The project folder is missing')
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
      statuses: PROJECT_STATUSES,
      stacks: [...new Set(all.flatMap((p) => p.stack))].sort(),
      tags: app.projects.allTags(),
      counts: Object.fromEntries(PROJECT_STATUSES.map((s) => [s, all.filter((p) => p.status === s).length])),
    }
  })
}
