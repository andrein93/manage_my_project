import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildCli } from '../src/cli/index.js'
import { detectVersions, majorOf } from '../src/core/detect/versions.js'
import { healthFlags } from '../src/core/health.js'
import { digest, digestMarkdown, overview, upcoming } from '../src/core/overview.js'
import { buildServer } from '../src/server/index.js'
import { createFixture, gitInit, hasGit, TODAY, type Fixture } from './helpers.js'

let fx: Fixture
beforeEach(() => {
  fx = createFixture({
    'shop/composer.json': JSON.stringify({ require: { php: '^8.2', 'laravel/framework': '^10.10' } }),
    'shop/composer.lock': JSON.stringify({ packages: [{ name: 'laravel/framework', version: 'v10.48.2' }] }),
    'shop/artisan': '',
    'shop/package.json': JSON.stringify({ devDependencies: { vue: '^3.4.0', vite: '^5.0.0' }, engines: { node: '>=20' } }),
    'shop/package-lock.json': JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/vue': { version: '3.4.21' } } }),
    'old/composer.lock': JSON.stringify({ packages: [{ name: 'laravel/framework', version: 'v9.52.0' }] }),
    'old/composer.json': '{}',
    'wp/wp-includes/version.php': "<?php\n$wp_version = '6.4.2';\n",
    'wp/wp-config.php': '',
  })
})
afterEach(() => fx.cleanup())

describe('versions', () => {
  it('reads lockfiles and falls back to declared ranges', async () => {
    expect(await detectVersions(join(fx.root, 'shop'))).toEqual({ laravel: '10.48.2', php: '^8.2', vue: '3.4.21', vite: '5.0.0', node: '>=20' })
    expect(await detectVersions(join(fx.root, 'wp'))).toEqual({ wordpress: '6.4.2' })
    expect(majorOf('^8.2')).toBe('8')
    expect(majorOf('v10.48.2')).toBe('10')
  })

  it('filters projects by framework major version', async () => {
    await fx.app.scan()
    const names = (version: string) => fx.app.projects.list({ version }).map((p) => p.name)
    expect(names('laravel@10')).toEqual(['shop'])
    expect(names('laravel@9')).toEqual(['old'])
    expect(names('laravel')).toEqual(['old', 'shop'])
    expect(names('wordpress@6')).toEqual(['wp'])
  })
})

describe('health', () => {
  const base = { status: 'active' as const, missingSince: null, lastActivityAt: new Date().toISOString() }

  it('derives flags only for active or paused projects', () => {
    const git = { branch: 'main', lastCommitAt: null, remote: 'x', dirty: true, unpushed: 2 }
    expect(healthFlags({ ...base, git })).toEqual([{ kind: 'unpushed', count: 2 }, { kind: 'uncommitted' }])
    expect(healthFlags({ ...base, git: { ...git, remote: null, unpushed: null, dirty: false } })).toEqual([{ kind: 'no_remote' }])
    expect(healthFlags({ ...base, git: null })).toEqual([{ kind: 'no_git' }])
    expect(healthFlags({ ...base, git: null, status: 'archived' })).toEqual([])
    expect(healthFlags({ ...base, git: null, missingSince: 'x' })).toEqual([{ kind: 'missing' }])
    const old = new Date(Date.now() - 100 * 86_400_000).toISOString()
    expect(healthFlags({ ...base, git: { ...git, dirty: false, unpushed: 0 }, lastActivityAt: old })).toEqual([{ kind: 'dormant' }])
    expect(healthFlags({ ...base, git: { ...git, dirty: false, unpushed: 0 }, lastActivityAt: old, status: 'paused' })).toEqual([])
  })

  it.runIf(hasGit)('detects repos without a remote and unpushed commits', async () => {
    gitInit(join(fx.root, 'shop')) // remote "origin" exists but nothing was pushed
    gitInit(join(fx.root, 'old'))
    execFileSync('git', ['-C', join(fx.root, 'old'), 'remote', 'rename', 'origin', 'backup'])
    execFileSync('git', ['-C', join(fx.root, 'wp'), 'init', '-q'])
    await fx.app.scan()
    const flags = (name: string) => fx.app.projects.resolve(name).health
    expect(flags('shop')).toEqual([{ kind: 'unpushed', count: 1 }])
    expect(fx.app.projects.resolve('old').git?.remote).toBe('https://example.com/repo.git') // non-origin remote is found
    expect(flags('wp')).toEqual([{ kind: 'no_remote' }, { kind: 'uncommitted' }])
    expect(fx.app.projects.list({ attention: true }).map((p) => p.name)).toEqual(['old', 'shop', 'wp'])
  })
})

describe('overview and digest', () => {
  async function setup() {
    await fx.app.scan()
    const shop = fx.app.projects.resolve('shop').id
    fx.app.finance.repo.addAgreement({ projectId: shop, kind: 'recurring', amount: 120, startDate: '2026-09-20', note: 'Maintenance' })
    fx.app.finance.repo.addExpense({ amount: 15, interval: 'year', startDate: '2025-10-20', note: 'Domain shop.test', projectId: shop })
    fx.app.finance.repo.addExpense({ amount: 99, startDate: '2026-12-01', note: 'Far away' })
    const [done] = fx.app.tasks.create(shop, [{ title: 'Ship it' }, { title: 'Late', dueDate: '2026-10-01' }])
    fx.app.tasks.update(done.id, { status: 'done' })
    return shop
  }

  it('lists upcoming charges to pay and to invoice', async () => {
    await setup()
    expect(upcoming(fx.app, 30, TODAY).map((u) => [u.date, u.direction, u.label, u.amountCents])).toEqual([
      ['2026-10-20', 'invoice', 'Maintenance', 12000],
      ['2026-10-20', 'pay', 'Domain shop.test', 1500],
    ])
  })

  it('builds the overview and a weekly digest', async () => {
    await setup()
    const o = overview(fx.app, TODAY)
    expect(o.week).toMatchObject({ from: '2026-10-05', to: '2026-10-11' })
    expect(o.attention.overdueTasks.map((t) => t.title)).toEqual(['Late'])
    // Only the Sep 20 fee has accrued by today (Oct 8); Oct 20 is upcoming.
    expect(o.attention.owed).toEqual([{ clientId: 'none', clientName: 'No client', owedCents: 12000 }])
    expect(o.attention.upcoming).toHaveLength(2)
    expect(o.attention.health.map((h) => h.projectName)).toEqual(['old', 'shop', 'wp'])

    const d = digest(fx.app, 'this', TODAY)
    expect(d.overdueTasks).toBe(1)
    const md = digestMarkdown(d)
    expect(md).toContain('# Week 2026-10-05 → 2026-10-11')
    expect(md).toContain('## Needs attention')
    expect(md).toContain('- Not under git: old, shop, wp')
    expect(md).toContain('invoice 120.00 EUR — Maintenance (shop)')
  })
})

describe('interfaces', () => {
  let server: FastifyInstance
  beforeEach(async () => {
    await fx.app.scan()
    server = await buildServer(fx.app, { webDir: join(fx.root, 'no-web') })
  })
  afterEach(() => server.close())

  it('serves overview, digest, health, upcoming and version filters', async () => {
    expect((await server.inject({ url: '/api/overview' })).json().attention.health).toHaveLength(3)
    const digestRes = (await server.inject({ url: '/api/digest?week=last' })).json()
    expect(digestRes.markdown).toMatch(/^# Week /)
    expect((await server.inject({ url: '/api/health' })).json()).toHaveLength(3)
    expect((await server.inject({ url: '/api/upcoming?days=400' })).statusCode).toBe(400)
    expect((await server.inject({ url: '/api/projects?version=laravel@9' })).json().map((p: { name: string }) => p.name)).toEqual(['old'])
    const meta = (await server.inject({ url: '/api/meta' })).json()
    expect(meta.versions).toEqual(expect.arrayContaining(['laravel@9', 'laravel@10', 'vue@3', 'wordpress@6']))
    expect(meta.attention).toBe(3)
  })

  it('has CLI commands for health, digest and upcoming', async () => {
    const output: string[] = []
    const mmp = async (...args: string[]) => {
      output.length = 0
      const cli = buildCli(() => fx.app, (line) => output.push(line))
      cli.exitOverride()
      await cli.parseAsync(['node', 'mmp', ...args])
      return output.join('\n')
    }
    expect(await mmp('health')).toMatch(/shop\s+not under git/)
    expect(await mmp('digest', '--no-sync')).toMatch(/^# Week /)
    expect(await mmp('upcoming')).toBe('Nothing coming up.')
    expect(await mmp('list', '--framework', 'laravel@10')).toContain('shop')
    expect(await mmp('show', 'shop')).toMatch(/Versions\s+laravel 10\.48\.2, php \^8\.2/)
  })
})
