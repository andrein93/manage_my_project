import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildCli } from '../src/cli/index.js'
import { relativeTime } from '../src/cli/format.js'
import { createFixture, type Fixture } from './helpers.js'

let fx: Fixture
let output: string[]

beforeEach(() => {
  fx = createFixture({ 'shop/composer.json': '{}', 'blog/index.html': '' })
  output = []
})
afterEach(() => fx.cleanup())

async function mmp(...args: string[]) {
  const cli = buildCli(() => fx.app, (line) => output.push(line))
  cli.exitOverride()
  await cli.parseAsync(['node', 'mmp', ...args])
  return output.join('\n')
}

describe('CLI', () => {
  it('scans and lists', async () => {
    expect(await mmp('scan')).toMatch(/Scanned 2 projects .* 2 added/)
    output = []
    const list = await mmp('list')
    expect(list).toMatch(/^NAME\s+STATUS\s+CLIENT\s+CATEGORY\s+STACK/)
    expect(list).toMatch(/shop\s+active\s+-\s+-\s+php/)
    expect(list).toContain('2 project(s)')
  })

  it('sets fields, tags and shows a project', async () => {
    await mmp('scan')
    await mmp('set', 'shop', '--status', 'archived', '--description', 'Old client')
    await mmp('tag', 'shop', '--add', 'client', 'php')
    output = []
    const shown = await mmp('show', 'shop')
    expect(shown).toMatch(/Status\s+archived/)
    expect(shown).toMatch(/About\s+Old client/)
    expect(shown).toMatch(/Tags\s+client, php/)

    output = []
    expect(await mmp('list')).not.toContain('shop')
    output = []
    expect(await mmp('list', '--all', '--json')).toContain('"name": "shop"')
  })

  it('formats relative times', () => {
    const now = Date.parse('2026-10-07T12:00:00Z')
    expect(relativeTime(null)).toBe('-')
    expect(relativeTime('2026-10-07T08:00:00Z', now)).toBe('today')
    expect(relativeTime('2026-10-01T12:00:00Z', now)).toBe('6d ago')
    expect(relativeTime('2026-06-01T12:00:00Z', now)).toBe('4mo ago')
    expect(relativeTime('2024-01-01T12:00:00Z', now)).toBe('2y ago')
  })
})
