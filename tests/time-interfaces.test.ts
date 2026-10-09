import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildCli } from '../src/cli/index.js'
import { createMcpServer } from '../src/mcp/index.js'
import { buildServer } from '../src/server/index.js'
import { createFixture, type Fixture } from './helpers.js'

let fx: Fixture
let server: FastifyInstance
const DAY = '2026-10-01'

beforeEach(async () => {
  fx = createFixture({ 'shop/composer.json': '{}', 'blog/index.html': '' })
  await fx.app.scan()
  const dir = join(fx.root, '.claude-projects')
  mkdirSync(dir)
  const line = (time: string) =>
    JSON.stringify({ type: 'user', timestamp: new Date(`${DAY}T${time}`).toISOString(), cwd: join(fx.root, 'shop'), sessionId: 's1' })
  writeFileSync(
    join(dir, 's1.jsonl'),
    [line('09:00'), line('09:30'), JSON.stringify({ type: 'cost-state', sessionId: 's1', totalCostUSD: 2.5 })].join('\n') + '\n',
  )
  fx.app.settings.update({ claudeProjectsDir: dir })
  server = await buildServer(fx.app, { webDir: join(fx.root, 'no-web') })
})
afterEach(async () => {
  await server.close()
  fx.cleanup()
})

const json = { 'content-type': 'application/json' }

describe('HTTP API: time', () => {
  it('syncs, reports and manages manual entries', async () => {
    const sync = await server.inject({ method: 'POST', url: '/api/time/sync', headers: json, payload: {} })
    expect(sync.json()).toMatchObject({ claudeDirFound: true, signals: 2 })
    expect((await server.inject({ url: '/api/time/status' })).json()).toMatchObject({ running: false, lastSync: { signals: 2 } })

    const report = await server.inject({ url: `/api/time/report?from=${DAY}&to=${DAY}` })
    // Two signals 30 minutes apart exceed the 15-minute gap: two 2-minute blocks.
    expect(report.json().rows).toEqual([{ key: expect.any(String), label: 'shop', color: null, minutes: 4, costUsd: 2.5, share: 1 }])

    const shop = fx.app.projects.resolve('shop').id
    const entry = await server.inject({ method: 'POST', url: '/api/time/entries', headers: json, payload: { projectId: shop, date: DAY, minutes: '1h', note: 'Call' } })
    expect(entry.statusCode).toBe(201)
    const id = entry.json().id
    expect((await server.inject({ method: 'PATCH', url: `/api/time/entries/${id}`, headers: json, payload: { minutes: 'soon' } })).statusCode).toBe(400)
    expect((await server.inject({ url: `/api/time/report?from=${DAY}&by=day` })).json().totals.minutes).toBe(64)

    const blocks = await server.inject({ url: `/api/time/blocks?project=${shop}&from=${DAY}` })
    expect(blocks.json().blocks).toHaveLength(2)
    expect(blocks.json().entries).toHaveLength(1)
    expect((await server.inject({ method: 'DELETE', url: `/api/time/entries/${id}` })).statusCode).toBe(204)
    expect((await server.inject({ url: '/api/time/report?period=decade' })).statusCode).toBe(400)
  })

  it('updates time settings', async () => {
    const res = await server.inject({ method: 'PUT', url: '/api/settings', headers: json, payload: { idleMinutes: 30, weekStart: 'sunday' } })
    expect(res.json()).toMatchObject({ idleMinutes: 30, weekStart: 'sunday' })
    expect((await server.inject({ method: 'PUT', url: '/api/settings', headers: json, payload: { idleMinutes: 1 } })).statusCode).toBe(400)
  })
})

describe('MCP: time tools', () => {
  it('reports and logs time', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await createMcpServer(fx.app).connect(serverTransport)
    const client = new Client({ name: 'test', version: '0' })
    await client.connect(clientTransport)
    const call = async (name: string, args: Record<string, unknown>) => {
      const res = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean }
      return res.isError ? { error: res.content[0].text } : JSON.parse(res.content[0].text)
    }

    const report = await call('time_report', { from: DAY, to: DAY })
    expect(report.totals).toMatchObject({ minutes: 4, costUsd: 2.5, formatted: '4m' })
    expect((await call('log_time', { project: 'shop', duration: '1h30m', date: DAY, note: 'Workshop' })).minutes).toBe(90)
    expect((await call('time_report', { from: DAY, by: 'client' })).rows[0]).toMatchObject({ label: 'No client', formatted: '1h 34m' })
    expect((await call('log_time', { project: 'shop', duration: 'forever' })).error).toMatch(/Invalid duration/)
    await client.close()
  })
})

describe('CLI: time', () => {
  it('syncs, adds, reports and removes', async () => {
    const output: string[] = []
    const mmp = async (...args: string[]) => {
      output.length = 0
      const cli = buildCli(() => fx.app, (line) => output.push(line))
      cli.exitOverride()
      await cli.parseAsync(['node', 'mmp', ...args])
      return output.join('\n')
    }
    expect(await mmp('time', 'sync')).toMatch(/2 new activity minute/)
    const added = await mmp('time', 'add', 'shop', '45m', '--date', DAY, '--note', 'Call')
    expect(added).toMatch(/Logged 45m on shop \(2026-10-01\) \[[0-9a-f]{8}\]/)
    const report = await mmp('time', 'report', '--from', DAY, '--no-sync')
    expect(report).toContain('2026-10-01 → 2026-10-01: 49m (manual 45m), AI $2.50')
    expect(report).toMatch(/shop\s+49m\s+100%\s+\$2\.50/)
    expect(await mmp('time', 'blocks', '-p', 'shop', '--from', DAY)).toContain('Manual entries:')
    const id = added.match(/\[([0-9a-f]{8})\]/)![1]
    expect(await mmp('time', 'remove', id)).toBe('Removed 45m on shop (2026-10-01)')
  })
})

describe('time report: tasks completed', () => {
  it('counts tasks completed in the range, with the same filters as the report', async () => {
    const server = await buildServer(fx.app, { webDir: join(fx.root, 'no-web') })
    await fx.app.scan()
    const shop = fx.app.projects.resolve('shop').id
    const blog = fx.app.projects.resolve('blog').id
    const [a] = fx.app.tasks.create(shop, [{ title: 'Done in shop' }, { title: 'Still open' }])
    const [b] = fx.app.tasks.create(blog, [{ title: 'Done in blog' }])
    fx.app.tasks.update(a.id, { status: 'done' })
    fx.app.tasks.update(b.id, { status: 'done' })
    const get = async (q: string) => (await server.inject({ url: `/api/time/report?${q}` })).json().tasksCompleted
    expect(await get('from=2026-01-01&to=2030-12-31')).toBe(2)
    expect(await get(`from=2026-01-01&to=2030-12-31&project=${shop}`)).toBe(1)
    expect(await get('from=2000-01-01&to=2000-01-31')).toBe(0)
    await server.close()
  })
})
