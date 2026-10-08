export type PaletteGroup = 'pages' | 'projects' | 'tasks' | 'clients' | 'actions'

export interface PaletteItem {
  /** Unique, e.g. "project:<uuid>"; the palette component maps it to an action. */
  id: string
  group: PaletteGroup
  label: string
  /** Secondary text shown at the right (client, project…). */
  hint?: string
  /** Extra searchable text, ranked just below the label. */
  keywords?: string
}

export const GROUP_ORDER: PaletteGroup[] = ['pages', 'projects', 'tasks', 'clients', 'actions']
export const MAX_PER_GROUP = 8
/** Shown without a query, so the palette is useful as a launcher. */
const ALWAYS_SHOWN: PaletteGroup[] = ['pages', 'actions']

export function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

const BOUNDARY = /[\s\-_/.]/

/** Higher is better; null when `query` letters don't appear in order in `text`. Plain string ops, no regex from input. */
export function fuzzyScore(query: string, text: string): number | null {
  const q = normalize(query.trim())
  const s = normalize(text)
  if (!q) return 0
  const at = s.indexOf(q)
  if (at === 0) return 30_000 - Math.min(s.length, 9_999)
  if (at > 0) return (BOUNDARY.test(s[at - 1]) ? 20_000 : 10_000) - Math.min(at, 9_999)
  let from = 0
  let gaps = 0
  for (const ch of q) {
    const i = s.indexOf(ch, from)
    if (i === -1) return null
    gaps += i - from
    from = i + 1
  }
  return 5_000 - Math.min(gaps, 4_999)
}

function score(item: PaletteItem, query: string): number | null {
  const label = fuzzyScore(query, item.label)
  const keywords = item.keywords ? fuzzyScore(query, item.keywords) : null
  if (label === null && keywords === null) return null
  return Math.max(label ?? -Infinity, keywords === null ? -Infinity : keywords - 1)
}

export function searchPalette(items: PaletteItem[], query: string): { group: PaletteGroup; items: PaletteItem[] }[] {
  const q = query.trim()
  return GROUP_ORDER.map((group) => {
    const pool = items.filter((i) => i.group === group)
    if (!q) return { group, items: ALWAYS_SHOWN.includes(group) ? pool.slice(0, MAX_PER_GROUP) : [] }
    const ranked = pool
      .map((item) => ({ item, s: score(item, q) }))
      .filter((x): x is { item: PaletteItem; s: number } => x.s !== null)
      .sort((a, b) => b.s - a.s || a.item.label.localeCompare(b.item.label))
    return { group, items: ranked.slice(0, MAX_PER_GROUP).map((x) => x.item) }
  }).filter((g) => g.items.length)
}

type KeyLike = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>

export function isPaletteShortcut(e: KeyLike): boolean {
  return e.key?.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey
}
