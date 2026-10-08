import { describe, expect, it } from 'vitest'
import { clampedDate, dayCount, monthOf, occurrences, spreadFixed, type DayAmounts } from '../src/core/finance/accrual.js'
import { formatCents, parseAmount } from '../src/core/finance/money.js'

describe('parseAmount', () => {
  it.each([
    ['1500', 150000],
    ['1500.5', 150050],
    ['1500,50', 150050],
    ['1.500,50', 150050],
    ['1,500.50', 150050],
    ['1.500', 150000],
    ['1,500', 150000],
    ['1.234.567', 123456700],
    ['12,5', 1250],
    ['€ 90', 9000],
    [49.99, 4999],
  ])('%s → %d cents', (input, cents) => expect(parseAmount(input)).toBe(cents))

  it.each(['', 'abc', '0', '-5', '1.2.3,4,5', '1.2345', '20000000'])('rejects %j', (input) => {
    expect(() => parseAmount(input)).toThrow()
  })

  it('formats cents', () => {
    expect(formatCents(150050, 'EUR')).toBe('1,500.50 EUR')
    expect(formatCents(-5, 'EUR')).toBe('-0.05 EUR')
  })
})

describe('accrual helpers', () => {
  it('clamps days to month ends', () => {
    expect(clampedDate(2026, 2, 31)).toBe('2026-02-28')
    expect(clampedDate(2028, 2, 31)).toBe('2028-02-29')
    expect(clampedDate(2026, 13, 15)).toBe('2027-01-15')
    expect(monthOf('2026-02-10')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
  })

  it('lists monthly and yearly occurrences with clamping and end dates', () => {
    expect(occurrences('2026-01-31', null, 'month', '2026-04-30')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'])
    expect(occurrences('2026-01-15', '2026-03-01', 'month', '2026-12-31')).toEqual(['2026-01-15', '2026-02-15'])
    expect(occurrences('2024-02-29', null, 'year', '2026-12-31')).toEqual(['2024-02-29', '2025-02-28', '2026-02-28'])
    expect(occurrences('2027-01-01', null, 'month', '2026-12-31')).toEqual([])
  })

  it('spreads fixed amounts with the remainder on the last day', () => {
    const days: DayAmounts = new Map()
    spreadFixed(1000, '2026-10-01', '2026-10-03', { from: '2026-10-01', to: '2026-10-31' }, days)
    expect([...days]).toEqual([
      ['2026-10-01', 333],
      ['2026-10-02', 333],
      ['2026-10-03', 334],
    ])
    const clipped: DayAmounts = new Map()
    spreadFixed(1000, '2026-10-01', '2026-10-03', { from: '2026-10-03', to: '2026-10-31' }, clipped)
    expect([...clipped]).toEqual([['2026-10-03', 334]])
    const once: DayAmounts = new Map()
    spreadFixed(500, '2026-10-05', null, { from: '2026-10-01', to: '2026-10-31' }, once)
    expect([...once]).toEqual([['2026-10-05', 500]])
    expect(dayCount('2026-10-01', '2026-10-31')).toBe(31)
  })
})
