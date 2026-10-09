import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildServer } from '../src/server/index.js'
import type { Opener } from '../src/server/open.js'
import { createFixture, type Fixture } from './helpers.js'

let fx: Fixture
let server: FastifyInstance
let opened: string[]

beforeEach(async () => {
  fx = createFixture({ 'shop/composer.json': '{}', 'blog/index.html': '' })
  await fx.app.scan()
  opened = []
  const opener: Opener = { folder: (p) => opened.push(`folder:${p}`), url: (u) => opened.push(`url:${u}`) }
  const webDir = join(fx.installDir, 'web')
  mkdirSync(webDir)
  writeFileSync(join(webDir, 'index.html'), '<html>dashboard</html>')
  server = await buildServer(fx.app, { opener, webDir })
})
afterEach(async () => {
  await server.close()
  fx.cleanup()
})

const json = { 'content-type': 'application/json' }
const id = (name: string) => fx.app.projects.resolve(name).id

describe('HTTP API', () => {
  it('lists projects with filters', async () => {
    const res = await server.inject({ url: '/api/projects?stack=php' })
    expect(res.statusCode).toBe(200)
    expect(res.json().map((p: { name: string }) => p.name)).toEqual(['shop'])
    expect((await server.inject({ url: '/api/projects?status=bogus' })).statusCode).toBe(400)
  })

  it('updates a project and its tags', async () => {
    const res = await server.inject({ method: 'PATCH', url: `/api/projects/${id('shop')}`, headers: json, payload: { status: 'paused', description: 'x' } })
    expect(res.json()).toMatchObject({ status: 'paused', description: 'x' })

    const tags = await server.inject({ method: 'PUT', url: `/api/projects/${id('shop')}/tags`, headers: json, payload: { tags: ['Client', 'php'] } })
    expect(tags.json().tags).toEqual(['client', 'php'])

    const bad = await server.inject({ method: 'PATCH', url: `/api/projects/${id('shop')}`, headers: json, payload: { path: '/etc' } })
    expect(bad.statusCode).toBe(400)
  })

  it('returns 404 for unknown projects', async () => {
    expect((await server.inject({ url: '/api/projects/nope' })).statusCode).toBe(404)
  })

  it('opens folders and VS Code only for registered projects', async () => {
    const res = await server.inject({ method: 'POST', url: `/api/projects/${id('shop')}/open`, headers: json, payload: { target: 'vscode' } })
    expect(res.statusCode).toBe(204)
    expect(opened[0]).toMatch(/^url:vscode:\/\/file\/.*shop$/)
    await server.inject({ method: 'POST', url: `/api/projects/${id('shop')}/open`, headers: json, payload: { target: 'folder' } })
    expect(opened[1]).toBe(`folder:${join(fx.root, 'shop')}`)
  })

  it('manages workspaces and settings, and rescans', async () => {
    fx.write({ 'extra/one/index.php': '' })
    const add = await server.inject({ method: 'POST', url: '/api/workspaces', headers: json, payload: { path: join(fx.root, 'extra') } })
    expect(add.statusCode).toBe(201)
    // 'extra' itself lives in the root workspace, 'one' in the new one.
    expect(add.json().scan.added).toBe(2)
    const list = await server.inject({ url: '/api/workspaces' })
    expect(list.json()).toHaveLength(2)
    expect((await server.inject({ method: 'DELETE', url: `/api/workspaces/${add.json().workspace.id}` })).statusCode).toBe(204)

    const settings = await server.inject({ method: 'PUT', url: '/api/settings', headers: json, payload: { ignoreNames: ['tmp'] } })
    expect(settings.json().ignoreNames).toEqual(['tmp'])
    expect((await server.inject({ method: 'POST', url: '/api/scan', headers: json, payload: {} })).json().total).toBe(3)

    const meta = await server.inject({ url: '/api/meta' })
    expect(meta.json()).toMatchObject({ stacks: ['php', 'static'], counts: { active: 3 } })
  })

  it('exposes the build stamp id in meta', async () => {
    await server.close()
    mkdirSync(join(fx.installDir, 'dist'), { recursive: true })
    writeFileSync(join(fx.installDir, 'dist', 'build.json'), JSON.stringify({ id: 'b-42', version: '0.7.0', builtAt: 'x' }))
    server = await buildServer(fx.app, { webDir: join(fx.installDir, 'web') })
    expect((await server.inject({ url: '/api/meta' })).json().build).toBe('b-42')
  })

  it('reports no build in dev (no stamp)', async () => {
    expect((await server.inject({ url: '/api/meta' })).json().build).toBeNull()
  })

  it('adds manual projects', async () => {
    fx.write({ 'elsewhere/x/a.txt': '' })
    const res = await server.inject({ method: 'POST', url: '/api/projects', headers: json, payload: { path: join(fx.root, 'elsewhere', 'x') } })
    expect(res.statusCode).toBe(201)
    const dup = await server.inject({ method: 'POST', url: '/api/projects', headers: json, payload: { path: join(fx.root, 'elsewhere', 'x') } })
    expect(dup.statusCode).toBe(409)
  })
})

describe('security', () => {
  it('rejects foreign Host headers', async () => {
    const res = await server.inject({ url: '/api/projects', headers: { host: 'evil.example' } })
    expect(res.statusCode).toBe(403)
  })

  it('rejects non-JSON writes', async () => {
    const res = await server.inject({ method: 'POST', url: '/api/scan', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'a=1' })
    expect(res.statusCode).toBe(415)
  })

  it('serves the SPA for unknown non-API routes', async () => {
    expect((await server.inject({ url: '/projects/abc' })).body).toContain('dashboard')
    expect((await server.inject({ url: '/api/unknown' })).statusCode).toBe(404)
  })
})
