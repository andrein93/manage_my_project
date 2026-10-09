import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildCli } from '../src/cli/index.js'
import { createMcpServer } from '../src/mcp/index.js'
import { buildServer } from '../src/server/index.js'
import { createFixture, TODAY, type Fixture } from './helpers.js'

let fx: Fixture
let server: FastifyInstance
const notified: [string, string][] = []
const json = { 'content-type': 'application/json' }

beforeEach(async () => {
  fx = createFixture({ 'shop/composer.json': '{}' })
  await fx.app.scan()
  fx.app.tasks.create(fx.app.projects.resolve('shop').id, [
    { title: 'Late', dueDate: '2026-10-01' },
    { title: 'Today', dueDate: TODAY },
  ])
  notified.length = 0
  server = await buildServer(fx.app, {
    webDir: join(fx.root, 'no-web'),
    notify: async (title, body) => {
      notified.push([title, body])
      return true
    },
  })
})
afterEach(async () => {
  await server.close()
  fx.cleanup()
})

describe('reminders interfaces', () => {
  it('HTTP: list, dismiss, snooze, settings and a test notification', async () => {
    const list = (await server.inject({ url: '/api/reminders' })).json()
    expect(list.map((r: { title: string }) => r.title)).toEqual(['Overdue task: Late', 'Due today: Today'])
    const post = (url: string, payload: unknown) => server.inject({ method: 'POST', url, headers: json, payload: payload as never })
    expect((await post('/api/reminders/dismiss', { key: list[0].key })).statusCode).toBe(204)
    expect((await post('/api/reminders/snooze', { key: list[1].key })).statusCode).toBe(204)
    expect((await server.inject({ url: '/api/reminders' })).json()).toEqual([])
    expect((await post('/api/reminders/dismiss', {})).statusCode).toBe(400)
    const settings = await server.inject({ method: 'PUT', url: '/api/settings', headers: json, payload: { notifications: { desktop: true } } })
    expect(settings.json().notifications).toEqual({ desktop: true })
    expect((await post('/api/notifications/test', {})).json()).toEqual({ sent: true })
    expect(notified).toHaveLength(1)
  })

  it('CLI: mmp reminders', async () => {
    const output: string[] = []
    const mmp = async (...args: string[]) => {
      output.length = 0
      const cli = buildCli(() => fx.app, (line) => output.push(line))
      cli.exitOverride()
      await cli.parseAsync(['node', 'mmp', ...args])
      return output.join('\n')
    }
    const list = await mmp('reminders')
    expect(list).toMatch(/2026-10-01\s+Overdue task: Late\s+shop · due 2026-10-01/)
    const key = fx.app.reminders.list(TODAY)[0].key
    expect(await mmp('reminders', 'dismiss', key)).toMatch(/Dismissed/)
    expect(await mmp('reminders')).not.toContain('Overdue task: Late')
    fx.app.reminders.dismiss(fx.app.reminders.list(TODAY)[0].key)
    expect(await mmp('reminders')).toBe('Nothing needs your attention.')
  })

  it('MCP: reminders tool', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await createMcpServer(fx.app).connect(serverTransport)
    const client = new Client({ name: 'test', version: '0' })
    await client.connect(clientTransport)
    const res = (await client.callTool({ name: 'reminders', arguments: {} })) as { content: { text: string }[] }
    const data = JSON.parse(res.content[0].text)
    expect(data.map((r: { title: string }) => r.title)).toEqual(['Overdue task: Late', 'Due today: Today'])
    expect(data[0]).toMatchObject({ detail: 'shop · due 2026-10-01', date: '2026-10-01' })
    await client.close()
  })
})
