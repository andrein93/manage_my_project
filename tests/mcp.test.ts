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
      'get_current_project',
      'get_project',
      'list_projects',
      'scan_projects',
      'tag_project',
      'update_project',
    ])
  })

  it('scans, lists, finds the current project, updates and tags', async () => {
    expect((await call('scan_projects')).data.added).toBe(2)
    expect((await call('list_projects', { stack: 'php' })).data.map((p: { name: string }) => p.name)).toEqual(['shop'])
    expect((await call('get_current_project', { path: join(fx.root, 'shop', 'src', 'a.php') })).data.name).toBe('shop')
    expect((await call('update_project', { ref: 'shop', status: 'paused' })).data.status).toBe('paused')
    expect((await call('tag_project', { ref: 'blog', add: ['client'] })).data.tags).toEqual(['client'])
  })

  it('reports user errors as tool errors', async () => {
    const res = await call('get_project', { ref: 'does-not-exist' })
    expect(res.isError).toBe(true)
    expect(res.text).toMatch(/not found/)
  })
})
