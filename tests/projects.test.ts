import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFixture, type Fixture } from './helpers.js'

let fx: Fixture
beforeEach(() => {
  fx = createFixture({ 'alpha/index.php': '', 'beta/package.json': '{}', 'nested/deep/x.txt': '' })
})
afterEach(() => fx.cleanup())

const days = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

describe('ProjectRepository', () => {
  it('inserts, updates user fields and edits tags', () => {
    const { projects } = fx.app
    const p = projects.insert({ path: join(fx.root, 'alpha'), source: 'manual', workspaceId: null, stack: ['php'], git: null, lastActivityAt: null })
    expect(p.name).toBe('alpha')
    expect(p.status).toBe('active')

    const updated = projects.update(p.id, { name: 'Alpha site', description: 'Client site', status: 'paused' })
    expect(updated).toMatchObject({ name: 'Alpha site', description: 'Client site', status: 'paused' })

    expect(projects.editTags(p.id, [' Client ', 'php'], []).tags).toEqual(['client', 'php'])
    expect(projects.editTags(p.id, [], ['php']).tags).toEqual(['client'])
    expect(projects.setTags(p.id, ['new']).tags).toEqual(['new'])
    expect(projects.allTags()).toEqual(['new'])
  })

  it('rejects invalid updates', () => {
    const p = fx.app.projects.insert({ path: join(fx.root, 'alpha'), source: 'manual', workspaceId: null, stack: [], git: null, lastActivityAt: null })
    expect(() => fx.app.projects.update(p.id, { name: '  ' })).toThrow(/empty/)
    expect(() => fx.app.projects.update(p.id, { status: 'nope' as never })).toThrow(/Invalid status/)
    expect(() => fx.app.projects.update('missing', {})).toThrow(/not found/)
  })

  it('filters by status, stack, tag, inactivity and query', () => {
    const { projects } = fx.app
    const a = projects.insert({ path: join(fx.root, 'alpha'), source: 'scan', workspaceId: null, stack: ['php'], git: null, lastActivityAt: days(200) })
    const b = projects.insert({ path: join(fx.root, 'beta'), source: 'scan', workspaceId: null, stack: ['node'], git: null, lastActivityAt: days(1) })
    projects.editTags(a.id, ['client'])
    projects.update(b.id, { status: 'archived', description: 'old shop' })

    const names = (f: Parameters<typeof projects.list>[0]) => projects.list(f).map((p) => p.name)
    expect(names({})).toEqual(['alpha'])
    expect(names({ all: true })).toEqual(['alpha', 'beta'])
    expect(names({ status: ['archived'] })).toEqual(['beta'])
    expect(names({ all: true, stack: 'NODE' })).toEqual(['beta'])
    expect(names({ all: true, tag: 'client' })).toEqual(['alpha'])
    expect(names({ all: true, inactiveDays: 90 })).toEqual(['alpha'])
    expect(names({ all: true, query: 'shop' })).toEqual(['beta'])
  })

  it('resolves refs by id, path and name, and finds the containing project', () => {
    const { projects } = fx.app
    const p = projects.insert({ path: join(fx.root, 'nested'), source: 'manual', workspaceId: null, stack: [], git: null, lastActivityAt: null })
    expect(projects.resolve(p.id).id).toBe(p.id)
    expect(projects.resolve(join(fx.root, 'nested') + '/').id).toBe(p.id)
    expect(projects.resolve('NESTED').id).toBe(p.id)
    expect(() => projects.resolve('nope')).toThrow(/not found/)

    expect(projects.findContaining(join(fx.root, 'nested', 'deep', 'x.txt'))?.id).toBe(p.id)
    expect(projects.findContaining(join(fx.root, 'nestedish'))).toBeNull()
  })

  it('reports ambiguous names', () => {
    const { projects } = fx.app
    const a = projects.insert({ path: join(fx.root, 'alpha'), source: 'manual', workspaceId: null, stack: [], git: null, lastActivityAt: null })
    const b = projects.insert({ path: join(fx.root, 'beta'), source: 'manual', workspaceId: null, stack: [], git: null, lastActivityAt: null })
    projects.update(a.id, { name: 'Same' })
    projects.update(b.id, { name: 'same' })
    expect(() => projects.resolve('same')).toThrow(/matches 2 projects/)
  })
})

describe('SettingsRepository', () => {
  it('returns defaults and persists ignore names', () => {
    expect(fx.app.settings.get().ignoreNames).toContain('node_modules')
    expect(fx.app.settings.update({ ignoreNames: [' tmp ', 'tmp', 'old'] }).ignoreNames).toEqual(['tmp', 'old'])
    expect(() => fx.app.settings.update({ ignoreNames: 'x' as never })).toThrow()
  })
})
