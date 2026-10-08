import type { Project } from '../core/types.js'

export function formatTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)))
  const line = (cells: string[]) =>
    cells
      .map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i])))
      .join('  ')
      .trimEnd()
  return [line(headers), ...rows.map(line)].join('\n')
}

export function relativeTime(iso: string | null, nowMs = Date.now()): string {
  if (!iso) return '-'
  const days = Math.floor((nowMs - Date.parse(iso)) / 86_400_000)
  if (days < 1) return 'today'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

export function formatProject(p: Project): string {
  const rows: [string, string][] = [
    ['Name', p.name],
    ['ID', p.id],
    ['Status', p.status + (p.missingSince ? ` (folder missing since ${p.missingSince.slice(0, 10)})` : '')],
    ['Path', p.path],
    ['Client', p.client?.name ?? '-'],
    ['Team', p.shared ? (p.local ? 'shared' : 'shared, not on this computer') : 'private'],
    ['Category', p.category?.name ?? '-'],
    ['Stack', p.stack.join(', ') || '-'],
    ['Tags', p.tags.join(', ') || '-'],
    ['Activity', relativeTime(p.lastActivityAt)],
  ]
  if (p.description) rows.splice(1, 0, ['About', p.description])
  const versions = Object.entries(p.versions)
  if (versions.length) rows.push(['Versions', versions.map(([k, v]) => `${k} ${v}`).join(', ')])
  if (p.health.length) rows.push(['Attention', p.health.map((f) => (f.kind === 'unpushed' ? `${f.count} unpushed` : f.kind.replace('_', ' '))).join(', ')])
  if (p.git) {
    rows.push(['Git', `${p.git.branch ?? '?'}${p.git.dirty ? ' (uncommitted changes)' : ''}`])
    if (p.git.remote) rows.push(['Remote', p.git.remote])
  }
  return rows.map(([k, v]) => `${k.padEnd(9)} ${v}`).join('\n')
}
