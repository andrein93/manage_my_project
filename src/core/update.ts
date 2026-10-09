import { execFileSync } from 'node:child_process'

export interface GitState {
  isRepo: boolean
  branch: string | null
  upstream: string | null
  /** Uncommitted changes to tracked files (untracked files do not count). */
  dirty: boolean
  ahead: number
  behind: number
}

export type UpdatePlan = { kind: 'refuse'; reason: string } | { kind: 'up-to-date' } | { kind: 'update'; commits: number }

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** What `mmp update` may do: only fast-forward a clean checkout that tracks a remote branch. */
export function planUpdate(s: GitState): UpdatePlan {
  if (!s.isRepo) return { kind: 'refuse', reason: 'mmp was not installed from git; reinstall it from the repository to update.' }
  if (!s.branch || !s.upstream) return { kind: 'refuse', reason: `branch ${s.branch ?? '(detached HEAD)'} has no upstream; set one or update by hand.` }
  if (s.dirty) return { kind: 'refuse', reason: 'you have local changes; commit or stash them first.' }
  if (s.ahead > 0) return { kind: 'refuse', reason: `this install has ${plural(s.ahead, 'local commit')} not on ${s.upstream}; push or reset them before updating.` }
  if (s.behind === 0) return { kind: 'up-to-date' }
  return { kind: 'update', commits: s.behind }
}

function git(dir: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim()
  } catch {
    return null
  }
}

export function inspectGit(dir: string, options: { fetch?: boolean } = {}): GitState {
  if (git(dir, ['rev-parse', '--show-toplevel']) === null) {
    return { isRepo: false, branch: null, upstream: null, dirty: false, ahead: 0, behind: 0 }
  }
  const branch = git(dir, ['symbolic-ref', '--short', '-q', 'HEAD']) || null
  const upstream = branch ? git(dir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']) : null
  const dirty = (git(dir, ['status', '--porcelain', '--untracked-files=no']) ?? '') !== ''
  if (!upstream) return { isRepo: true, branch, upstream: null, dirty, ahead: 0, behind: 0 }
  if (options.fetch) git(dir, ['fetch', '--quiet'])
  const [ahead, behind] = (git(dir, ['rev-list', '--left-right', '--count', 'HEAD...@{u}']) ?? '0\t0').split(/\s+/).map(Number)
  return { isRepo: true, branch, upstream, dirty, ahead: ahead || 0, behind: behind || 0 }
}
