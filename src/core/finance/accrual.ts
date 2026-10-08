import { addDays } from '../dates.js'

/** Per-day amounts in cents (floating point; rounded when reported). */
export type DayAmounts = Map<string, number>

export function addTo(map: DayAmounts, day: string, cents: number): void {
  if (cents) map.set(day, (map.get(day) ?? 0) + cents)
}

/** Day `day` of the given month, clamped to the month's last day. Month is 1-based, may overflow. */
export function clampedDate(year: number, month: number, day: number): string {
  const firstOfNext = new Date(Date.UTC(year, month, 1))
  const lastDay = new Date(firstOfNext.getTime() - 86_400_000).getUTCDate()
  const d = new Date(Date.UTC(year, month - 1, Math.min(day, lastDay)))
  return d.toISOString().slice(0, 10)
}

/**
 * Occurrence dates of a recurring item (monthly on the start's day-of-month, or yearly on its
 * anniversary, clamped to month ends), from `start` while ≤ `end` and ≤ `until`.
 */
export function occurrences(start: string, end: string | null, interval: 'month' | 'year', until: string): string[] {
  const [y, m, d] = start.split('-').map(Number)
  const last = end && end < until ? end : until
  const dates: string[] = []
  for (let k = 0; ; k++) {
    const date = interval === 'month' ? clampedDate(y, m + k, d) : clampedDate(y + k, m, d)
    if (date > last) break
    dates.push(date)
    if (k > 2000) break // safety net
  }
  return dates
}

/** Number of days in an inclusive date range. */
export function dayCount(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
}

/**
 * A fixed amount spread evenly over `start..end` (whole cents per day, remainder on the last
 * day). Without an end date the full amount lands on `start`. Only days within `range` are set.
 */
export function spreadFixed(
  amountCents: number,
  start: string,
  end: string | null,
  range: { from: string; to: string },
  into: DayAmounts,
): void {
  if (!end || end === start) {
    if (start >= range.from && start <= range.to) addTo(into, start, amountCents)
    return
  }
  const days = dayCount(start, end)
  const base = Math.floor(amountCents / days)
  const remainder = amountCents - base * days
  const from = start > range.from ? start : range.from
  const to = end < range.to ? end : range.to
  for (let day = from; day <= to; day = addDays(day, 1)) addTo(into, day, day === end ? base + remainder : base)
}

/** First and last day of the calendar month containing `day`. */
export function monthOf(day: string): { from: string; to: string } {
  const [y, m] = day.split('-').map(Number)
  return { from: clampedDate(y, m, 1), to: clampedDate(y, m, 31) }
}
