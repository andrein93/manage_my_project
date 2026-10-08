import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { localUserId } from '../src/core/db.js'
import { remoteKey } from '../src/core/sync/remote-key.js'
import { createFakeSyncServer } from './fake-sync-server.js'
import { createFixture, gitInit, hasGit, type Fixture } from './helpers.js'

let server: ReturnType<typeof createFakeSyncServer>
let a: Fixture // Anna's computer
let b: Fixture // Bruno's computer
let tokenA: string
let tokenB: string

beforeEach(async () => {
  server = createFakeSyncServer()
  tokenA = server.addUser('Anna', 'anna@team.test')
  tokenB = server.addUser('Bruno', 'bruno@team.test')
  a = createFixture({ 'shop/composer.json': '{}', 'private/index.html': '' }, { fetch: server.fetch })
  b = createFixture({ 'blog/index.html': '' }, { fetch: server.fetch })
  await a.app.scan()
  await b.app.scan()
})
afterEach(() => {
  a.cleanup()
  b.cleanup()
})

const project = (fx: Fixture, name: string) => fx.app.projects.list({ all: true }).find((p) => p.name === name)!

describe('remoteKey', () => {
  it.each([
    ['git@github.com:Acme/Site.git', 'acme/site'],
    ['git@github-work.com:acme/site.git', 'acme/site'],
    ['https://github.com/acme/site', 'acme/site'],
    ['https://user@gitlab.example.com/group/sub/site.git/', 'sub/site'],
    ['ssh://git@host:2222/acme/site.git', 'acme/site'],
    ['not-a-remote', null],
    [null, null],
  ])('%s → %s', (url, key) => expect(remoteKey(url)).toBe(key))
})

describe('team sync: review regressions', () => {
  beforeEach(async () => {
    await a.app.sync.login(server.url, tokenA)
    await b.app.sync.login(server.url, tokenB)
  })

  it('does not re-share a project the user stopped sharing when a teammate edits it', async () => {
    const shop = project(a, 'shop')
    a.app.projects.update(shop.id, { shared: true })
    await a.app.sync.run()
    await b.app.sync.run()
    a.app.projects.update(shop.id, { shared: false })
    await new Promise((r) => setTimeout(r, 5)) // Bruno's edit is the later one
    b.app.projects.update(shop.id, { description: 'edited by Bruno' })
    await b.app.sync.run()
    await a.app.sync.run()
    expect(a.app.projects.get(shop.id)).toMatchObject({ shared: false, description: 'edited by Bruno' })
  })

  it('keeps shared projects for the team when a workspace is removed locally', async () => {
    const shop = project(a, 'shop')
    a.app.projects.update(shop.id, { shared: true })
    await a.app.sync.run()
    a.app.workspaces.remove(a.app.workspaces.list()[0].id)
    expect(a.app.projects.get(shop.id)).toMatchObject({ local: false })
    expect((await a.app.sync.run()).pushed).toBe(0)
    await b.app.sync.run()
    expect(b.app.projects.get(shop.id)).not.toBeNull()
  })

  it('zeroes a day whose time disappeared and keeps one row per device', async () => {
    const shop = project(a, 'shop')
    a.app.projects.update(shop.id, { shared: true })
    const today = new Date().toISOString().slice(0, 10)
    const entry = a.app.time.repo.addEntry({ projectId: shop.id, minutes: 60, date: today })
    await a.app.sync.run()
    a.app.time.repo.removeEntry(entry.id)
    await a.app.sync.run()
    await b.app.sync.run()
    expect(b.app.sync.teamTime(shop.id, today, today)).toEqual([{ userId: localUserId(a.app.db), name: 'Anna', minutes: 0 }])
  })

  it('keeps going when one record cannot be applied, and retries records whose project is missing', async () => {
    const shop = project(a, 'shop')
    a.app.projects.update(shop.id, { shared: true })
    a.app.tasks.create(shop.id, [{ title: 'Good task' }])
    await a.app.sync.run()
    // A record from a "newer client" with an unknown status, and an orphan task.
    const bad = [...server.records.values()].find((r) => r.table === 'tasks')!
    server.records.set('tasks:bad', { ...bad, id: '11111111-1111-4111-8111-111111111111', data: { ...(bad.data as object), status: 'blocked' }, seq: 999 })
    server.records.set('tasks:orphan', { ...bad, id: '22222222-2222-4222-8222-222222222222', data: { ...(bad.data as object), project_id: '33333333-3333-4333-8333-333333333333' }, seq: 1000 })
    const result = await b.app.sync.run()
    expect(b.app.tasks.list({ projectId: shop.id }).map((t) => t.title)).toEqual(['Good task'])
    expect(result.skipped).toBe(1) // the orphan waits for its project
  })

  it('never lets a deleted team project take over a local one', async () => {
    const shop = project(a, 'shop')
    a.app.db.prepare("UPDATE projects SET remote_key = 'acme/shop' WHERE id = ?").run(shop.id)
    a.app.projects.update(shop.id, { shared: true })
    await a.app.sync.run()
    a.app.projects.update(shop.id, { status: 'archived' })
    a.app.db.prepare('UPDATE projects SET deleted_at = ?, updated_at = ? WHERE id = ?').run(new Date().toISOString(), new Date().toISOString(), shop.id)
    await a.app.sync.run()
    b.write({ 'shop2/index.html': '' })
    await b.app.scan()
    const mine = project(b, 'shop2')
    b.app.db.prepare("UPDATE projects SET remote_key = 'acme/shop', shared = 1 WHERE id = ?").run(mine.id)
    await b.app.sync.run()
    expect(b.app.projects.get(mine.id)).not.toBeNull()
  })

  it("counts teammates' hours in a shared project's hourly earnings", async () => {
    const shop = project(a, 'shop')
    a.app.projects.update(shop.id, { shared: true })
    a.app.finance.repo.addAgreement({ projectId: shop.id, kind: 'hourly', amount: 60, startDate: '2026-01-01' })
    await a.app.sync.run()
    await b.app.sync.run()
    const today = new Date().toISOString().slice(0, 10)
    b.app.time.repo.addEntry({ projectId: shop.id, minutes: 120, date: today }) // Bruno works 2h
    await b.app.sync.run()
    await a.app.sync.run()
    const report = a.app.finance.report({ range: { from: today, to: today } })
    expect(report.rows.find((r) => r.label === 'shop')).toMatchObject({ minutes: 120, earnedCents: 12000 })
  })

  it('rejects plain http to remote hosts and re-sends everything to a new server', async () => {
    await expect(a.app.sync.login('http://team.example.com', tokenA)).rejects.toThrow(/https/)
    a.app.clients.create({ name: 'Acme' })
    await a.app.sync.run()
    const other = createFakeSyncServer('https://other.test')
    const token = other.addUser('Anna', 'anna@team.test')
    a.app.sync.logout()
    const fx = a.app as unknown as { sync: { login: (u: string, t: string) => Promise<unknown> } }
    // Point the client at the other server's fetch.
    ;(a.app.sync as unknown as { fetchImpl: typeof fetch }).fetchImpl = other.fetch
    await fx.sync.login(other.url, token)
    await a.app.sync.run()
    expect([...other.records.values()].some((r) => (r.data as { name?: string }).name === 'Acme')).toBe(true)
  })
})

describe('team sync', () => {
  it('logs in, re-keys the local user and pulls members', async () => {
    const before = localUserId(a.app.db)
    const client = a.app.clients.create({ name: 'Acme' })
    const status = await a.app.sync.login(server.url, tokenA)
    expect(status).toMatchObject({ configured: true, user: { name: 'Anna' } })
    const me = localUserId(a.app.db)
    expect(me).not.toBe(before)
    expect((a.app.db.prepare('SELECT owner_id FROM clients WHERE id = ?').get(client.id) as { owner_id: string }).owner_id).toBe(me)
    expect(a.app.sync.members().map((m) => [m.name, m.me])).toEqual([
      ['Anna', true],
      ['Bruno', false],
    ])
    await expect(a.app.sync.login('https://other.test', tokenA)).rejects.toThrow()
  })

  it('rejects bad tokens and unreachable servers with clear errors', async () => {
    await expect(a.app.sync.login(server.url, 'nope')).rejects.toThrow(/did not accept the token/)
    await expect(a.app.sync.login('https://elsewhere.test', tokenA)).rejects.toThrow(/Cannot reach/)
    await expect(a.app.sync.run()).rejects.toThrow(/not configured/)
  })

  it('shares only shared projects, round-trips edits and does not ping-pong', async () => {
    await a.app.sync.login(server.url, tokenA)
    await b.app.sync.login(server.url, tokenB)
    const acme = a.app.clients.create({ name: 'Acme' })
    const shop = project(a, 'shop')
    a.app.projects.update(shop.id, { shared: true, clientId: acme.id })
    a.app.projects.editTags(shop.id, ['client'])
    const [task] = a.app.tasks.create(shop.id, [{ title: 'Checkout page' }])
    a.app.finance.repo.addAgreement({ projectId: shop.id, kind: 'fixed', amount: 1000, startDate: '2026-10-01' })
    a.app.tasks.create(project(a, 'private').id, [{ title: 'Secret' }])

    expect((await a.app.sync.run()).pushed).toBeGreaterThanOrEqual(4)
    expect([...server.records.values()].some((r) => (r.data as { title?: string }).title === 'Secret')).toBe(false)

    const pulled = await b.app.sync.run()
    expect(pulled.applied).toBeGreaterThanOrEqual(4)
    const remote = project(b, 'shop')
    expect(remote).toMatchObject({ local: false, shared: true, client: { name: 'Acme' }, tags: ['client'], health: [] })
    expect(b.app.tasks.list({ projectId: remote.id }).map((t) => t.title)).toEqual(['Checkout page'])
    expect(b.app.finance.repo.agreements(remote.id)).toHaveLength(1)
    // Starter categories created independently on both machines merge instead of duplicating.
    expect(b.app.categories.list().map((c) => c.name)).toEqual(a.app.categories.list().map((c) => c.name))
    expect(b.app.categories.list().map((c) => c.id)).toEqual(a.app.categories.list().map((c) => c.id))

    // Bruno takes the task; Anna sees it after syncing.
    const bruno = localUserId(b.app.db)
    b.app.tasks.update(task.id, { assigneeId: bruno, status: 'in_progress' })
    await b.app.sync.run()
    await a.app.sync.run()
    expect(a.app.tasks.get(task.id)).toMatchObject({ status: 'in_progress', assignee: { id: bruno, name: 'Bruno' } })

    // Nothing left to push on either side: applying pulled data never looks like a local edit.
    expect((await a.app.sync.run()).pushed).toBe(0)
    expect((await b.app.sync.run()).pushed).toBe(0)
  })

  it('resolves conflicts with the latest edit and propagates deletions', async () => {
    await a.app.sync.login(server.url, tokenA)
    await b.app.sync.login(server.url, tokenB)
    const client = a.app.clients.create({ name: 'Acme' })
    await a.app.sync.run()
    await b.app.sync.run()

    a.app.clients.update(client.id, { notes: 'from Anna' })
    await new Promise((r) => setTimeout(r, 5))
    b.app.clients.update(client.id, { notes: 'from Bruno' }) // later edit wins
    await a.app.sync.run()
    await b.app.sync.run()
    await a.app.sync.run()
    expect(a.app.clients.get(client.id)!.notes).toBe('from Bruno')
    expect(b.app.clients.get(client.id)!.notes).toBe('from Bruno')

    // A client created on both machines before syncing becomes one record with the team id.
    const twinA = a.app.clients.create({ name: 'Twin' })
    await a.app.sync.run()
    const twinB = b.app.clients.create({ name: 'twin' })
    await b.app.sync.run()
    expect(b.app.clients.list().map((c) => c.name).sort()).toEqual(['Acme', 'Twin'])
    expect(b.app.clients.get(twinA.id)).not.toBeNull()
    expect(b.app.clients.get(twinB.id)).toBeNull()

    b.app.clients.remove(client.id)
    await b.app.sync.run()
    await a.app.sync.run()
    expect(a.app.clients.get(client.id)).toBeNull()
  })

  it("shares each member's daily time on shared projects", async () => {
    await a.app.sync.login(server.url, tokenA)
    await b.app.sync.login(server.url, tokenB)
    const shop = project(a, 'shop')
    a.app.projects.update(shop.id, { shared: true })
    const today = new Date().toISOString().slice(0, 10)
    a.app.time.repo.addEntry({ projectId: shop.id, minutes: 90, date: today })
    await a.app.sync.run()
    await b.app.sync.run()
    const team = b.app.sync.teamTime(shop.id, today, today)
    expect(team).toEqual([{ userId: localUserId(a.app.db), name: 'Anna', minutes: 90 }])
  })

  it.runIf(hasGit)('matches the same repository on both machines by its git remote', async () => {
    const remote = 'git@github.com:acme/shop.git'
    gitInit(join(a.root, 'shop'))
    execFileSync('git', ['-C', join(a.root, 'shop'), 'remote', 'set-url', 'origin', remote])
    await a.app.scan()
    // Bruno cloned the same repo before ever syncing.
    b.write({ 'shop-clone/composer.json': '{}' })
    gitInit(join(b.root, 'shop-clone'))
    execFileSync('git', ['-C', join(b.root, 'shop-clone'), 'remote', 'set-url', 'origin', 'https://github.com/acme/shop'])
    await b.app.scan()
    const local = project(b, 'shop-clone')
    b.app.tasks.create(local.id, [{ title: 'Bruno local task' }])

    await a.app.sync.login(server.url, tokenA)
    await b.app.sync.login(server.url, tokenB)
    const shop = project(a, 'shop')
    a.app.projects.update(shop.id, { shared: true })
    await a.app.sync.run()
    await b.app.sync.run()

    // Bruno's clone is private: it is not adopted (nor uploaded) until he shares it.
    expect(b.app.projects.get(shop.id)).toMatchObject({ local: false })
    expect(b.app.projects.get(local.id)).toMatchObject({ shared: false, local: true })
    expect([...server.records.values()].some((r) => (r.data as { title?: string }).title === 'Bruno local task')).toBe(false)

    // Sharing it is the consent: it merges into the team project, keeping folder and tasks.
    const merged = b.app.projects.update(local.id, { shared: true })
    expect(merged).toMatchObject({ id: shop.id, local: true, shared: true, name: 'shop', path: join(b.root, 'shop-clone') })
    expect(b.app.projects.get(local.id)).toBeNull()
    expect(b.app.tasks.list({ projectId: shop.id }).map((t) => t.title)).toEqual(['Bruno local task'])
    expect(b.app.projects.list({ all: true }).filter((p) => p.name === 'shop' || p.name === 'shop-clone')).toHaveLength(1)
    await b.app.sync.run()
    await a.app.sync.run()
    expect(a.app.tasks.list({ projectId: shop.id }).map((t) => t.title)).toEqual(['Bruno local task'])
  })

  it.runIf(hasGit)('attaches a team project when its folder appears later', async () => {
    gitInit(join(a.root, 'shop'))
    execFileSync('git', ['-C', join(a.root, 'shop'), 'remote', 'set-url', 'origin', 'git@github.com:acme/shop.git'])
    await a.app.scan()
    await a.app.sync.login(server.url, tokenA)
    await b.app.sync.login(server.url, tokenB)
    const shop = project(a, 'shop')
    a.app.projects.update(shop.id, { shared: true })
    await a.app.sync.run()
    await b.app.sync.run()
    expect(b.app.projects.get(shop.id)!.local).toBe(false)

    b.write({ 'checkout/composer.json': '{}' })
    gitInit(join(b.root, 'checkout'))
    execFileSync('git', ['-C', join(b.root, 'checkout'), 'remote', 'set-url', 'origin', 'git@github-alias:acme/shop.git'])
    await b.app.scan()
    expect(b.app.projects.get(shop.id)).toMatchObject({ local: true, path: join(b.root, 'checkout') })
    expect(b.app.projects.list({ all: true }).some((p) => p.name === 'checkout')).toBe(false)
  })
})
