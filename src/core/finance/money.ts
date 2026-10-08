import { UserError } from '../types.js'

const MAX_CENTS = 1_000_000_000 // 10,000,000.00

/**
 * Parses an amount into cents. Accepts numbers and strings in either decimal style:
 * `1500`, `1500.5`, `1500,50`, `1.500,50`, `1,500.50`. A lone separator followed by exactly
 * three digits is read as a thousands separator (`1.500` = 1500) when the grouping is
 * well formed.
 */
export function parseAmount(value: string | number, { allowZero = false } = {}): number {
  const cents = typeof value === 'number' ? numberToCents(value) : parseString(value)
  if (cents === null || !Number.isFinite(cents) || cents < 0 || (!allowZero && cents === 0)) {
    throw new UserError(`Invalid amount "${value}". Use e.g. 1500 or 1.500,50.`)
  }
  if (cents > MAX_CENTS) throw new UserError('Amount is too large')
  return cents
}

function numberToCents(value: number): number | null {
  const cents = value * 100
  // More than two decimals would be silently rounded: reject instead.
  return Math.abs(cents - Math.round(cents)) > 1e-6 ? null : Math.round(cents)
}

const GROUPED = {
  '.': /^[1-9]\d{0,2}(\.\d{3})+$/,
  ',': /^[1-9]\d{0,2}(,\d{3})+$/,
} as const

/** "1.234.567" with sep "." → "1234567"; null unless every group after the first has 3 digits. */
function ungroup(text: string, sep: '.' | ','): string | null {
  return GROUPED[sep].test(text) ? text.split(sep).join('') : null
}

function parseString(raw: string): number | null {
  const text = raw.trim().replace(/[\s€$£]/g, '')
  if (!/^\d[\d.,]*$/.test(text)) return null
  const lastDot = text.lastIndexOf('.')
  const lastComma = text.lastIndexOf(',')
  let normalized: string
  if (lastDot !== -1 && lastComma !== -1) {
    // Both present: the last one is the decimal separator, the other groups thousands.
    const decimal = lastDot > lastComma ? '.' : ','
    const groupSep = decimal === '.' ? ',' : '.'
    const [int, frac, extra] = text.split(decimal)
    if (extra !== undefined) return null
    const digits = ungroup(int, groupSep)
    if (digits === null) return null
    normalized = `${digits}.${frac}`
  } else if (lastDot !== -1 || lastComma !== -1) {
    const sep = lastDot !== -1 ? '.' : ','
    const parts = text.split(sep)
    if (parts.length > 2 || parts[1].length === 3) {
      // Only a well-formed grouping is a thousands separator ("0.125" or "8.10.2026" are not).
      const digits = ungroup(text, sep)
      if (digits === null) return null
      normalized = digits
    } else normalized = parts.join('.')
  } else {
    normalized = text
  }
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null
  return Math.round(Number(normalized) * 100)
}

/** 150050 → "1,500.50 EUR" style string in the viewer-neutral form used by CLI/MCP. */
export function formatCents(cents: number, currency: string): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(Math.round(cents))
  const units = Math.floor(abs / 100).toLocaleString('en-US')
  return `${sign}${units}.${String(abs % 100).padStart(2, '0')} ${currency}`
}
