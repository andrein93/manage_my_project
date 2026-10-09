import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import type { BuildInfo } from '../build-info.js'

export interface GitState {
  isRepo: boolean
  branch: string | null
  upstream: string | null
  /** Uncommitted changes to tracked files (untracked files do not count). */
  dirty: boolean
  ahead: number
  behind: number
  /** `git fetch` was requested and failed (offline, remote gone): ahead/behind may be stale. */
  fetchFailed?: boolean
  /** Committer date of HEAD (ISO), to tell whether the build is older than the code. */
  headTime?: string | null
}

export type UpdatePlan =
  | { kind: 'refuse'; reason: string }
  | { kind: 'up-to-date' }
  | { kind: 'rebuild' }
  | { kind: 'update'; commits: number }

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * What `mmp update` may do: only fast-forward a clean checkout that tracks a remote branch.
 * `stale` (the build is older than the code) turns "up to date" into a rebuild, which repairs an
 * update whose `npm install` failed after the pull.
 */
export function planUpdate(s: GitState, options: { stale?: boolean } = {}): UpdatePlan {
  if (!s.isRepo) return { kind: 'refuse', reason: 'mmp was not installed from git; reinstall it from the repository to update.' }
  if (!s.branch || !s.upstream) return { kind: 'refuse', reason: `branch ${s.branch ?? '(detached HEAD)'} has no upstream; set one or update by hand.` }
  if (s.dirty) return { kind: 'refuse', reason: 'you have local changes; commit or stash them first.' }
  if (s.fetchFailed) return { kind: 'refuse', reason: `could not reach ${s.upstream}; check your connection and try again.` }
  if (s.ahead > 0) return { kind: 'refuse', reason: `this install has ${plural(s.ahead, 'local commit')} not on ${s.upstream}; push or reset them before updating.` }
  if (s.behind > 0) return { kind: 'update', commits: s.behind }
  return options.stale ? { kind: 'rebuild' } : { kind: 'up-to-date' }
}

/** The installed build does not match the code: no stamp, another version, or commits newer than the build. */
export function buildIsStale(stamp: BuildInfo | null, version: string, headTime: string | null): boolean {
  if (!stamp || stamp.version !== version) return true
  if (!headTime) return false
  return Date.parse(headTime) > Date.parse(stamp.builtAt)
}

function git(dir: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim()
  } catch {
    return null
  }
}

function samePath(a: string, b: string): boolean {
  const real = (p: string) => {
    try {
      return realpathSync.native(resolve(p))
    } catch {
      return resolve(p)
    }
  }
  const [x, y] = [real(a), real(b)]
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y
}

const NOT_A_REPO: GitState = { isRepo: false, branch: null, upstream: null, dirty: false, ahead: 0, behind: 0 }

export function inspectGit(dir: string, options: { fetch?: boolean } = {}): GitState {
  // Only the install folder itself counts: never update an enclosing repository (dotfiles, a project…).
  const top = git(dir, ['rev-parse', '--show-toplevel'])
  if (top === null || !samePath(top, dir)) return NOT_A_REPO
  const branch = git(dir, ['symbolic-ref', '--short', '-q', 'HEAD']) || null
  const upstream = branch ? git(dir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']) : null
  const dirty = (git(dir, ['status', '--porcelain', '--untracked-files=no']) ?? '') !== ''
  const headTime = git(dir, ['log', '-1', '--format=%cI'])
  if (!upstream) return { isRepo: true, branch, upstream: null, dirty, ahead: 0, behind: 0, headTime }
  const fetchFailed = options.fetch ? git(dir, ['fetch', '--quiet']) === null : false
  const [ahead, behind] = (git(dir, ['rev-list', '--left-right', '--count', 'HEAD...@{u}']) ?? '0\t0').split(/\s+/).map(Number)
  return { isRepo: true, branch, upstream, dirty, ahead: ahead || 0, behind: behind || 0, fetchFailed, headTime }
}
