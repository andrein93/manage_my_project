import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildCli } from '../src/cli/index.js'
import { createMcpServer } from '../src/mcp/index.js'
import { buildServer } from '../src/server/index.js'
import { createFakeSyncServer } from './fake-sync-server.js'
import { createFixture, type Fixture } from './helpers.js'

let fx: Fixture
let server: ReturnType<typeof createFakeSyncServer>
let token: string
beforeEach(async () => {
  server = createFakeSyncServer()
  token = server.addUser('Anna', 'anna@team.test')
  server.addUser('Bruno', 'bruno@team.test')
  fx = createFixture({ 'shop/composer.json': '{}' }, { fetch: server.fetch })
  await fx.app.scan()
})
afterEach(() => fx.cleanup())

async function mmp(...args: string[]) {
  const output: string[] = []
  const cli = buildCli(() => fx.app, (line) => output.push(line))
  cli.exitOverride()
  await cli.parseAsync(['node', 'mmp', ...args])
  return output.join('\n')
}

describe('team sync interfaces', () => {
  it('CLI: login, share, assign, sync, status, members, logout', async () => {
    expect(await mmp('sync', 'status')).toMatch(/not configured/)
    expect(await mmp('sync', 'login', server.url, token)).toMatch(/Connected to https:\/\/team.test as Anna/)
    expect(await mmp('set', 'shop', '--share')).toMatch(/Team\s+shared/)
    expect(await mmp('members')).toMatch(/Anna \(you\)/)
    expect(await mmp('task', 'add', 'Deploy', '-p', 'shop')).toMatch(/Task added/)
    const id = fx.app.tasks.list()[0].id.slice(0, 8)
    expect(await mmp('task', 'edit', id, '--assignee', 'bruno')).toMatch(/Assignee\s+Bruno/)
    expect(await mmp('sync')).toMatch(/Synced in \d+ ms: .* \d+ sent/)
    expect([...server.records.values()].map((r) => r.table)).toEqual(expect.arrayContaining(['projects', 'tasks']))
    expect(await mmp('sync', 'status')).toMatch(/You\s+Anna <anna@team.test>/)
    await expect(mmp('task', 'edit', id, '--assignee', 'nobody')).rejects.toThrow(/Team member not found/)
    expect(await mmp('set', 'shop', '--no-share')).toMatch(/Team\s+private/)
    expect(await mmp('sync', 'logout')).toMatch(/Disconnected/)
  })

  it('HTTP: login, status, members, team time and the folder guard', async () => {
    const api = await buildServer(fx.app, { webDir: join(fx.root, 'no-web') })
    const json = { 'content-type': 'application/json' }
    const login = await api.inject({ method: 'POST', url: '/api/sync/login', headers: json, payload: { url: server.url, token } })
    expect(login.json()).toMatchObject({ configured: true, user: { name: 'Anna' } })
    expect((await api.inject({ method: 'POST', url: '/api/sync/login', headers: json, payload: { url: 'ftp://x', token } })).statusCode).toBe(400)
    expect((await api.inject({ url: '/api/members' })).json()).toHaveLength(2)
    const shop = fx.app.projects.resolve('shop').id
    expect((await api.inject({ method: 'PATCH', url: `/api/projects/${shop}`, headers: json, payload: { shared: true } })).json().shared).toBe(true)
    expect((await api.inject({ url: `/api/projects/${shop}/team-time` })).json().members).toEqual([])
    expect((await api.inject({ method: 'POST', url: '/api/sync/run', headers: json, payload: {} })).json().pushed).toBeGreaterThan(0)
    // A team project with no folder here cannot be opened.
    fx.app.db.prepare("UPDATE projects SET local = 0 WHERE id = ?").run(shop)
    expect((await api.inject({ method: 'POST', url: `/api/projects/${shop}/open`, headers: json, payload: { target: 'folder' } })).statusCode).toBe(400)
    await api.close()
  })

  it('MCP: share a project, assign a task and sync', async () => {
    await fx.app.sync.login(server.url, token)
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await createMcpServer(fx.app).connect(serverTransport)
    const client = new Client({ name: 'test', version: '0' })
    await client.connect(clientTransport)
    const call = async (name: string, args: Record<string, unknown>) =>
      JSON.parse(((await client.callTool({ name, arguments: args })) as { content: { text: string }[] }).content[0].text)
    expect((await call('update_project', { ref: 'shop', shared: true })).shared).toBe(true)
    const [task] = await call('create_tasks', { project: 'shop', tasks: [{ title: 'Fix' }] })
    expect((await call('update_task', { ref: task.id, assignee: 'Bruno' })).assignee.name).toBe('Bruno')
    expect((await call('list_members', {})).map((m: { name: string }) => m.name)).toEqual(['Anna', 'Bruno'])
    expect((await call('sync_now', {})).pushed).toBeGreaterThan(0)
    await client.close()
  })
})
