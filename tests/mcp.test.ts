import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMcpServer } from '../src/mcp/index.js'
import { createFixture, type Fixture } from './helpers.js'

let fx: Fixture
let client: Client

beforeEach(async () => {
  fx = createFixture({ 'shop/composer.json': '{}', 'shop/src/a.php': '', 'blog/index.html': '' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await createMcpServer(fx.app).connect(serverTransport)
  client = new Client({ name: 'test', version: '0' })
  await client.connect(clientTransport)
})
afterEach(async () => {
  await client.close()
  fx.cleanup()
})

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean }
  return { isError: !!res.isError, text: res.content[0].text, data: res.isError ? null : JSON.parse(res.content[0].text) }
}

describe('MCP server', () => {
  it('exposes the expected tools', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual([
      'add_project',
      'add_workspace',
      'create_client',
      'create_tasks',
      'delete_task',
      'get_current_project',
      'get_project',
      'list_categories',
      'list_clients',
      'list_projects',
      'list_tasks',
      'scan_projects',
      'tag_project',
      'update_client',
      'update_project',
      'update_task',
    ])
  })

  it('scans, lists, finds the current project, updates and tags', async () => {
    expect((await call('scan_projects')).data.added).toBe(2)
    expect((await call('list_projects', { stack: 'php' })).data.map((p: { name: string }) => p.name)).toEqual(['shop'])
    expect((await call('get_current_project', { path: join(fx.root, 'shop', 'src', 'a.php') })).data.name).toBe('shop')
    expect((await call('update_project', { ref: 'shop', status: 'paused' })).data.status).toBe('paused')
    expect((await call('tag_project', { ref: 'blog', add: ['client'] })).data.tags).toEqual(['client'])
  })

  it('classifies projects and manages tasks', async () => {
    await call('scan_projects')
    expect((await call('create_client', { name: 'Acme' })).data.name).toBe('Acme')
    const updated = await call('update_project', { ref: 'shop', client: 'acme', category: 'Client work' })
    expect(updated.data).toMatchObject({ client: { name: 'Acme' }, category: { name: 'Client work' } })
    expect((await call('list_projects', { client: 'none' })).data.map((p: { name: string }) => p.name)).toEqual(['blog'])
    expect((await call('list_categories')).data).toHaveLength(4)

    const created = await call('create_tasks', {
      project: 'shop',
      tasks: [{ title: 'Login', priority: 'high', due_date: '2026-10-01' }, { title: 'Checkout' }],
    })
    expect(created.data).toHaveLength(2)
    expect((await call('list_tasks', { client: 'Acme', due: 'overdue' })).data.map((t: { title: string }) => t.title)).toEqual(['Login'])

    const id = created.data[0].id.slice(0, 8)
    expect((await call('update_task', { ref: id, status: 'done' })).data.status).toBe('done')
    expect((await call('list_tasks', { project: 'shop' })).data.map((t: { title: string }) => t.title)).toEqual(['Checkout'])
    expect((await call('list_clients')).data[0].openTaskCount).toBe(1)
    await call('delete_task', { ref: created.data[1].id })
    expect((await call('list_tasks', {})).data).toEqual([])

    const bad = await call('update_project', { ref: 'shop', client: 'Unknown Ltd' })
    expect(bad.isError).toBe(true)
    expect(bad.text).toMatch(/Client not found/)
  })

  it('reports user errors as tool errors', async () => {
    const res = await call('get_project', { ref: 'does-not-exist' })
    expect(res.isError).toBe(true)
    expect(res.text).toMatch(/not found/)
  })
})
