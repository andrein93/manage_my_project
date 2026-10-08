import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { localToday } from '../src/core/dates.js'
import { createFixture, gitInit, hasGit, type Fixture } from './helpers.js'

let fx: Fixture
let claudeDir: string

const DAY = '2026-10-01'
const range = { from: DAY, to: DAY }
const iso = (time: string, day = DAY) => new Date(`${day}T${time}`).toISOString() // local time → ISO

const msg = (type: 'user' | 'assistant', time: string, cwd: string, sessionId: string, day = DAY) =>
  JSON.stringify({ type, timestamp: iso(time, day), cwd, sessionId, message: { content: 'not stored' } }) + '\n'
const cost = (sessionId: string, usd: number) =>
  JSON.stringify({ type: 'cost-state', sessionId, totalCostUSD: usd, modelUsage: { 'claude-x': { costUSD: usd } } }) + '\n'

beforeEach(async () => {
  fx = createFixture({ 'shop/composer.json': '{}', 'blog/index.html': '' })
  await fx.app.scan()
  claudeDir = join(fx.root, '.claude-projects')
  mkdirSync(join(claudeDir, 'shop-proj', 's2', 'subagents'), { recursive: true })
  fx.app.settings.update({ claudeProjectsDir: claudeDir })
})
afterEach(() => fx.cleanup())

const shop = () => join(fx.root, 'shop')
const blog = () => join(fx.root, 'blog')
const outside = () => join(fx.root, 'mmp', 'scratch') // inside the install dir: never a project

function writeTranscripts() {
  writeFileSync(
    join(claudeDir, 'shop-proj', 's1.jsonl'),
    msg('user', '10:00', shop(), 's1') +
      msg('assistant', '10:05', join(shop(), 'src'), 's1') +
      cost('s1', 1.5) +
      msg('assistant', '10:10', shop(), 's1') +
      cost('s1', 3) +
      '{"type":"user", broken json\n' +
      JSON.stringify({ type: 'attachment', timestamp: iso('10:30'), cwd: shop() }) + '\n',
  )
  writeFileSync(join(claudeDir, 'shop-proj', 's2', 'subagents', 'agent-1.jsonl'), msg('assistant', '11:00', blog(), 's2'))
  writeFileSync(join(claudeDir, 'shop-proj', 's3.jsonl'), msg('user', '12:00', outside(), 's3') + cost('s3', 0.5))
}

describe('transcript import', () => {
  it('imports signals, costs and subagents, and skips malformed lines', async () => {
    writeTranscripts()
    const result = await fx.app.time.sync()
    expect(result).toMatchObject({ claudeDirFound: true, files: 3, filesRead: 3, skippedLines: 1, errors: [] })
    expect(result.signals).toBe(5)

    const report = fx.app.time.repo.report(range, 'project')
    expect(report.rows.map((r) => [r.label, r.minutes, r.costUsd])).toEqual([
      ['shop', 12, 3],
      ['blog', 2, 0],
    ])
    expect(report.unassigned).toEqual([{ cwd: outside(), minutes: 2, costUsd: 0.5 }])
    expect(report.totals).toMatchObject({ minutes: 16, autoMinutes: 16, manualMinutes: 0, costUsd: 3.5 })
  })

  it('reads incrementally and waits for incomplete lines', async () => {
    writeTranscripts()
    await fx.app.time.sync()
    expect((await fx.app.time.sync()).filesRead).toBe(0)

    const file = join(claudeDir, 'shop-proj', 's1.jsonl')
    const line = msg('user', '10:20', shop(), 's1')
    appendFileSync(file, line.slice(0, 20))
    expect((await fx.app.time.sync()).signals).toBe(0)
    appendFileSync(file, line.slice(20))
    expect((await fx.app.time.sync()).signals).toBe(1)
    expect(fx.app.time.repo.report(range).rows[0]).toMatchObject({ label: 'shop', minutes: 22 })
  })

  it('re-reads truncated files without duplicating signals', async () => {
    writeTranscripts()
    await fx.app.time.sync()
    writeFileSync(join(claudeDir, 'shop-proj', 's1.jsonl'), msg('user', '10:00', shop(), 's1'))
    const result = await fx.app.time.sync()
    expect(result.filesRead).toBe(1)
    expect(result.signals).toBe(0)
  })

  it('re-attributes unassigned history when the folder becomes a project', async () => {
    writeTranscripts()
    await fx.app.time.sync()
    mkdirSync(outside(), { recursive: true })
    await fx.app.addProject(outside())
    const report = fx.app.time.repo.report(range)
    expect(report.unassigned).toEqual([])
    expect(report.rows.find((r) => r.label === 'scratch')).toMatchObject({ minutes: 2, costUsd: 0.5 })
  })

  it('reports a missing transcripts folder without failing', async () => {
    fx.app.settings.update({ claudeProjectsDir: join(fx.root, 'nope') })
    expect(await fx.app.time.sync()).toMatchObject({ claudeDirFound: false, files: 0, errors: [] })
  })

  it.runIf(hasGit)('imports commits by the local git user only', async () => {
    gitInit(shop())
    execFileSync('git', ['-C', shop(), 'config', 'user.email', 't@example.com'])
    execFileSync('git', ['-C', shop(), '-c', 'user.name=Other', '-c', 'user.email=other@example.com', 'commit', '-q', '--allow-empty', '-m', 'x', '--date', '2020-01-01T10:00:00'])
    const result = await fx.app.time.sync()
    expect(result.commits).toBe(1)
    const today = localToday()
    expect(fx.app.time.repo.report({ from: today, to: today }).rows[0]).toMatchObject({ label: 'shop', minutes: 2 })
    expect((await fx.app.time.sync()).commits).toBe(0)
  })
})

describe('time reports and manual entries', () => {
  beforeEach(async () => {
    writeTranscripts()
    await fx.app.time.sync()
  })

  it('adds manual entries and groups by client, category and day', () => {
    const acme = fx.app.clients.create({ name: 'Acme' })
    const work = fx.app.categories.resolve('Client work')
    fx.app.projects.update(fx.app.projects.resolve('shop').id, { clientId: acme.id, categoryId: work.id })
    const entry = fx.app.time.repo.addEntry({ projectId: fx.app.projects.resolve('blog').id, date: DAY, minutes: '1h', note: 'Call' })
    expect(entry).toMatchObject({ minutes: 60, note: 'Call', projectName: 'blog' })

    const byClient = fx.app.time.repo.report(range, 'client')
    expect(byClient.rows.map((r) => [r.label, r.minutes])).toEqual([
      ['No client', 62],
      ['Acme', 12],
    ])
    expect(byClient.totals).toMatchObject({ minutes: 76, manualMinutes: 60 })
    expect(fx.app.time.repo.report(range, 'category').rows[1]).toMatchObject({ label: 'Client work', color: work.color })
    expect(fx.app.time.repo.report({ from: '2026-09-30', to: DAY }, 'day').rows.map((r) => r.minutes)).toEqual([0, 76])

    const filtered = fx.app.time.repo.report(range, 'project', { clientId: acme.id })
    expect(filtered.rows.map((r) => r.label)).toEqual(['shop'])
    expect(filtered.unassigned).toEqual([])
    expect(filtered.totals.minutes).toBe(12)
  })

  it('validates, updates and removes entries', () => {
    const blogId = fx.app.projects.resolve('blog').id
    expect(() => fx.app.time.repo.addEntry({ projectId: blogId, minutes: 'lots' })).toThrow(/Invalid duration/)
    expect(() => fx.app.time.repo.addEntry({ projectId: 'nope', minutes: 30 })).toThrow(/Project not found/)
    expect(() => fx.app.time.repo.addEntry({ projectId: blogId, minutes: 30, date: '2026-13-01' })).toThrow(/Invalid date/)
    const entry = fx.app.time.repo.addEntry({ projectId: blogId, minutes: 30, date: DAY })
    expect(fx.app.time.repo.updateEntry(entry.id, { minutes: '45m' }).minutes).toBe(45)
    expect(fx.app.time.repo.resolveEntry(entry.id.slice(0, 8)).id).toBe(entry.id)
    fx.app.time.repo.removeEntry(entry.id)
    expect(fx.app.time.repo.entries(range)).toEqual([])
  })

  it('lists work blocks of a project, newest first', () => {
    const blocks = fx.app.time.repo.blocks(fx.app.projects.resolve('shop').id, range)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ minutes: 12, sources: ['claude'], sessionIds: ['s1'] })
  })

  it('applies the idle threshold setting', () => {
    fx.app.settings.update({ idleMinutes: 5 })
    expect(fx.app.time.repo.report(range).rows[0]).toMatchObject({ label: 'shop', minutes: 12 })
    fx.app.time.repo.addEntry({ projectId: fx.app.projects.resolve('shop').id, date: DAY, minutes: 1 })
    expect(() => fx.app.settings.update({ idleMinutes: 2 })).toThrow(/between 5 and 120/)
  })
})
