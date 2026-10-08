import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { App } from '../core/app.js'
import { digest, digestMarkdown, overview, upcoming } from '../core/overview.js'

export function registerExtrasRoutes(api: FastifyInstance, app: App): void {
  api.get('/overview', async () => overview(app))

  api.get('/digest', async (request) => {
    const { week } = z.object({ week: z.enum(['this', 'last']).optional() }).parse(request.query)
    const d = digest(app, week ?? 'this')
    return { ...d, markdown: digestMarkdown(d) }
  })

  api.get('/health', async () =>
    app.projects.list({ attention: true }).map((p) => ({ id: p.id, name: p.name, path: p.path, flags: p.health })),
  )

  api.get('/upcoming', async (request) => {
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(366).optional() }).parse(request.query)
    return upcoming(app, days ?? 30)
  })
}
