import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { readGit } from '../src/core/detect/git.js'
import { detectStack } from '../src/core/detect/stack.js'
import { createFixture, gitInit, hasGit } from './helpers.js'

const fx = createFixture({
  'laravel-app/artisan': '',
  'laravel-app/composer.json': '{}',
  'laravel-app/package.json': JSON.stringify({ devDependencies: { vue: '^3' } }),
  'wp/wp-config.php': '',
  'next-app/package.json': JSON.stringify({ dependencies: { next: '1', react: '1' } }),
  'broken/package.json': '{not json',
  'py/pyproject.toml': '',
  'site/index.html': '',
  'plain-php/index.php': '',
  'empty/': '',
})
afterAll(() => fx.cleanup())

describe('detectStack', () => {
  it.each([
    ['laravel-app', ['laravel', 'php', 'node', 'vue']],
    ['wp', ['wordpress', 'php']],
    ['next-app', ['node', 'next', 'react']],
    ['broken', ['node']],
    ['py', ['python']],
    ['site', ['static']],
    ['plain-php', ['php']],
    ['empty', []],
  ])('%s → %j', async (dir, expected) => {
    expect(await detectStack(join(fx.root, dir))).toEqual(expected)
  })
})

describe.runIf(hasGit)('readGit', () => {
  it('returns null for a folder without .git', async () => {
    expect(await readGit(join(fx.root, 'wp'))).toBeNull()
  })

  it('reads branch, remote, last commit and dirty state', async () => {
    const dir = join(fx.root, 'py')
    gitInit(dir)
    const clean = await readGit(dir)
    expect(clean).toMatchObject({ branch: 'main', remote: 'https://example.com/repo.git', dirty: false })
    expect(Date.parse(clean!.lastCommitAt!)).toBeGreaterThan(Date.now() - 60_000)

    fx.write({ 'py/new.txt': 'x' })
    expect((await readGit(dir))!.dirty).toBe(true)
  })
})
