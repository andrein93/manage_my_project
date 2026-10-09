import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildIsStale, inspectGit, planUpdate, type GitState } from '../src/core/update.js'
import { hasGit } from './helpers.js'

const clean: GitState = { isRepo: true, branch: 'main', upstream: 'origin/main', dirty: false, ahead: 0, behind: 0 }

describe('planUpdate', () => {
  it('refuses outside git', () => {
    expect(planUpdate({ ...clean, isRepo: false })).toMatchObject({ kind: 'refuse', reason: expect.stringContaining('not installed from git') })
  })
  it('refuses without upstream or on a detached HEAD', () => {
    expect(planUpdate({ ...clean, upstream: null })).toMatchObject({ kind: 'refuse', reason: expect.stringContaining('no upstream') })
    expect(planUpdate({ ...clean, branch: null, upstream: null })).toMatchObject({ kind: 'refuse' })
  })
  it('refuses with local changes', () => {
    expect(planUpdate({ ...clean, dirty: true, behind: 3 })).toMatchObject({ kind: 'refuse', reason: expect.stringContaining('local changes') })
  })
  it('refuses with local commits, also when diverged', () => {
    expect(planUpdate({ ...clean, ahead: 2 })).toMatchObject({ kind: 'refuse', reason: expect.stringContaining('2 local commits') })
    expect(planUpdate({ ...clean, ahead: 1, behind: 4 })).toMatchObject({ kind: 'refuse', reason: expect.stringContaining('1 local commit ') })
  })
  it('is up to date or fast-forwards', () => {
    expect(planUpdate(clean)).toEqual({ kind: 'up-to-date' })
    expect(planUpdate({ ...clean, behind: 5 })).toEqual({ kind: 'update', commits: 5 })
  })
  it('refuses to answer when the remote could not be reached', () => {
    expect(planUpdate({ ...clean, fetchFailed: true })).toMatchObject({ kind: 'refuse', reason: expect.stringContaining('could not reach') })
  })
  it('rebuilds an up-to-date checkout whose build is stale (e.g. a previous npm install failed)', () => {
    expect(planUpdate(clean, { stale: true })).toEqual({ kind: 'rebuild' })
    expect(planUpdate({ ...clean, behind: 2 }, { stale: true })).toEqual({ kind: 'update', commits: 2 })
  })
})

describe('buildIsStale', () => {
  const stamp = { id: 'x', version: '0.7.0', builtAt: '2026-10-09T12:00:00.000Z' }
  it('is stale without a stamp, with another version or with a newer commit', () => {
    expect(buildIsStale(null, '0.7.0', '2026-10-09T11:00:00+02:00')).toBe(true)
    expect(buildIsStale(stamp, '0.8.0', '2026-10-09T11:00:00Z')).toBe(true)
    expect(buildIsStale(stamp, '0.7.0', '2026-10-09T12:30:00Z')).toBe(true)
  })
  it('is fresh when built after the last commit with the same version', () => {
    expect(buildIsStale(stamp, '0.7.0', '2026-10-09T11:59:00Z')).toBe(false)
    expect(buildIsStale(stamp, '0.7.0', null)).toBe(false)
  })
})

describe.runIf(hasGit)('inspectGit', () => {
  const dirs: string[] = []
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim()
  const identity = (dir: string) => {
    git(dir, 'config', 'user.email', 't@t')
    git(dir, 'config', 'user.name', 't')
  }

  function setup() {
    const root = mkdtempSync(join(tmpdir(), 'mmp-git-'))
    dirs.push(root)
    const remote = join(root, 'remote.git')
    const a = join(root, 'a')
    const b = join(root, 'b')
    execFileSync('git', ['init', '--bare', '-b', 'main', remote], { stdio: 'pipe' })
    execFileSync('git', ['clone', remote, a], { stdio: 'pipe' })
    identity(a)
    git(a, 'symbolic-ref', 'HEAD', 'refs/heads/main') // the clone of an empty repo may default to another branch name
    writeFileSync(join(a, 'f.txt'), '1')
    git(a, 'add', '.')
    git(a, 'commit', '-m', 'one')
    git(a, 'push', '-u', 'origin', 'main')
    execFileSync('git', ['clone', remote, b], { stdio: 'pipe' })
    identity(b)
    return { root, a, b }
  }

  it('reports a clean, up-to-date clone', () => {
    const { b } = setup()
    expect(inspectGit(b)).toMatchObject({ isRepo: true, branch: 'main', upstream: 'origin/main', dirty: false, ahead: 0, behind: 0, headTime: expect.any(String) })
  })

  it('sees commits behind after fetch, and local changes', () => {
    const { a, b } = setup()
    writeFileSync(join(a, 'f.txt'), '2')
    git(a, 'commit', '-am', 'two')
    git(a, 'push', 'origin', 'main')
    writeFileSync(join(b, 'f.txt'), 'local edit')
    expect(inspectGit(b, { fetch: true })).toMatchObject({ dirty: true, ahead: 0, behind: 1 })
  })

  it('does not treat a folder inside another repository as a git install', () => {
    const { b } = setup()
    const nested = join(b, 'node_modules', 'mmp')
    mkdirSync(nested, { recursive: true })
    expect(inspectGit(nested).isRepo).toBe(false)
  })

  it('reports a failed fetch', () => {
    const { b, root } = setup()
    rmSync(join(root, 'remote.git'), { recursive: true, force: true })
    expect(inspectGit(b, { fetch: true }).fetchFailed).toBe(true)
  })

  it('ignores untracked files and reports non-repos', () => {
    const { b, root } = setup()
    writeFileSync(join(b, 'notes.txt'), 'x')
    expect(inspectGit(b).dirty).toBe(false)
    expect(inspectGit(root).isRepo).toBe(false)
  })
})
