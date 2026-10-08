import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildCli } from '../src/cli/index.js'
import { buildServer } from '../src/server/index.js'
import { createFixture, type Fixture } from './helpers.js'

let fx: Fixture
let server: FastifyInstance
let output: string[]

beforeEach(async () => {
  fx = createFixture({ 'shop/composer.json': '{}', 'blog/index.html': '' })
  await fx.app.scan()
  server = await buildServer(fx.app, { webDir: join(fx.root, 'no-web') })
  output = []
})
afterEach(async () => {
  await server.close()
  fx.cleanup()
})

const json = { 'content-type': 'application/json' }
const send = (method: 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
  server.inject({ method, url, headers: payload === undefined ? {} : json, payload: payload as never })

async function mmp(...args: string[]) {
  output = []
  const cli = buildCli(() => fx.app, (line) => output.push(line))
  cli.exitOverride()
  await cli.parseAsync(['node', 'mmp', ...args])
  return output.join('\n')
}

describe('HTTP API: clients, categories, tasks', () => {
  it('manages clients and assigns them to projects', async () => {
    const created = await send('POST', '/api/clients', { name: 'Acme', email: 'hi@acme.test' })
    expect(created.statusCode).toBe(201)
    const id = created.json().id
    expect((await send('POST', '/api/clients', { name: 'acme' })).statusCode).toBe(409)

    const shop = fx.app.projects.resolve('shop').id
    const patched = await send('PATCH', `/api/projects/${shop}`, { clientId: id })
    expect(patched.json().client).toEqual({ id, name: 'Acme' })
    expect((await server.inject({ url: '/api/projects?client=none' })).json().map((p: { name: string }) => p.name)).toEqual(['blog'])

    const detail = await server.inject({ url: `/api/clients/${id}` })
    expect(detail.json()).toMatchObject({ name: 'Acme', projectCount: 1, projects: [{ name: 'shop' }] })
    expect((await send('PATCH', `/api/clients/${id}`, { notes: 'VIP' })).json().notes).toBe('VIP')
    expect((await send('DELETE', `/api/clients/${id}`)).statusCode).toBe(204)
    expect(fx.app.projects.get(shop)!.client).toBeNull()
  })

  it('manages categories and exposes them in meta', async () => {
    const created = await send('POST', '/api/categories', { name: 'Open source', color: '#123abc' })
    expect(created.json()).toMatchObject({ name: 'Open source', color: '#123abc' })
    expect((await send('PATCH', `/api/categories/${created.json().id}`, { color: 'blue' })).statusCode).toBe(400)
    const meta = (await server.inject({ url: '/api/meta' })).json()
    expect(meta.categories.map((c: { name: string }) => c.name)).toContain('Open source')
    expect(meta.clients).toEqual([])
  })

  it('creates, filters, updates and deletes tasks', async () => {
    const shop = fx.app.projects.resolve('shop').id
    const created = await send('POST', '/api/tasks', { projectId: shop, title: 'Fix login', priority: 'high', dueDate: '2026-10-07' })
    expect(created.statusCode).toBe(201)
    const id = created.json().id
    expect(created.json()).toMatchObject({ dueGroup: 'overdue', project: { name: 'shop' } })

    expect((await server.inject({ url: '/api/tasks?due=overdue' })).json()).toHaveLength(1)
    expect((await server.inject({ url: `/api/tasks?project=${shop}&status=done` })).json()).toHaveLength(0)
    expect((await server.inject({ url: '/api/tasks?status=bogus' })).statusCode).toBe(400)

    const moved = await send('PATCH', `/api/tasks/${id}`, { status: 'in_progress', position: 0.5 })
    expect(moved.json()).toMatchObject({ status: 'in_progress', position: 0.5 })
    expect((await send('PATCH', `/api/tasks/${id}`, { dueDate: 'tomorrow' })).statusCode).toBe(400)
    expect((await send('PATCH', `/api/tasks/${id}`, { dueDate: null })).json().dueDate).toBeNull()
    expect((await send('POST', '/api/tasks', { projectId: shop, title: '' })).statusCode).toBe(400)
    expect((await send('DELETE', `/api/tasks/${id}`)).statusCode).toBe(204)
    expect((await server.inject({ url: '/api/tasks' })).json()).toEqual([])
  })
})

describe('CLI: clients, categories, tasks', () => {
  it('classifies projects and filters the list', async () => {
    expect(await mmp('client', 'add', 'Acme', '--email', 'a@acme.test')).toMatch(/Client added: Acme/)
    await mmp('set', 'shop', '--client', 'acme', '--category', 'client work')
    const list = await mmp('list', '--client', 'Acme')
    expect(list).toMatch(/^NAME\s+STATUS\s+CLIENT\s+CATEGORY/)
    expect(list).toMatch(/shop\s+active\s+Acme\s+Client work/)
    expect(await mmp('list', '--client', 'none')).toContain('blog')
    expect(await mmp('show', 'shop')).toMatch(/Client\s+Acme/)
    await mmp('set', 'shop', '--client', 'none')
    expect(fx.app.projects.resolve('shop').client).toBeNull()

    expect(await mmp('category', 'add', 'Open source')).toMatch(/Category added: Open source/)
    expect(await mmp('category', 'list')).toContain('Open source')
    await expect(mmp('set', 'shop', '--client', 'Nobody')).rejects.toThrow(/Client not found/)
  })

  it('adds, lists, completes and removes tasks', async () => {
    expect(await mmp('task', 'add', 'Fix login', '--project', 'shop', '--priority', 'urgent', '--due', '2026-10-01')).toMatch(
      /Task added: [0-9a-f]{8}\s+Fix login\s+\(shop\)/,
    )
    const listed = await mmp('task', 'list', '--due', 'overdue')
    expect(listed).toMatch(/todo\s+urgent\s+2026-10-01 !\s+shop\s+Fix login/)
    const id = listed.split('\n')[1].split(/\s+/)[0]

    expect(await mmp('task', 'edit', id, '--due', 'none')).toMatch(/Due\s+-/)
    expect(await mmp('task', 'done', id)).toBe('Done: Fix login')
    expect(await mmp('task', 'list')).toBe('No tasks found.')
    expect(await mmp('task', 'list', '--status', 'done')).toContain('Fix login')
    expect(await mmp('task', 'remove', id)).toBe('Task removed: Fix login')
  })
})
