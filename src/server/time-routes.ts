import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { App } from '../core/app.js'
import { localToday } from '../core/dates.js'
import { completedTaskCount } from '../core/overview.js'
import { rangeFrom } from '../core/time/periods.js'
import { GROUP_BY } from '../core/time/repository.js'

const idParams = z.object({ id: z.string().min(1) })
const rangeQuery = {
  period: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
}
const reportQuery = z.object({
  ...rangeQuery,
  by: z.enum(GROUP_BY).optional(),
  project: z.string().optional(),
  client: z.string().optional(),
  category: z.string().optional(),
})
const blocksQuery = z.object({ ...rangeQuery, project: z.string().min(1) })
const entriesQuery = z.object({ ...rangeQuery, project: z.string().optional() })
const entryBody = z
  .object({
    projectId: z.string().min(1).optional(),
    date: z.string().optional(),
    minutes: z.union([z.number(), z.string()]).optional(),
    note: z.string().max(2000).optional(),
  })
  .strict()

export function registerTimeRoutes(api: FastifyInstance, app: App): void {
  const range = (q: { period?: string; from?: string; to?: string }) =>
    rangeFrom(q, localToday(), app.settings.get().weekStart)

  // Editor heartbeats (VS Code extension): { path, at? (ISO) }.
  api.post('/time/heartbeat', async (request, reply) => {
    const body = z.object({ path: z.string().min(1).max(1000), at: z.string().datetime().optional() }).strict().parse(request.body)
    app.time.recordEditor(body.path, body.at ? Date.parse(body.at) : Date.now())
    return reply.code(204).send()
  })

  api.get('/time/report', async (request) => {
    const q = reportQuery.parse(request.query)
    const r = range(q)
    const filters = { projectId: q.project, clientId: q.client, categoryId: q.category }
    return { ...app.time.repo.report(r, q.by ?? 'project', filters), tasksCompleted: completedTaskCount(app, r, filters) }
  })

  api.get('/time/blocks', async (request) => {
    const q = blocksQuery.parse(request.query)
    const r = range({ period: q.period, from: q.from, to: q.to })
    return { blocks: app.time.repo.blocks(q.project, r), entries: app.time.repo.entries(r, q.project) }
  })

  api.get('/time/entries', async (request) => {
    const q = entriesQuery.parse(request.query)
    return app.time.repo.entries(range(q), q.project)
  })

  api.get('/time/status', async () => app.time.status())
  api.post('/time/sync', async () => app.time.sync())

  api.post('/time/entries', async (request, reply) =>
    reply.code(201).send(app.time.repo.addEntry(entryBody.parse(request.body))),
  )
  api.patch('/time/entries/:id', async (request) =>
    app.time.repo.updateEntry(idParams.parse(request.params).id, entryBody.parse(request.body)),
  )
  api.delete('/time/entries/:id', async (request, reply) => {
    app.time.repo.removeEntry(idParams.parse(request.params).id)
    return reply.code(204).send()
  })
}
