import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

const SKIP = new Set(['node_modules', 'vendor', '.git'])

/** Latest of the last commit date and the newest mtime among top-level entries. */
export async function lastActivity(dir: string, lastCommitAt: string | null): Promise<string | null> {
  let latest = lastCommitAt ? Date.parse(lastCommitAt) : 0
  for (const name of await readdir(dir)) {
    if (SKIP.has(name)) continue
    try {
      latest = Math.max(latest, (await stat(join(dir, name))).mtimeMs)
    } catch {
      // Broken symlinks or permission errors: ignore the entry.
    }
  }
  return latest > 0 ? new Date(latest).toISOString() : null
}
