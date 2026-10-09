import { localDateOf } from './periods.js'

const MINUTE = 60_000
/** Added to every block so an isolated signal still counts. */
export const BLOCK_PADDING_MINUTES = 2

export interface Signal {
  /** Epoch ms, minute resolution. */
  at: number
  source: 'claude' | 'git' | 'editor'
  sessionId: string | null
}

export interface Block {
  start: number
  /** Exclusive end, including padding. */
  end: number
  minutes: number
  sources: ('claude' | 'git' | 'editor')[]
  sessionIds: string[]
}

/** Merges signals (any order) into blocks; a gap longer than `idleMinutes` starts a new block. */
export function buildBlocks(signals: Signal[], idleMinutes: number): Block[] {
  const sorted = [...signals].sort((a, b) => a.at - b.at)
  const blocks: Block[] = []
  let current: { start: number; last: number; sources: Set<Signal['source']>; sessions: Set<string> } | null = null
  const close = () => {
    if (!current) return
    const end = current.last + BLOCK_PADDING_MINUTES * MINUTE
    blocks.push({
      start: current.start,
      end,
      minutes: Math.round((end - current.start) / MINUTE),
      sources: [...current.sources].sort(),
      sessionIds: [...current.sessions].sort(),
    })
  }
  for (const s of sorted) {
    if (current && s.at - current.last <= idleMinutes * MINUTE) {
      current.last = s.at
    } else {
      close()
      current = { start: s.at, last: s.at, sources: new Set(), sessions: new Set() }
    }
    current.sources.add(s.source)
    if (s.sessionId) current.sessions.add(s.sessionId)
  }
  close()
  return blocks
}

/** Minutes of each block per local day (blocks crossing midnight are split). */
export function minutesPerDay(blocks: Block[]): Map<string, number> {
  const perDay = new Map<string, number>()
  for (const block of blocks) {
    let cursor = block.start
    while (cursor < block.end) {
      const day = localDateOf(cursor)
      const [y, m, d] = day.split('-').map(Number)
      const nextMidnight = new Date(y, m - 1, d + 1).getTime()
      const sliceEnd = Math.min(block.end, nextMidnight)
      perDay.set(day, (perDay.get(day) ?? 0) + (sliceEnd - cursor) / MINUTE)
      cursor = sliceEnd
    }
  }
  return perDay
}
