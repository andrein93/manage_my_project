import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { App } from '../core/app.js'
import { localToday } from '../core/dates.js'
import { AGREEMENT_KINDS, AI_PLAN_KINDS, INTERVALS } from '../core/finance/types.js'
import { rangeFrom } from '../core/time/periods.js'

const idParams = z.object({ id: z.string().min(1) })
const amount = z.union([z.number(), z.string()])
const date = z.string()

const reportQuery = z.object({
  period: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  lifetime: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  by: z.enum(['project', 'client']).optional(),
  project: z.string().optional(),
  client: z.string().optional(),
})

const agreementBody = z
  .object({
    projectId: z.string().optional(),
    kind: z.enum(AGREEMENT_KINDS).optional(),
    amount: amount.optional(),
    interval: z.enum(INTERVALS).nullable().optional(),
    startDate: date.optional(),
    endDate: date.nullable().optional(),
    note: z.string().max(2000).optional(),
  })
  .strict()
const paymentBody = z
  .object({
    projectId: z.string().min(1),
    agreementId: z.string().nullable().optional(),
    date: date.optional(),
    amount,
    note: z.string().max(2000).optional(),
  })
  .strict()
const expenseBody = z
  .object({
    projectId: z.string().nullable().optional(),
    amount,
    interval: z.enum(INTERVALS).nullable().optional(),
    startDate: date.optional(),
    endDate: date.nullable().optional(),
    note: z.string().max(2000).optional(),
  })
  .strict()
const expensePatch = z
  .object({ amount: amount.optional(), endDate: date.nullable().optional(), note: z.string().max(2000).optional() })
  .strict()
const planBody = z
  .object({
    kind: z.enum(AI_PLAN_KINDS).optional(),
    monthlyAmount: amount.nullable().optional(),
    startDate: date.optional(),
    endDate: date.nullable().optional(),
    note: z.string().max(2000).optional(),
  })
  .strict()

export function registerFinanceRoutes(api: FastifyInstance, app: App): void {
  const f = app.finance.repo

  api.get('/finance/report', async (request) => {
    const q = reportQuery.parse(request.query)
    const range = q.lifetime ? undefined : rangeFrom(q, localToday(), app.settings.get().weekStart)
    return app.finance.report({ range, lifetime: q.lifetime }, q.by ?? 'project', { projectId: q.project, clientId: q.client })
  })
  api.get('/finance/owed', async () => ({ currency: app.settings.get().currency, rows: app.finance.owed() }))

  api.get('/agreements', async (request) => f.agreements(z.object({ project: z.string().optional() }).parse(request.query).project))
  api.post('/agreements', async (request, reply) => reply.code(201).send(f.addAgreement(agreementBody.parse(request.body))))
  api.patch('/agreements/:id', async (request) => f.updateAgreement(idParams.parse(request.params).id, agreementBody.parse(request.body)))
  api.delete('/agreements/:id', async (request, reply) => {
    f.removeAgreement(idParams.parse(request.params).id)
    return reply.code(204).send()
  })

  api.get('/payments', async (request) => {
    const q = z.object({ project: z.string().optional(), client: z.string().optional() }).parse(request.query)
    return f.payments({ projectId: q.project, clientId: q.client })
  })
  api.post('/payments', async (request, reply) => reply.code(201).send(f.addPayment(paymentBody.parse(request.body))))
  api.delete('/payments/:id', async (request, reply) => {
    f.removePayment(idParams.parse(request.params).id)
    return reply.code(204).send()
  })

  api.get('/expenses', async (request) => {
    const q = z.object({ project: z.string().optional(), shared: z.enum(['true', 'false']).optional() }).parse(request.query)
    return f.expenses({ projectId: q.project, shared: q.shared === undefined ? undefined : q.shared === 'true' })
  })
  api.post('/expenses', async (request, reply) => reply.code(201).send(f.addExpense(expenseBody.parse(request.body))))
  api.patch('/expenses/:id', async (request) => f.updateExpense(idParams.parse(request.params).id, expensePatch.parse(request.body)))
  api.delete('/expenses/:id', async (request, reply) => {
    f.removeExpense(idParams.parse(request.params).id)
    return reply.code(204).send()
  })

  api.get('/ai-plans', async () => f.aiPlans())
  api.post('/ai-plans', async (request, reply) => reply.code(201).send(f.addAiPlan(planBody.parse(request.body))))
  api.patch('/ai-plans/:id', async (request) => f.updateAiPlan(idParams.parse(request.params).id, planBody.parse(request.body)))
  api.delete('/ai-plans/:id', async (request, reply) => {
    f.removeAiPlan(idParams.parse(request.params).id)
    return reply.code(204).send()
  })
}
