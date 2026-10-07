import { mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFixture, gitInit, hasGit, type Fixture } from './helpers.js'

let fx: Fixture
beforeEach(() => {
  fx = createFixture({
    'shop/composer.json': '{}',
    'shop/artisan': '',
    'blog/package.json': JSON.stringify({ dependencies: { vue: '3' } }),
    '.hidden/x': '',
    'node_modules/x': '',
    'dump.sql': 'select 1',
    'mmp/package.json': '{}',
  })
})
afterEach(() => fx.cleanup())

const names = (fx: Fixture) => fx.app.projects.list({ all: true }).map((p) => p.name)

describe('scan', () => {
  it('uses the parent of the install dir as default workspace', () => {
    expect(fx.app.workspaces.list().map((w) => w.path)).toEqual([fx.root])
  })

  it('registers child folders, skipping files, hidden, ignored and mmp itself', async () => {
    const result = await fx.app.scan()
    expect(result).toMatchObject({ added: 2, updated: 0, total: 2, errors: [] })
    expect(names(fx)).toEqual(['blog', 'shop'])
    expect(fx.app.projects.resolve('shop').stack).toEqual(['laravel', 'php'])
    expect(fx.app.projects.resolve('blog').lastActivityAt).not.toBeNull()
  })

  it('keeps user fields on rescan and only refreshes detected ones', async () => {
    await fx.app.scan()
    const shop = fx.app.projects.resolve('shop')
    fx.app.projects.update(shop.id, { name: 'My Shop', description: 'desc', status: 'paused' })
    fx.write({ 'shop/package.json': '{}' })

    const result = await fx.app.scan()
    expect(result).toMatchObject({ added: 0, updated: 2 })
    expect(fx.app.projects.get(shop.id)).toMatchObject({
      name: 'My Shop',
      description: 'desc',
      status: 'paused',
      stack: ['laravel', 'php', 'node'],
    })
  })

  it('marks vanished folders as missing and restores them when they come back', async () => {
    await fx.app.scan()
    const blog = fx.app.projects.resolve('blog')
    renameSync(join(fx.root, 'blog'), join(fx.root, '.blog-away'))

    expect(await fx.app.scan()).toMatchObject({ missing: 1, added: 0 })
    expect(fx.app.projects.get(blog.id)!.missingSince).not.toBeNull()

    renameSync(join(fx.root, '.blog-away'), join(fx.root, 'blog'))
    expect(await fx.app.scan()).toMatchObject({ restored: 1, added: 0 })
    expect(fx.app.projects.get(blog.id)!.missingSince).toBeNull()
  })

  it('does not resurrect ignored projects', async () => {
    await fx.app.scan()
    const blog = fx.app.projects.resolve('blog')
    fx.app.projects.update(blog.id, { status: 'ignored' })
    await fx.app.scan()
    expect(fx.app.projects.list().map((p) => p.name)).toEqual(['shop'])
    expect(fx.app.projects.get(blog.id)!.status).toBe('ignored')
  })

  it('scans additional workspaces and soft-deletes their projects on removal', async () => {
    fx.write({ 'other/clients/acme/index.html': '' })
    const ws = fx.app.workspaces.add(join(fx.root, 'other', 'clients'))
    await fx.app.scan()
    expect(names(fx)).toContain('acme')

    fx.app.workspaces.remove(ws.id)
    expect(names(fx)).not.toContain('acme')

    fx.app.workspaces.add(join(fx.root, 'other', 'clients'))
    expect(await fx.app.scan()).toMatchObject({ restored: 1, added: 0 })
    expect(names(fx)).toContain('acme')
  })

  it('adds manual projects and refuses duplicates', async () => {
    mkdirSync(join(fx.root, 'outside', 'tool'), { recursive: true })
    const p = await fx.app.addProject(join(fx.root, 'outside', 'tool'))
    expect(p.source).toBe('manual')
    await expect(fx.app.addProject(join(fx.root, 'outside', 'tool'))).rejects.toThrow(/Already registered/)
    await expect(fx.app.addProject(join(fx.root, 'nope'))).rejects.toThrow(/Not a directory/)
  })

  it.runIf(hasGit)('stores git info', async () => {
    gitInit(join(fx.root, 'shop'))
    await fx.app.scan()
    expect(fx.app.projects.resolve('shop').git).toMatchObject({ branch: 'main', dirty: false })
  })
})
