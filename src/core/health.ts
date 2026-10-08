import type { GitInfo, HealthFlag, ProjectStatus } from './types.js'

const DORMANT_DAYS = 90
const DAY_MS = 86_400_000

/** Things worth the user's attention for an active or paused project. */
export function healthFlags(
  p: { status: ProjectStatus; git: GitInfo | null; missingSince: string | null; lastActivityAt: string | null },
  nowMs = Date.now(),
): HealthFlag[] {
  if (p.status !== 'active' && p.status !== 'paused') return []
  if (p.missingSince) return [{ kind: 'missing' }]
  const flags: HealthFlag[] = []
  if (!p.git) flags.push({ kind: 'no_git' })
  else if (!p.git.error) {
    if (!p.git.remote) flags.push({ kind: 'no_remote' })
    else if (p.git.unpushed) flags.push({ kind: 'unpushed', count: p.git.unpushed })
    if (p.git.dirty) flags.push({ kind: 'uncommitted' })
  }
  if (p.status === 'active' && p.lastActivityAt && nowMs - Date.parse(p.lastActivityAt) > DORMANT_DAYS * DAY_MS) {
    flags.push({ kind: 'dormant' })
  }
  return flags
}
