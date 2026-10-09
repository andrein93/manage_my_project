import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

// The extension is plain CommonJS (no build step); load it the way VS Code does.
const require = createRequire(import.meta.url)
const { createHeartbeat } = require('../vscode-extension/heartbeat.js') as {
  createHeartbeat: (o: { send: (folder: string) => Promise<void>; now: () => number; minIntervalMs?: number; offlineRetryMs?: number }) => {
    activity(folder: string | null | undefined): boolean
    status(): 'idle' | 'ok' | 'offline'
  }
}

function setup(fail = false) {
  let time = 0
  const sent: string[] = []
  let failing = fail
  const hb = createHeartbeat({
    now: () => time,
    send: async (folder) => {
      if (failing) throw new Error('ECONNREFUSED')
      sent.push(folder)
    },
  })
  const flush = () => new Promise((r) => setTimeout(r, 0))
  return { hb, sent, flush, advance: (ms: number) => (time += ms), setFailing: (v: boolean) => (failing = v) }
}

describe('editor heartbeat', () => {
  it('sends at most once a minute per folder', async () => {
    const t = setup()
    expect(t.hb.status()).toBe('idle')
    expect(t.hb.activity('/w/shop')).toBe(true)
    expect(t.hb.activity('/w/shop')).toBe(false)
    t.advance(30_000)
    expect(t.hb.activity('/w/shop')).toBe(false)
    expect(t.hb.activity('/w/blog')).toBe(true)
    t.advance(30_000)
    expect(t.hb.activity('/w/shop')).toBe(true)
    await t.flush()
    expect(t.sent).toEqual(['/w/shop', '/w/blog', '/w/shop'])
    expect(t.hb.status()).toBe('ok')
  })

  it('ignores activity without a folder', () => {
    const t = setup()
    expect(t.hb.activity(undefined)).toBe(false)
    expect(t.hb.activity('')).toBe(false)
  })

  it('goes quiet for 5 minutes when mmp is not running, then retries', async () => {
    const t = setup(true)
    t.hb.activity('/w/shop')
    await t.flush()
    expect(t.hb.status()).toBe('offline')
    t.advance(2 * 60_000)
    expect(t.hb.activity('/w/shop')).toBe(false)
    t.setFailing(false)
    t.advance(3 * 60_000)
    expect(t.hb.activity('/w/shop')).toBe(true)
    await t.flush()
    expect(t.hb.status()).toBe('ok')
    expect(t.sent).toEqual(['/w/shop'])
  })
})
