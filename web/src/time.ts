import { uiLocale } from './i18n'

/** 95 → "1h 35m", 45 → "45m", 0 → "0m". */
export function formatMinutes(minutes: number): string {
  const total = Math.round(minutes)
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

export function formatUsd(value: number): string {
  return value.toLocaleString(uiLocale(), { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Local date as YYYY-MM-DD. */
export function localDate(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function dayLabel(day: string, options: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric' }): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(uiLocale(), options)
}

/** Cents in the given currency, in the viewer's locale. */
export function formatMoney(cents: number | null, currency: string): string {
  if (cents === null) return '-'
  const value = cents / 100
  try {
    return value.toLocaleString(uiLocale(), { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 })
  } catch {
    return `${value.toFixed(2)} ${currency}`
  }
}
