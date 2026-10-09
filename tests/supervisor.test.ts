import { describe, expect, it } from 'vitest'
import { createSupervisor, type ChildHandle, type Stamp } from '../src/cli/supervisor.js'

interface FakeChild {
  first: boolean
  killed: boolean
  forced: boolean
  exit: (code: number | null) => void
}

function harness(initial: Stamp | null = { id: 'a', version: '0.6.0' }) {
  let time = 0
  let stamp = initial
  const children: FakeChild[] = []
  const timers: { at: number; fn: () => void; id: number }[] = []
  const logs: string[] = []
  let nextTimer = 1
  const sup = createSupervisor({
    spawnChild(first) {
      let onExit: (code: number | null) => void = () => {}
      const c: FakeChild = { first, killed: false, forced: false, exit: (code) => onExit(code) }
      children.push(c)
      const handle: ChildHandle = {
        kill: (force) => {
          c.killed = true
          c.forced ||= !!force
        },
        onExit: (fn) => {
          onExit = fn
        },
      }
      return handle
    },
    readStamp: () => stamp,
    log: (line) => logs.push(line),
    now: () => time,
    setTimer: (fn, ms) => {
      const id = nextTimer++
      timers.push({ at: time + ms, fn, id })
      return id
    },
    clearTimer: (id) => {
      const i = timers.findIndex((t) => t.id === id)
      if (i >= 0) timers.splice(i, 1)
    },
  })
  const advance = (ms: number) => {
    time += ms
    for (const t of timers.filter((t) => t.at <= time)) {
      timers.splice(timers.indexOf(t), 1)
      t.fn()
    }
  }
  return { sup, children, logs, advance, setStamp: (s: Stamp | null) => (stamp = s) }
}

describe('supervisor', () => {
  it('starts one child, marked as the first', () => {
    const h = harness()
    h.sup.start()
    expect(h.children).toHaveLength(1)
    expect(h.children[0].first).toBe(true)
  })

  it('restarts on a new stamp: stop first, then start', () => {
    const h = harness()
    h.sup.start()
    h.advance(20_000)
    h.setStamp({ id: 'b', version: '0.7.0' })
    h.sup.check()
    expect(h.children[0].killed).toBe(true)
    expect(h.children).toHaveLength(1)
    h.children[0].exit(0)
    expect(h.children).toHaveLength(2)
    expect(h.children[1].first).toBe(false)
    expect(h.logs.join('\n')).toContain('0.6.0 → 0.7.0')
  })

  it('ignores an unchanged or missing stamp', () => {
    const h = harness()
    h.sup.start()
    h.sup.check()
    h.setStamp(null)
    h.sup.check()
    expect(h.children[0].killed).toBe(false)
  })

  it('two quick stamps end with one child on the newest build', () => {
    const h = harness()
    h.sup.start()
    h.advance(20_000)
    h.setStamp({ id: 'b', version: '0.7.0' })
    h.sup.check()
    h.setStamp({ id: 'c', version: '0.7.1' })
    h.sup.check()
    h.children[0].exit(0)
    expect(h.children).toHaveLength(2)
    h.advance(20_000)
    h.sup.check()
    expect(h.children).toHaveLength(2)
    expect(h.children[1].killed).toBe(false)
  })

  it('forces the kill after the timeout', () => {
    const h = harness()
    h.sup.start()
    h.advance(20_000)
    h.setStamp({ id: 'b', version: '0.7.0' })
    h.sup.check()
    h.advance(5_000)
    expect(h.children[0].forced).toBe(true)
  })

  it('a child failing at startup waits for the next stamp', () => {
    const h = harness()
    h.sup.start()
    h.advance(2_000)
    h.children[0].exit(1)
    h.advance(60_000)
    expect(h.children).toHaveLength(1)
    expect(h.logs.join('\n')).toMatch(/failed to start/)
    h.setStamp({ id: 'b', version: '0.7.0' })
    h.sup.check()
    expect(h.children).toHaveLength(2)
  })

  it('a late crash restarts once after 1 s', () => {
    const h = harness()
    h.sup.start()
    h.advance(60_000)
    h.children[0].exit(1)
    expect(h.children).toHaveLength(1)
    h.advance(1_000)
    expect(h.children).toHaveLength(2)
  })

  it('stop kills the child, resolves with its code and spawns nothing more', async () => {
    const h = harness()
    h.sup.start()
    h.advance(60_000)
    const done = h.sup.stop()
    expect(h.children[0].killed).toBe(true)
    h.children[0].exit(0)
    expect(await done).toBe(0)
    h.setStamp({ id: 'b', version: '0.7.0' })
    h.sup.check()
    h.advance(60_000)
    expect(h.children).toHaveLength(1)
  })

  it('stop during a pending crash restart cancels it', async () => {
    const h = harness()
    h.sup.start()
    h.advance(60_000)
    h.children[0].exit(1)
    const done = h.sup.stop()
    expect(await done).toBe(1)
    h.advance(5_000)
    expect(h.children).toHaveLength(1)
  })

  it('stop while a restart is in progress does not spawn the new build', async () => {
    const h = harness()
    h.sup.start()
    h.advance(20_000)
    h.setStamp({ id: 'b', version: '0.7.0' })
    h.sup.check()
    const done = h.sup.stop()
    h.children[0].exit(0)
    expect(await done).toBe(0)
    expect(h.children).toHaveLength(1)
  })
})
