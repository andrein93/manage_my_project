import { addDays, cleanDate, localToday } from '../dates.js'
import { UserError } from '../types.js'

export const PERIODS = ['today', 'week', 'last-week', 'month', 'last-month'] as const
export type Period = (typeof PERIODS)[number]
export type WeekStart = 'monday' | 'sunday'

export interface DateRange {
  /** Inclusive local dates, YYYY-MM-DD. */
  from: string
  to: string
}

/** Resolves a named period relative to `today` (local date). */
export function resolvePeriod(period: Period, today: string, weekStart: WeekStart = 'monday'): DateRange {
  const [y, m] = today.split('-').map(Number)
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay() // 0 = Sunday
  const offset = weekStart === 'monday' ? (dow + 6) % 7 : dow
  const weekFrom = addDays(today, -offset)
  switch (period) {
    case 'today':
      return { from: today, to: today }
    case 'week':
      return { from: weekFrom, to: addDays(weekFrom, 6) }
    case 'last-week':
      return { from: addDays(weekFrom, -7), to: addDays(weekFrom, -1) }
    case 'month':
      return { from: monthStart(y, m), to: addDays(monthStart(y, m + 1), -1) }
    case 'last-month':
      return { from: monthStart(y, m - 1), to: addDays(monthStart(y, m), -1) }
  }
}

function monthStart(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month - 1, 1))
  return d.toISOString().slice(0, 10)
}

/** Validates an explicit range (inclusive), defaulting `to` to `from`. Max ~5 years. */
export function cleanRange(from: string, to?: string): DateRange {
  const range = { from: cleanDate(from), to: cleanDate(to ?? from) }
  if (range.to < range.from) throw new UserError('"to" must not be before "from"')
  if (Date.parse(range.to) - Date.parse(range.from) > 5 * 366 * 86_400_000) throw new UserError('Range too long (max 5 years)')
  return range
}

/** Period name or explicit dates → range. Defaults to the current week. */
export function rangeFrom(
  input: { period?: string; from?: string; to?: string },
  today = localToday(),
  weekStart: WeekStart = 'monday',
): DateRange {
  if (input.from) return cleanRange(input.from, input.to)
  const period = (input.period ?? 'week') as Period
  if (!PERIODS.includes(period)) throw new UserError(`Invalid period "${input.period}". Use one of: ${PERIODS.join(', ')}`)
  return resolvePeriod(period, today, weekStart)
}

/** Every local date in the range. */
export function daysOf(range: DateRange): string[] {
  const days: string[] = []
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) days.push(d)
  return days
}

/** UTC minute key ('YYYY-MM-DDTHH:MM') of local midnight starting `day`. */
export function localDayStartMinute(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return minuteKey(new Date(y, m - 1, d).getTime())
}

/** 'YYYY-MM-DDTHH:MM' in UTC for an epoch-ms instant. */
export function minuteKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16)
}

export function minuteToMs(key: string): number {
  return Date.parse(`${key}:00.000Z`)
}

/** Local date (YYYY-MM-DD) of an epoch-ms instant. */
export function localDateOf(ms: number): string {
  return localToday(new Date(ms))
}
