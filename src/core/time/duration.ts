import { UserError } from '../types.js'

/**
 * Parses a human duration into minutes: `90`, `90m`, `1h`, `1h30m`, `1.5h`, `2h 15m`.
 * Bare numbers are minutes.
 */
export function parseDuration(value: string | number): number {
  const minutes = typeof value === 'number' ? value : parse(value.trim().toLowerCase())
  if (minutes === null || !Number.isFinite(minutes) || minutes <= 0) {
    throw new UserError(`Invalid duration "${value}". Use e.g. 45m, 1h30m or 1.5h.`)
  }
  const rounded = Math.round(minutes)
  if (rounded < 1 || rounded > 1440) throw new UserError('Duration must be between 1 minute and 24 hours')
  return rounded
}

function parse(text: string): number | null {
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text)
  const match = /^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?$/.exec(text)
  if (!match || (match[1] === undefined && match[2] === undefined)) return null
  return Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0)
}

/** 95 → "1h 35m", 45 → "45m". */
export function formatMinutes(minutes: number): string {
  const total = Math.round(minutes)
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}
