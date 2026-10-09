import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { App } from '../core/app.js'
import { digest, digestMarkdown, overview, upcoming } from '../core/overview.js'
import { notify, type Send } from './notify.js'

export function registerExtrasRoutes(api: FastifyInstance, app: App, notifier: Send = notify): void {
  // Reminders and notifications
  const reminderKey = z.object({ key: z.string().min(1).max(500) }).strict()
  api.get('/reminders', async () => app.reminders.list(app.today()))
  api.post('/reminders/dismiss', async (request, reply) => {
    app.reminders.dismiss(reminderKey.parse(request.body).key)
    return reply.code(204).send()
  })
  api.post('/reminders/snooze', async (request, reply) => {
    app.reminders.snooze(reminderKey.parse(request.body).key, app.today())
    return reply.code(204).send()
  })
  api.post('/notifications/test', async () => ({
    sent: await notifier('mmp', 'Desktop notifications work. You will see reminders here.', `http://localhost:${app.config.port}/`),
  }))

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
