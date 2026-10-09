import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildServer } from '../src/server/index.js'
import { createFixture, type Fixture } from './helpers.js'

let fx: Fixture
const at = (day: string, time: string) => new Date(`${day}T${time}`).getTime()
// "now" for validation: heartbeats must be recent.
const NOW = at('2026-10-02', '18:00')

beforeEach(async () => {
  fx = createFixture({ 'shop/composer.json': '{}', 'blog/index.html': '' })
  await fx.app.scan()
  // Claude Code worked on shop 09:00–09:30 on Oct 2.
  const dir = join(fx.root, '.claude-projects')
  mkdirSync(dir)
  const line = (time: string) =>
    JSON.stringify({ type: 'user', timestamp: new Date(`2026-10-02T${time}`).toISOString(), cwd: join(fx.root, 'shop'), sessionId: 's1' })
  writeFileSync(join(dir, 's1.jsonl'), [line('09:00'), line('09:15'), line('09:30')].join('\n') + '\n')
  fx.app.settings.update({ claudeProjectsDir: dir })
  await fx.app.time.sync()
})
afterEach(() => fx.cleanup())

const day = { from: '2026-10-02', to: '2026-10-02' }
const shopMinutes = () => fx.app.time.repo.report(day, 'project').rows.find((r) => r.label === 'shop')?.minutes ?? 0

describe('editor time', () => {
  it('counts editing minutes for the project that contains the folder', () => {
    const before = shopMinutes()
    for (let m = 0; m <= 20; m += 2) fx.app.time.recordEditor(join(fx.root, 'shop', 'src'), at('2026-10-02', `14:${String(m).padStart(2, '0')}`), NOW)
    const added = shopMinutes() - before
    expect(added).toBeGreaterThanOrEqual(20)
    expect(added).toBeLessThanOrEqual(22)
    const blocks = fx.app.time.repo.blocks(fx.app.projects.resolve('shop').id, day)
    expect(blocks.some((b) => b.sources.includes('editor'))).toBe(true)
  })

  it('does not double count minutes Claude Code already covers', () => {
    const before = shopMinutes()
    for (let m = 5; m <= 25; m += 5) fx.app.time.recordEditor(join(fx.root, 'shop'), at('2026-10-02', `09:${String(m).padStart(2, '0')}`), NOW)
    expect(shopMinutes()).toBe(before)
  })

  it('rejects relative paths and stale or future heartbeats; repeats in a minute are ignored', () => {
    expect(() => fx.app.time.recordEditor('shop/src', NOW, NOW)).toThrow(/absolute/)
    expect(() => fx.app.time.recordEditor(join(fx.root, 'shop'), NOW - 2 * 86_400_000, NOW)).toThrow(/too old/)
    expect(() => fx.app.time.recordEditor(join(fx.root, 'shop'), NOW + 10 * 60_000, NOW)).toThrow(/future/)
    expect(fx.app.time.recordEditor(join(fx.root, 'blog'), NOW, NOW)).toBe(true)
    expect(fx.app.time.recordEditor(join(fx.root, 'blog'), NOW + 5_000, NOW)).toBe(false)
  })

  it('HTTP: POST /api/time/heartbeat', async () => {
    const server = await buildServer(fx.app, { webDir: join(fx.root, 'no-web') })
    const post = (payload: unknown) =>
      server.inject({ method: 'POST', url: '/api/time/heartbeat', headers: { 'content-type': 'application/json' }, payload: payload as never })
    expect((await post({ path: join(fx.root, 'blog') })).statusCode).toBe(204)
    expect((await post({ path: 'relative' })).statusCode).toBe(400)
    expect((await post({})).statusCode).toBe(400)
    expect((await post({ path: join(fx.root, 'blog'), at: new Date().toISOString().replace('Z', '+00:00') })).statusCode).toBe(204)
    await server.close()
  })
})
