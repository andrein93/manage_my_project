import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addDays, cleanDate, dueGroup } from '../src/core/dates.js'
import { MIGRATIONS, openDatabase } from '../src/core/db.js'
import { createFixture, TODAY, type Fixture } from './helpers.js'

let fx: Fixture
beforeEach(async () => {
  fx = createFixture({ 'shop/composer.json': '{}', 'blog/index.html': '', 'old/index.html': '' })
  await fx.app.scan()
})
afterEach(() => fx.cleanup())

const project = (name: string) => fx.app.projects.resolve(name)

describe('migration 2', () => {
  it('upgrades a v1 database keeping projects and seeding categories once', () => {
    const file = join(fx.root, '.data', 'v1.db')
    openDatabase(join(fx.root, '.data', 'mkdir.db')).close()
    const v1 = new DatabaseSync(file)
    v1.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY)')
    v1.exec(MIGRATIONS[0])
    v1.exec("INSERT INTO schema_migrations VALUES (1); INSERT INTO users VALUES ('u1', 'Me', 'x', 'x')")
    v1.exec(`INSERT INTO projects (id, owner_id, source, name, description, status, path, path_key, created_at, updated_at)
             VALUES ('p1', 'u1', 'manual', 'Kept', 'my notes', 'paused', 'C:/x', 'c:/x', 'x', 'x')`)
    v1.close()

    const db = openDatabase(file)
    const row = db.prepare('SELECT name, description, status, client_id FROM projects').get() as Record<string, unknown>
    expect(row).toEqual({ name: 'Kept', description: 'my notes', status: 'paused', client_id: null })
    expect((db.prepare('SELECT COUNT(*) AS n FROM categories').get() as { n: number }).n).toBe(4)
    db.close()

    const again = openDatabase(file)
    expect((again.prepare('SELECT COUNT(*) AS n FROM categories').get() as { n: number }).n).toBe(4)
    again.close()
  })
})

describe('clients', () => {
  it('creates, updates, resolves and enforces unique names', () => {
    const acme = fx.app.clients.create({ name: ' Acme ', email: 'a@acme.test' })
    expect(acme).toMatchObject({ name: 'Acme', email: 'a@acme.test', projectCount: 0 })
    expect(() => fx.app.clients.create({ name: 'ACME' })).toThrow(/already exists/)
    expect(() => fx.app.clients.create({ name: '  ' })).toThrow(/empty/)
    expect(fx.app.clients.resolve('acme').id).toBe(acme.id)
    expect(fx.app.clients.resolve(acme.id.slice(0, 8)).id).toBe(acme.id)
    expect(fx.app.clients.update(acme.id, { notes: 'VIP' }).notes).toBe('VIP')
  })

  it('removal detaches projects and frees the name', () => {
    const acme = fx.app.clients.create({ name: 'Acme' })
    fx.app.projects.update(project('shop').id, { clientId: acme.id })
    expect(fx.app.clients.get(acme.id)!.projectCount).toBe(1)

    fx.app.clients.remove(acme.id)
    expect(project('shop').client).toBeNull()
    expect(fx.app.clients.create({ name: 'Acme' }).name).toBe('Acme')
  })
})

describe('categories', () => {
  it('starts with the seed list and supports CRUD', () => {
    expect(fx.app.categories.list().map((c) => c.name)).toEqual(['Client work', 'Side project', 'Product / SaaS', 'Internal'])
    const cat = fx.app.categories.create({ name: 'Open source' })
    expect(cat.position).toBe(5)
    expect(cat.color).toMatch(/^#[0-9a-f]{6}$/)
    expect(() => fx.app.categories.create({ name: 'internal' })).toThrow(/already exists/)
    expect(() => fx.app.categories.update(cat.id, { color: 'red' })).toThrow(/Invalid color/)
    expect(fx.app.categories.update(cat.id, { name: 'OSS', position: 0 }).name).toBe('OSS')
    expect(fx.app.categories.list()[0].name).toBe('OSS')

    fx.app.projects.update(project('blog').id, { categoryId: cat.id })
    fx.app.categories.remove(cat.id)
    expect(project('blog').category).toBeNull()
  })
})

describe('project classification', () => {
  it('assigns, clears and filters by client and category', () => {
    const acme = fx.app.clients.create({ name: 'Acme' })
    const work = fx.app.categories.resolve('client work')
    fx.app.projects.update(project('shop').id, { clientId: acme.id, categoryId: work.id })

    expect(project('shop')).toMatchObject({ client: { name: 'Acme' }, category: { name: 'Client work' } })
    const names = (f: Parameters<typeof fx.app.projects.list>[0]) => fx.app.projects.list(f).map((p) => p.name)
    expect(names({ client: acme.id })).toEqual(['shop'])
    expect(names({ client: 'none' })).toEqual(['blog', 'old'])
    expect(names({ category: work.id })).toEqual(['shop'])
    expect(names({ query: 'acme' })).toEqual(['shop'])

    fx.app.projects.update(project('shop').id, { clientId: null })
    expect(project('shop').client).toBeNull()
    expect(() => fx.app.projects.update(project('shop').id, { clientId: 'nope' })).toThrow(/Client not found/)
  })
})

describe('tasks', () => {
  it('creates in bulk, orders columns and tracks completion', () => {
    const shop = project('shop')
    const [a, b] = fx.app.tasks.create(shop.id, [{ title: 'Login' }, { title: 'Checkout', priority: 'urgent' }])
    expect([a.position, b.position]).toEqual([1, 2])
    expect(a).toMatchObject({ status: 'todo', priority: 'normal', dueGroup: 'none', project: { name: 'shop' } })

    const done = fx.app.tasks.update(a.id, { status: 'done' })
    expect(done.completedAt).not.toBeNull()
    expect(done.dueGroup).toBeNull()
    expect(done.position).toBe(1)
    const reopened = fx.app.tasks.update(a.id, { status: 'in_progress' })
    expect(reopened.completedAt).toBeNull()

    expect(fx.app.tasks.list({ projectId: shop.id }).map((t) => t.title)).toEqual(['Checkout', 'Login'])
    expect(fx.app.tasks.list({ projectId: shop.id, status: ['done'] })).toEqual([])
  })

  it('validates input and rolls back bulk creation on error', () => {
    const shop = project('shop')
    expect(() => fx.app.tasks.create(shop.id, [{ title: 'ok' }, { title: ' ' }])).toThrow(/empty/)
    expect(fx.app.tasks.list({ projectId: shop.id })).toEqual([])
    expect(() => fx.app.tasks.create(shop.id, [{ title: 'x', dueDate: '2026-02-30' }])).toThrow(/Invalid date/)
    expect(() => fx.app.tasks.create(shop.id, [{ title: 'x', priority: 'asap' as never }])).toThrow(/Invalid priority/)
    expect(() => fx.app.tasks.create('missing', [{ title: 'x' }])).toThrow(/Project not found/)
  })

  it('groups and filters by due date, client, category and hidden projects', () => {
    const acme = fx.app.clients.create({ name: 'Acme' })
    fx.app.projects.update(project('shop').id, { clientId: acme.id })
    fx.app.projects.update(project('old').id, { status: 'archived' })
    fx.app.tasks.create(project('shop').id, [
      { title: 'late', dueDate: addDays(TODAY, -1) },
      { title: 'now', dueDate: TODAY },
      { title: 'soon', dueDate: addDays(TODAY, 3) },
      { title: 'far', dueDate: addDays(TODAY, 30) },
    ])
    fx.app.tasks.create(project('blog').id, [{ title: 'undated' }])
    fx.app.tasks.create(project('old').id, [{ title: 'archived one' }])

    const all = fx.app.tasks.list()
    expect(all.map((t) => [t.title, t.dueGroup])).toEqual([
      ['late', 'overdue'],
      ['now', 'today'],
      ['soon', 'week'],
      ['far', 'later'],
      ['undated', 'none'],
    ])
    const titles = (f: Parameters<typeof fx.app.tasks.list>[0]) => fx.app.tasks.list(f).map((t) => t.title)
    expect(titles({ due: 'overdue' })).toEqual(['late'])
    expect(titles({ due: 'today' })).toEqual(['late', 'now'])
    expect(titles({ due: 'week' })).toEqual(['late', 'now', 'soon'])
    expect(titles({ clientId: 'none' })).toEqual(['undated'])
    expect(titles({ clientId: acme.id }).length).toBe(4)
    expect(titles({ all: true })).toContain('archived one')
    expect(titles({ projectId: project('old').id })).toEqual(['archived one'])
    expect(fx.app.clients.get(acme.id)!.openTaskCount).toBe(4)
  })

  it('resolves by id prefix and soft-deletes', () => {
    const [task] = fx.app.tasks.create(project('blog').id, [{ title: 'Write post' }])
    expect(fx.app.tasks.resolve(task.id.slice(0, 6)).id).toBe(task.id)
    expect(() => fx.app.tasks.resolve('abc')).toThrow(/not found/)
    fx.app.tasks.remove(task.id)
    expect(fx.app.tasks.get(task.id)).toBeNull()
  })
})

describe('dates', () => {
  it('validates and groups', () => {
    expect(cleanDate('2026-02-28')).toBe('2026-02-28')
    expect(() => cleanDate('28/02/2026')).toThrow()
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
    expect(dueGroup('2026-10-15', TODAY)).toBe('week')
    expect(dueGroup('2026-10-16', TODAY)).toBe('later')
  })
})

describe('review regressions (organize)', () => {
  it('rejects out-of-range dates as user errors', () => {
    expect(() => cleanDate('2026-13-01')).toThrow(/Invalid date/)
    expect(() => cleanDate('2026-00-10')).toThrow(/Invalid date/)
    expect(() => fx.app.tasks.create(project('shop').id, [{ title: 'x', dueDate: '2026-13-01' }])).toThrow(/Invalid date/)
  })

  it('reserves the name "none" and hints how to create a missing client', () => {
    expect(() => fx.app.clients.create({ name: 'None' })).toThrow(/reserved/)
    expect(() => fx.app.categories.create({ name: 'none' })).toThrow(/reserved/)
    expect(() => fx.app.clients.resolve('Nobody')).toThrow(/Create it first/)
  })

  it('moves categories even when positions are tied', () => {
    const a = fx.app.categories.create({ name: 'A', position: 10 })
    fx.app.categories.create({ name: 'B', position: 10 })
    const order = fx.app.categories.move(a.id, 'down').map((c) => c.name)
    expect(order.indexOf('B')).toBeLessThan(order.indexOf('A'))
    expect(new Set(fx.app.categories.list().map((c) => c.position)).size).toBe(fx.app.categories.list().length)
  })

  it('renumbers a column when fractional positions get too close', () => {
    const [a, b, c] = fx.app.tasks.create(project('shop').id, [{ title: 'a' }, { title: 'b' }, { title: 'c' }])
    fx.app.tasks.update(c.id, { position: a.position + 1e-9 })
    const column = fx.app.tasks.list({ projectId: project('shop').id }).sort((x, y) => x.position - y.position)
    expect(column.map((t) => t.title)).toEqual(['a', 'c', 'b'])
    expect(column.map((t) => t.position)).toEqual([1, 2, 3])
    expect(b.position).toBe(2)
  })
})
