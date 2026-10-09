import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { App } from '../core/app.js'
import { TASK_PRIORITIES, TASK_STATUSES, UserError } from '../core/types.js'
import { FIELD_KINDS } from '../core/fields.js'

const idParams = z.object({ id: z.string().min(1) })

const clientBody = z
  .object({
    name: z.string().max(200).optional(),
    email: z.string().max(320).optional(),
    notes: z.string().max(20_000).optional(),
    billingName: z.string().max(2000).optional(),
    billingAddress: z.string().max(2000).optional(),
    billingTaxId: z.string().max(2000).optional(),
  })
  .strict()

const categoryBody = z
  .object({ name: z.string().max(80).optional(), color: z.string().optional(), position: z.number().finite().optional() })
  .strict()

const csv = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',').filter(Boolean) : undefined))
    .pipe(z.array(z.enum(values)).optional())

const taskQuery = z.object({
  project: z.string().optional(),
  client: z.string().optional(),
  category: z.string().optional(),
  status: csv(TASK_STATUSES),
  priority: csv(TASK_PRIORITIES),
  due: z.enum(['overdue', 'today', 'week']).optional(),
  all: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => v === 'true' || v === '1'),
})

const taskFields = {
  title: z.string().max(500),
  description: z.string().max(20_000).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueDate: z.string().nullable().optional(),
  position: z.number().finite().optional(),
  assigneeId: z.string().nullable().optional(),
}
const taskCreate = z.object({ projectId: z.string().min(1), ...taskFields }).strict()
const taskPatch = z.object({ ...taskFields, title: taskFields.title.optional() }).strict()

const fieldBody = z
  .object({ name: z.string().max(60).optional(), kind: z.enum(FIELD_KINDS).optional(), remindDays: z.number().int().nullable().optional() })
  .strict()
const fieldValuesBody = z.object({ values: z.record(z.string(), z.string().max(2000).nullable()) }).strict()

export function registerOrganizeRoutes(api: FastifyInstance, app: App): void {
  // Custom fields
  api.get('/fields', async () => app.fields.list())
  api.post('/fields', async (request, reply) => reply.code(201).send(app.fields.create(fieldBody.parse(request.body))))
  api.patch('/fields/:id', async (request) => app.fields.update(idParams.parse(request.params).id, fieldBody.omit({ kind: true }).parse(request.body)))
  api.post('/fields/:id/move', async (request) =>
    app.fields.move(idParams.parse(request.params).id, z.object({ direction: z.enum(['up', 'down']) }).parse(request.body).direction),
  )
  api.delete('/fields/:id', async (request, reply) => {
    app.fields.remove(idParams.parse(request.params).id)
    return reply.code(204).send()
  })
  api.get('/projects/:id/fields', async (request) => app.fields.values(idParams.parse(request.params).id))
  api.put('/projects/:id/fields', async (request) =>
    app.fields.setValues(idParams.parse(request.params).id, fieldValuesBody.parse(request.body).values),
  )

  // Clients
  api.get('/clients', async () => app.clients.list())
  api.post('/clients', async (request, reply) => reply.code(201).send(app.clients.create(clientBody.parse(request.body))))
  api.get('/clients/:id', async (request) => {
    const { id } = idParams.parse(request.params)
    const client = app.clients.get(id)
    if (!client) throw new UserError(`Client not found: ${id}`, 'not_found')
    return { ...client, projects: app.projects.list({ client: id, all: true }) }
  })
  api.patch('/clients/:id', async (request) =>
    app.clients.update(idParams.parse(request.params).id, clientBody.parse(request.body)),
  )
  api.delete('/clients/:id', async (request, reply) => {
    app.clients.remove(idParams.parse(request.params).id)
    return reply.code(204).send()
  })

  // Categories
  api.get('/categories', async () => app.categories.list())
  api.post('/categories', async (request, reply) =>
    reply.code(201).send(app.categories.create(categoryBody.parse(request.body))),
  )
  api.patch('/categories/:id', async (request) =>
    app.categories.update(idParams.parse(request.params).id, categoryBody.parse(request.body)),
  )
  api.post('/categories/:id/move', async (request) =>
    app.categories.move(idParams.parse(request.params).id, z.object({ direction: z.enum(['up', 'down']) }).parse(request.body).direction),
  )
  api.delete('/categories/:id', async (request, reply) => {
    app.categories.remove(idParams.parse(request.params).id)
    return reply.code(204).send()
  })

  // Tasks
  api.get('/tasks', async (request) => {
    const q = taskQuery.parse(request.query)
    return app.tasks.list({
      projectId: q.project,
      clientId: q.client,
      categoryId: q.category,
      status: q.status,
      priority: q.priority,
      due: q.due,
      all: q.all,
    })
  })
  api.post('/tasks', async (request, reply) => {
    const { projectId, ...input } = taskCreate.parse(request.body)
    return reply.code(201).send(app.tasks.create(projectId, [input])[0])
  })
  api.patch('/tasks/:id', async (request) => app.tasks.update(idParams.parse(request.params).id, taskPatch.parse(request.body)))
  api.delete('/tasks/:id', async (request, reply) => {
    app.tasks.remove(idParams.parse(request.params).id)
    return reply.code(204).send()
  })
}
