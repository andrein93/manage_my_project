import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { GitInfo } from '../types.js'

const exec = promisify(execFile)
const TIMEOUT_MS = 5000

/** Reads git metadata for a folder that is itself a repository root; null otherwise or on failure. */
export async function readGit(dir: string): Promise<GitInfo | null> {
  if (!existsSync(join(dir, '.git'))) return null
  try {
    const [branch, lastCommitAt, remote, status] = await Promise.all([
      git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']),
      git(dir, ['log', '-1', '--format=%cI']),
      git(dir, ['remote', 'get-url', 'origin']),
      git(dir, ['status', '--porcelain']),
    ])
    if (status === null) return null
    return {
      branch: branch || null,
      lastCommitAt: lastCommitAt ? new Date(lastCommitAt).toISOString() : null,
      remote: remote || null,
      dirty: status.length > 0,
    }
  } catch {
    return null
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
