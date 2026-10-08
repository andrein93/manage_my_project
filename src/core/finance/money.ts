import { UserError } from '../types.js'

const MAX_CENTS = 1_000_000_000 // 10,000,000.00

/**
 * Parses an amount into cents. Accepts numbers and strings in either decimal style:
 * `1500`, `1500.5`, `1500,50`, `1.500,50`, `1,500.50`. A lone separator followed by exactly
 * three digits is read as a thousands separator (`1.500` = 1500).
 */
export function parseAmount(value: string | number, { allowZero = false } = {}): number {
  const cents = typeof value === 'number' ? Math.round(value * 100) : parseString(value)
  if (cents === null || !Number.isFinite(cents) || cents < 0 || (!allowZero && cents === 0)) {
    throw new UserError(`Invalid amount "${value}". Use e.g. 1500 or 1.500,50.`)
  }
  if (cents > MAX_CENTS) throw new UserError('Amount is too large')
  return cents
}

function parseString(raw: string): number | null {
  const text = raw.trim().replace(/[\s€$£]/g, '')
  if (!/^\d[\d.,]*$/.test(text)) return null
  const lastDot = text.lastIndexOf('.')
  const lastComma = text.lastIndexOf(',')
  let normalized: string
  if (lastDot !== -1 && lastComma !== -1) {
    // Both present: the last one is the decimal separator.
    const decimal = lastDot > lastComma ? '.' : ','
    const thousands = decimal === '.' ? ',' : '.'
    normalized = text.split(thousands).join('').replace(decimal, '.')
  } else if (lastDot !== -1 || lastComma !== -1) {
    const sep = lastDot !== -1 ? '.' : ','
    const parts = text.split(sep)
    const isThousands = parts.length > 2 || parts[parts.length - 1].length === 3
    normalized = isThousands ? parts.join('') : parts.join('.')
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
