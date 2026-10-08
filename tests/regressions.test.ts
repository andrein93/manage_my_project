import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'
import { createApp } from '../src/core/app.js'
import { openDatabase } from '../src/core/db.js'
import { buildServer, startServer } from '../src/server/index.js'
import { createFixture, type Fixture } from './helpers.js'

let fx: Fixture
beforeEach(() => {
  fx = createFixture({ 'shop/composer.json': '{}', 'blog/index.html': '', 'extra/one/index.php': '' })
})
afterEach(() => fx.cleanup())

const names = () => fx.app.projects.list({ all: true }).map((p) => p.name)

describe('review regressions', () => {
  it('does not re-add a deliberately removed default workspace on restart', () => {
    const config = loadConfig({ env: { MMP_DATA_DIR: join(fx.root, '.data') }, installDir: fx.installDir, envFile: join(fx.root, 'none') })
    const dbFile = join(fx.root, '.data', 'mmp.db')
    const first = createApp({ config, dbFile })
    first.workspaces.remove(first.workspaces.list()[0].id)
    first.close()

    const second = createApp({ config, dbFile })
    expect(second.workspaces.list()).toEqual([])
    second.close()
  })

  it('runs concurrent scans without duplicates or errors', async () => {
    const results = await Promise.all([fx.app.scan(), fx.app.scan(), fx.app.scan()])
    expect(results.flatMap((r) => r.errors)).toEqual([])
    expect(names()).toEqual(['blog', 'extra', 'shop'])
  })

  it('a scan racing a workspace removal does not resurrect its projects', async () => {
    const ws = fx.app.workspaces.add(join(fx.root, 'extra'))
    await fx.app.scan()
    expect(names()).toContain('one')

    fx.app.workspaces.remove(ws.id)
    const readd = fx.app.workspaces.add(join(fx.root, 'extra'))
    const pending = fx.app.scan()
    fx.app.workspaces.remove(readd.id)
    await pending
    expect(names()).not.toContain('one')
  })

  it('re-homes a restored project under its new origin', async () => {
    const ws = fx.app.workspaces.add(join(fx.root, 'extra'))
    await fx.app.scan()
    fx.app.workspaces.remove(ws.id)
    const project = await fx.app.addProject(join(fx.root, 'extra', 'one'))
    expect(project).toMatchObject({ source: 'manual', workspaceId: null })
  })

  it('migrates safely when two connections open the same file', () => {
    const file = join(fx.root, '.data', 'shared.db')
    const a = openDatabase(file)
    const b = openDatabase(file)
    expect((b.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n).toBe(1)
    a.close()
    b.close()
  })

  it('validates the whole PATCH before writing anything', async () => {
    await fx.app.scan()
    const server = await buildServer(fx.app, { webDir: join(fx.root, 'nope') })
    const id = fx.app.projects.resolve('shop').id
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/projects/${id}`,
      headers: { 'content-type': 'application/json' },
      payload: { name: 'Renamed', tags: ['x'.repeat(51)] },
    })
    expect(res.statusCode).toBe(400)
    expect(fx.app.projects.get(id)!.name).toBe('shop')

    const ok = await server.inject({
      method: 'PATCH',
      url: `/api/projects/${id}`,
      headers: { 'content-type': 'application/json' },
      payload: { name: 'Renamed', tags: ['client'] },
    })
    expect(ok.json()).toMatchObject({ name: 'Renamed', tags: ['client'] })
    await server.close()
  })

  it('starts a real server with background sync and stops cleanly', async () => {
    const app = createApp({ config: { ...fx.app.config, port: 0 }, dbFile: ':memory:' })
    app.settings.update({ claudeProjectsDir: join(fx.root, 'none') })
    const { server } = await startServer(app)
    expect((await server.inject({ url: '/api/time/status' })).statusCode).toBe(200)
    await server.close()
    app.close()
  })

  it('refuses to listen on a non-loopback interface', async () => {
    const app = createApp({ config: { ...fx.app.config, host: '0.0.0.0' }, dbFile: ':memory:' })
    await expect(startServer(app)).rejects.toThrow(/loopback/)
    app.close()
  })

  it('resolves bare names by name, not as paths relative to the cwd', async () => {
    await fx.app.scan()
    const shop = fx.app.projects.resolve('shop')
    fx.app.projects.update(shop.id, { name: 'blog-old' })
    expect(fx.app.projects.resolve('blog').name).toBe('blog')
    expect(fx.app.projects.resolve(join(fx.root, 'shop')).id).toBe(shop.id)
  })
})
