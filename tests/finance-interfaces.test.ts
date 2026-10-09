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
const post = (url: string, payload: unknown) => server.inject({ method: 'POST', url, headers: json, payload: payload as never })

describe('HTTP API: finance', () => {
  it('manages agreements, payments, expenses and AI plans, and reports', async () => {
    const deal = await post('/api/agreements', { projectId: id('shop'), kind: 'fixed', amount: '2.000', startDate: '2026-10-01' })
    expect(deal.statusCode).toBe(201)
    expect(deal.json()).toMatchObject({ amountCents: 200000, projectName: 'shop' })
    expect((await post('/api/agreements', { projectId: id('shop'), kind: 'hourly' })).statusCode).toBe(400)

    expect((await post('/api/payments', { projectId: id('shop'), amount: 500, date: '2026-10-02' })).statusCode).toBe(201)
    expect((await post('/api/expenses', { amount: '20', interval: 'month', startDate: '2026-10-01', note: 'VPS' })).statusCode).toBe(201)
    expect((await post('/api/ai-plans', { kind: 'subscription', monthlyAmount: 90, startDate: '2026-10-01' })).statusCode).toBe(201)
    expect((await post('/api/ai-plans', { kind: 'api', startDate: '2026-10-15' })).statusCode).toBe(409)

    const report = (await server.inject({ url: '/api/finance/report?from=2026-10-01&to=2026-10-31' })).json()
    expect(report.rows).toEqual([expect.objectContaining({ label: 'shop', earnedCents: 200000, collectedCents: 50000 })])
    expect(report.totals.overheadCents).toBe(2000 + 9000) // no hours or AI usage: VPS and subscription stay overhead
    expect((await server.inject({ url: '/api/finance/report?lifetime=true&by=client' })).json().rows[0]).toMatchObject({ label: 'No client' })

    const owed = (await server.inject({ url: '/api/finance/owed' })).json()
    expect(owed).toMatchObject({ currency: 'EUR', rows: [{ clientName: 'No client', owedCents: 150000 }] })

    const ended = await server.inject({ method: 'PATCH', url: `/api/agreements/${deal.json().id}`, headers: json, payload: { endDate: '2026-10-31' } })
    expect(ended.statusCode).toBe(400) // an open fixed price stays booked on its start date
    expect((await server.inject({ method: 'DELETE', url: `/api/agreements/${deal.json().id}` })).statusCode).toBe(204)
    expect((await server.inject({ url: '/api/expenses?shared=true' })).json()).toHaveLength(1)
  })

  it('serves the command reference generated from the CLI and MCP definitions', async () => {
    const help = (await server.inject({ url: '/api/help' })).json()
    const dealAdd = help.cli.find((c: { command: string }) => c.command === 'mmp deal add')
    expect(dealAdd).toMatchObject({ group: 'deal', usage: 'mmp deal add [options] <project>' })
    expect(dealAdd.options.map((o: { flags: string }) => o.flags)).toContain('--every <interval>')
    expect(dealAdd.options.find((o: { flags: string }) => o.flags === '--every <interval>').choices).toEqual(['month', 'year'])
    expect(help.cli.some((c: { command: string }) => c.command === 'mmp list')).toBe(true)
    const report = help.mcp.find((t: { name: string }) => t.name === 'finance_report')
    expect(report.params.map((p: { name: string }) => p.name)).toContain('lifetime')
    expect(help.mcp.find((t: { name: string }) => t.name === 'record_payment').params.find((p: { name: string }) => p.name === 'amount').required).toBe(true)
  })
})

describe('MCP: finance tools', () => {
  it('records money and answers who owes what', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await createMcpServer(fx.app).connect(serverTransport)
    const client = new Client({ name: 'test', version: '0' })
    await client.connect(clientTransport)
    const call = async (name: string, args: Record<string, unknown>) => {
      const res = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean }
      return res.isError ? { error: res.content[0].text } : JSON.parse(res.content[0].text)
    }
    expect((await call('add_agreement', { project: 'shop', kind: 'recurring', amount: '150', start_date: '2026-09-01' })).interval).toBe('month')
    expect((await call('record_payment', { project: 'shop', amount: '100', date: '2026-09-02' })).amountCents).toBe(10000)
    expect((await call('add_expense', { amount: '15', note: 'Domain', project: 'shop', start_date: '2026-09-03' })).projectName).toBe('shop')
    expect((await call('list_agreements', { project: 'shop' }))).toHaveLength(1)

    const report = await call('finance_report', { from: '2026-09-01', to: '2026-09-30' })
    expect(report.rows[0]).toMatchObject({ name: 'shop', earned: '150.00 EUR', costs: '15.00 EUR', margin: '135.00 EUR' })
    // Today is 2026-10-08: September and October fees are due.
    expect(await call('owed_report', {})).toEqual([{ client: 'No client', owed: '200.00 EUR', projects: [{ name: 'shop', owed: '200.00 EUR' }] }])
    expect((await call('add_agreement', { project: 'shop', kind: 'fixed', amount: 'lots' })).error).toMatch(/Invalid amount/)
    await client.close()
  })
})

describe('CLI: finance', () => {
  it('adds deals, payments, expenses and plans, and reports', async () => {
    const output: string[] = []
    const mmp = async (...args: string[]) => {
      output.length = 0
      const cli = buildCli(() => fx.app, (line) => output.push(line))
      cli.exitOverride()
      await cli.parseAsync(['node', 'mmp', ...args])
      return output.join('\n')
    }
    expect(await mmp('deal', 'add', 'blog', '--fixed', '1.200', '--from', '2026-10-01', '--to', '2026-10-12')).toMatch(/fixed 1,200.00 EUR/)
    await expect(mmp('deal', 'add', 'blog', '--fixed', '1', '--hourly', '2')).rejects.toThrow(/exactly one/)
    expect(await mmp('payment', 'add', 'blog', '300', '--date', '2026-10-02')).toMatch(/300.00 EUR on 2026-10-02 \(blog\)/)
    expect(await mmp('expense', 'add', '20', '--note', 'VPS', '--every', 'month', '--from', '2026-10-01')).toMatch(/every month \(shared\)/)
    expect(await mmp('ai-plan', 'add', '--subscription', '90', '--from', '2026-10-01')).toMatch(/90.00 EUR\/month from 2026-10-01/)
    const report = await mmp('finance', 'report', '--from', '2026-10-01', '--to', '2026-10-31', '--no-sync')
    expect(report).toContain('Earned 1,200.00 EUR, collected 300.00 EUR')
    expect(report).toMatch(/blog\s+0m\s+1,200.00 EUR\s+0.00 EUR\s+1,200.00 EUR\s+-/)
    expect(await mmp('finance', 'owed')).toMatch(/No client\s+800.00 EUR\s+300.00 EUR\s+500.00 EUR/)
    const plans = await mmp('ai-plan', 'list')
    const planId = plans.split('\n')[1].split(/\s+/)[0]
    expect(await mmp('ai-plan', 'end', planId, '--date', '2026-12-31')).toBe('AI plan ends on 2026-12-31')
  })
})

describe('statements interfaces', () => {
  let acmeId: string
  beforeEach(() => {
    acmeId = fx.app.clients.create({ name: 'Acme' }).id
    fx.app.projects.update(id('shop'), { clientId: acmeId })
    fx.app.finance.repo.addAgreement({ projectId: id('shop'), kind: 'hourly', amount: 50, startDate: '2026-09-01' })
    // Today is 2026-10-08: "last month" is September.
    fx.app.time.repo.addEntry({ projectId: id('shop'), date: '2026-09-10', minutes: 120 })
  })

  it('HTTP: create, edit, issue, pay, delete rules', async () => {
    const created = await post('/api/statements', { clientId: acmeId, from: '2026-09-01', to: '2026-09-30' })
    expect(created.statusCode).toBe(201)
    const s = created.json()
    expect(s).toMatchObject({ status: 'draft', subtotalCents: 10000 })
    const lines = await server.inject({
      method: 'PUT',
      url: `/api/statements/${s.id}/lines`,
      headers: json,
      payload: { lines: [{ projectId: id('shop'), description: 'Work', quantity: 2, unitCents: 6000 }] },
    })
    expect(lines.json().subtotalCents).toBe(12000)
    expect((await server.inject({ method: 'PATCH', url: `/api/statements/${s.id}`, headers: json, payload: { notes: 'Thanks' } })).json().notes).toBe('Thanks')
    const issued = (await post(`/api/statements/${s.id}/issue`, { issueDate: '2026-10-01' })).json()
    expect(issued.number).toBe('PF-2026-001')
    expect((await server.inject({ method: 'DELETE', url: `/api/statements/${s.id}` })).statusCode).toBe(400)
    expect((await post(`/api/statements/${s.id}/paid`, { date: '2026-10-05' })).json().status).toBe('paid')
    const owed = (await server.inject({ url: '/api/finance/owed' })).json()
    expect(owed.rows.find((r: { clientName: string }) => r.clientName === 'Acme').collectedCents).toBe(12000)
    expect((await server.inject({ url: `/api/statements?client=${acmeId}&status=paid` })).json()).toHaveLength(1)
    expect((await post(`/api/statements/${s.id}/unpaid`, {})).json().status).toBe('issued')
    expect((await post(`/api/statements/${s.id}/void`, {})).json().status).toBe('void')
    expect((await server.inject({ url: '/api/statements/nope' })).statusCode).toBe(404)
    const draft = (await post('/api/statements', { clientId: acmeId, from: '2026-09-01', to: '2026-09-30' })).json()
    expect((await post(`/api/statements/${draft.id}/refill`, {})).json().subtotalCents).toBe(10000)
    expect((await server.inject({ method: 'DELETE', url: `/api/statements/${draft.id}` })).statusCode).toBe(204)
  })

  it('CLI: mmp statement', async () => {
    const output: string[] = []
    const mmp = async (...args: string[]) => {
      output.length = 0
      const cli = buildCli(() => fx.app, (line) => output.push(line))
      cli.exitOverride()
      await cli.parseAsync(['node', 'mmp', ...args])
      return output.join('\n')
    }
    const created = await mmp('statement', 'create', 'Acme', '--period', 'last-month')
    expect(created).toMatch(/Draft statement for Acme, 2026-09-01 → 2026-09-30/)
    expect(created).toMatch(/Total\s+122.00 EUR/)
    expect(created).toContain('/statements/')
    const ref = fx.app.statements.list()[0].id
    expect(await mmp('statement', 'issue', ref, '--date', '2026-10-01')).toMatch(/Issued PF-2026-001/)
    expect(await mmp('statement', 'list')).toMatch(/PF-2026-001\s+Acme\s+2026-09-01 → 2026-09-30\s+122.00 EUR\s+issued/)
    expect(await mmp('statement', 'paid', 'PF-2026-001', '--date', '2026-10-05')).toMatch(/PF-2026-001 marked paid/)
    expect(await mmp('statement', 'show', 'pf-2026-001')).toMatch(/shop — 2 h/)
    const it_ = await mmp('statement', 'create', 'Acme', '--period', 'last-month', '--language', 'it')
    expect(fx.app.statements.list({ status: 'draft' })[0].language).toBe('it')
    expect(it_).toContain('Draft statement')
    await expect(mmp('statement', 'delete', 'PF-2026-001')).rejects.toThrow(/only drafts/)
  })

  it('MCP: create, list, issue and pay statements', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await createMcpServer(fx.app).connect(serverTransport)
    const client = new Client({ name: 'test', version: '0' })
    await client.connect(clientTransport)
    const call = async (name: string, args: Record<string, unknown>) => {
      const res = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean }
      return res.isError ? { error: res.content[0].text } : JSON.parse(res.content[0].text)
    }
    const draft = await call('create_statement', { client: 'Acme', period: 'last-month' })
    expect(draft).toMatchObject({ status: 'draft', client: 'Acme', total: '122.00 EUR' })
    expect(draft.printUrl).toContain(`/statements/${draft.id}/print`)
    expect(draft.lines[0]).toMatchObject({ description: 'shop — 2 h', amount: '100.00 EUR' })
    expect(await call('list_statements', { client: 'Acme' })).toHaveLength(1)
    expect((await call('issue_statement', { statement: draft.id })).number).toBe('PF-2026-001')
    expect((await call('mark_statement_paid', { statement: 'PF-2026-001', date: '2026-10-05' })).status).toBe('paid')
    expect((await call('issue_statement', { statement: 'nope' })).error).toMatch(/not found/i)
    expect((await call('create_statement', { client: 'Acme', period: 'last-month', language: 'it' })).language).toBe('it')
    await client.close()
  })
})
