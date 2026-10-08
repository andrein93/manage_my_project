import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { GitInfo } from '../types.js'

const exec = promisify(execFile)
const TIMEOUT_MS = 15_000

/**
 * Reads git metadata for a folder that is itself a repository root. Returns null when the folder
 * has no `.git`, and `{ error: true }` when git could not be read (timeout, lock, git missing),
 * so callers never mistake a slow repository for an unversioned one.
 */
export async function readGit(dir: string): Promise<GitInfo | null> {
  if (!existsSync(join(dir, '.git'))) return null
  const failed: GitInfo = { branch: null, lastCommitAt: null, remote: null, dirty: false, unpushed: null, error: true }
  try {
    const [branch, lastCommitAt, remotes, status, upstream] = await Promise.all([
      git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']),
      git(dir, ['log', '-1', '--format=%cI']),
      git(dir, ['config', '--get-regexp', '^remote\\..*\\.url$']),
      git(dir, ['status', '--porcelain']),
      git(dir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']),
    ])
    if (status === null) return failed
    // "remote.<name>.url <url>" lines: prefer origin, else the first remote.
    const urls = (remotes ?? '')
      .split('\n')
      .map((l) => /^remote\.(.+)\.url\s+(.+)$/.exec(l.trim()))
      .filter((m): m is RegExpExecArray => !!m)
    const remote = (urls.find((m) => m[1] === 'origin') ?? urls[0])?.[2] ?? null
    let unpushed: number | null = null
    if (remote && lastCommitAt) {
      // Prefer the branch's upstream; otherwise count commits not on any remote-tracking ref.
      const count = await git(dir, upstream ? ['rev-list', '--count', '@{u}..HEAD'] : ['rev-list', '--count', 'HEAD', '--not', '--remotes'])
      unpushed = count !== null && /^\d+$/.test(count) ? Number(count) : null
    }
    return {
      branch: branch || null,
      lastCommitAt: lastCommitAt ? new Date(lastCommitAt).toISOString() : null,
      remote,
      dirty: status.length > 0,
      unpushed,
    }
  } catch {
    return failed
  }
}

/** Runs a read-only git command; returns trimmed stdout or null on failure. */
async function git(dir: string, args: string[]): Promise<string | null> {
  try {
    // safe.directory=* avoids "dubious ownership" refusals; every command here is read-only.
    const { stdout } = await exec('git', ['-c', 'safe.directory=*', '-C', dir, ...args], {
      timeout: TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    })
    return stdout.trim()
  } catch {
    return null
  }
}
