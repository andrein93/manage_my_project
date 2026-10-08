import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { App } from '../core/app.js'
import { localToday } from '../core/dates.js'
import { rangeFrom } from '../core/time/periods.js'
import { UserError } from '../core/types.js'

export function registerSyncRoutes(api: FastifyInstance, app: App): void {
  api.get('/sync/status', async () => app.sync.status())
  api.post('/sync/login', async (request) => {
    const { url, token } = z.object({ url: z.string().min(1).max(500), token: z.string().min(1).max(500) }).strict().parse(request.body)
    await app.sync.login(url, token)
    await app.sync.run()
    return app.sync.status()
  })
  api.post('/sync/run', async () => app.sync.run())
  api.post('/sync/logout', async () => app.sync.logout())
  api.get('/members', async () => app.sync.members())

  api.get('/projects/:id/team-time', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params)
    if (!app.projects.get(id)) throw new UserError(`Project not found: ${id}`, 'not_found')
    const q = z.object({ period: z.string().optional(), from: z.string().optional(), to: z.string().optional() }).parse(request.query)
    const range = rangeFrom({ period: q.period ?? 'month', from: q.from, to: q.to }, localToday(), app.settings.get().weekStart)
    return { range, members: app.sync.teamTime(id, range.from, range.to) }
  })
}
