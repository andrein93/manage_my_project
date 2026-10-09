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
const json = { 'content-type': 'application/json' }

beforeEach(async () => {
  fx = createFixture({ 'shop/composer.json': '{}', 'blog/index.html': '' })
  await fx.app.scan()
  server = await buildServer(fx.app, { webDir: join(fx.root, 'no-web') })
})
afterEach(async () => {
  await server.close()
  fx.cleanup()
})

const id = (name: string) => fx.app.projects.resolve(name).id

describe('custom fields interfaces', () => {
  it('HTTP: define fields and set project values', async () => {
    const created = await server.inject({ method: 'POST', url: '/api/fields', headers: json, payload: { name: 'Live site', kind: 'url' } })
    expect(created.statusCode).toBe(201)
    const field = created.json()
    const date = (await server.inject({ method: 'POST', url: '/api/fields', headers: json, payload: { name: 'Expiry', kind: 'date' } })).json()
    expect((await server.inject({ method: 'PATCH', url: `/api/fields/${date.id}`, headers: json, payload: { remindDays: 14 } })).json().remindDays).toBe(14)
    expect((await server.inject({ method: 'POST', url: `/api/fields/${date.id}/move`, headers: json, payload: { direction: 'up' } })).json()[0].id).toBe(date.id)
    const set = await server.inject({ method: 'PUT', url: `/api/projects/${id('shop')}/fields`, headers: json, payload: { values: { [field.id]: 'https://shop.test' } } })
    expect(set.json().find((v: { fieldId: string }) => v.fieldId === field.id).value).toBe('https://shop.test')
    const bad = await server.inject({ method: 'PUT', url: `/api/projects/${id('shop')}/fields`, headers: json, payload: { values: { [field.id]: 'ftp://x' } } })
    expect(bad.statusCode).toBe(400)
    expect((await server.inject({ url: `/api/projects/${id('shop')}/fields` })).json()).toHaveLength(2)
    expect((await server.inject({ url: '/api/fields' })).json().map((f: { name: string }) => f.name)).toEqual(['Expiry', 'Live site'])
    expect((await server.inject({ method: 'DELETE', url: `/api/fields/${field.id}` })).statusCode).toBe(204)
    expect((await server.inject({ method: 'DELETE', url: '/api/fields/nope' })).statusCode).toBe(404)
  })

  it('CLI: mmp field', async () => {
    const output: string[] = []
    const mmp = async (...args: string[]) => {
      output.length = 0
      const cli = buildCli(() => fx.app, (line) => output.push(line))
      cli.exitOverride()
      await cli.parseAsync(['node', 'mmp', ...args])
      return output.join('\n')
    }
    expect(await mmp('field', 'add', 'Hosting')).toMatch(/Added field Hosting \(text\)/)
    expect(await mmp('field', 'add', 'Domain expiry', '--kind', 'date', '--remind', '21')).toMatch(/date, remind 21 days before/)
    expect(await mmp('field', 'set', 'shop', 'hosting', 'Hetzner')).toMatch(/shop: Hosting = Hetzner/)
    expect(await mmp('field', 'list')).toMatch(/Domain expiry\s+date\s+21/)
    expect(await mmp('show', 'shop')).toMatch(/Hosting\s+Hetzner/)
    expect(await mmp('field', 'set', 'shop', 'hosting')).toMatch(/shop: Hosting cleared/)
    await expect(mmp('field', 'set', 'shop', 'domain expiry', 'soon')).rejects.toThrow(/valid date/)
    expect(await mmp('field', 'remove', 'hosting')).toMatch(/Removed field Hosting/)
  })

  it('MCP: list fields, set a value, read it in get_project', async () => {
    fx.app.fields.create({ name: 'Live site', kind: 'url' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await createMcpServer(fx.app).connect(serverTransport)
    const client = new Client({ name: 'test', version: '0' })
    await client.connect(clientTransport)
    const call = async (name: string, args: Record<string, unknown>) => {
      const res = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean }
      return res.isError ? { error: res.content[0].text } : JSON.parse(res.content[0].text)
    }
    expect((await call('list_fields', {})).map((f: { name: string }) => f.name)).toEqual(['Live site'])
    expect(await call('set_project_field', { project: 'blog', field: 'live site', value: 'https://blog.test' })).toMatchObject({
      project: 'blog',
      fields: { 'Live site': 'https://blog.test' },
    })
    expect((await call('get_project', { ref: 'blog' })).fields).toEqual({ 'Live site': 'https://blog.test' })
    expect((await call('set_project_field', { project: 'blog', field: 'nope', value: 'x' })).error).toMatch(/not found/i)
    await client.close()
  })
})
