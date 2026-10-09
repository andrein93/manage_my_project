import { describe, expect, it } from 'vitest'
import { lineAmount, statementTotals } from '../web/src/statements'

describe('statement helpers', () => {
  it('computes a line amount from quantity and unit, rounding to cents', () => {
    expect(lineAmount(1.5, 3333)).toBe(5000)
    expect(lineAmount(0.333, 100)).toBe(33)
  })
  it('totals with VAT rounding like the server', () => {
    expect(statementTotals([15000, 20000, 100000], 22)).toEqual({ subtotalCents: 135000, vatCents: 29700, totalCents: 164700 })
    expect(statementTotals([], 22)).toEqual({ subtotalCents: 0, vatCents: 0, totalCents: 0 })
  })
})
