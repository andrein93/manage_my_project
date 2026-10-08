import { describe, expect, it } from 'vitest'
import { buildBlocks, minutesPerDay, type Signal } from '../src/core/time/blocks.js'
import { formatMinutes, parseDuration } from '../src/core/time/duration.js'
import { daysOf, rangeFrom, resolvePeriod } from '../src/core/time/periods.js'

const at = (local: string) => new Date(local).getTime() // local time, e.g. '2026-10-08T10:00'
const sig = (local: string, source: Signal['source'] = 'claude', sessionId: string | null = 's1'): Signal => ({
  at: at(local),
  source,
  sessionId,
})

describe('parseDuration', () => {
  it.each([
    ['90', 90],
    ['90m', 90],
    ['1h', 60],
    ['1h30m', 90],
    ['1h 30m', 90],
    ['1.5h', 90],
    ['45min', 45],
    [25, 25],
  ])('%s → %d', (input, minutes) => expect(parseDuration(input)).toBe(minutes))

  it.each(['', 'abc', '0', '-5', '25h', 'h', '1h30'])('rejects %j', (input) => {
    expect(() => parseDuration(input)).toThrow()
  })

  it('formats minutes', () => {
    expect(formatMinutes(45)).toBe('45m')
    expect(formatMinutes(60)).toBe('1h')
    expect(formatMinutes(95)).toBe('1h 35m')
  })
})

describe('periods', () => {
  it('resolves weeks (Monday or Sunday start) and months', () => {
    // 2026-10-08 is a Thursday.
    expect(resolvePeriod('week', '2026-10-08')).toEqual({ from: '2026-10-05', to: '2026-10-11' })
    expect(resolvePeriod('week', '2026-10-08', 'sunday')).toEqual({ from: '2026-10-04', to: '2026-10-10' })
    expect(resolvePeriod('last-week', '2026-10-08')).toEqual({ from: '2026-09-28', to: '2026-10-04' })
    expect(resolvePeriod('month', '2026-10-08')).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    expect(resolvePeriod('last-month', '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' })
    expect(resolvePeriod('month', '2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
    expect(resolvePeriod('week', '2026-10-05')).toEqual({ from: '2026-10-05', to: '2026-10-11' })
  })

  it('validates explicit ranges and named periods', () => {
    expect(rangeFrom({ from: '2026-10-01', to: '2026-10-03' })).toEqual({ from: '2026-10-01', to: '2026-10-03' })
    expect(rangeFrom({ from: '2026-10-01' })).toEqual({ from: '2026-10-01', to: '2026-10-01' })
    expect(() => rangeFrom({ from: '2026-10-03', to: '2026-10-01' })).toThrow(/before/)
    expect(() => rangeFrom({ period: 'year' })).toThrow(/Invalid period/)
    expect(daysOf({ from: '2026-10-30', to: '2026-11-02' })).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'])
  })
})

describe('buildBlocks', () => {
  it('merges signals within the idle threshold and pads each block', () => {
    const blocks = buildBlocks(
      [sig('2026-10-08T10:00'), sig('2026-10-08T10:10'), sig('2026-10-08T10:25'), sig('2026-10-08T11:00', 'git', null)],
      15,
    )
    expect(blocks.map((b) => b.minutes)).toEqual([27, 2])
    expect(blocks[0].sessionIds).toEqual(['s1'])
    expect(blocks[1].sources).toEqual(['git'])
  })

  it('respects a different threshold', () => {
    const signals = [sig('2026-10-08T10:00'), sig('2026-10-08T10:20')]
    expect(buildBlocks(signals, 15)).toHaveLength(2)
    expect(buildBlocks(signals, 30)).toHaveLength(1)
  })

  it('splits blocks across local midnight', () => {
    const blocks = buildBlocks([sig('2026-10-08T23:50'), sig('2026-10-09T00:04')], 15)
    expect(blocks).toHaveLength(1)
    const perDay = minutesPerDay(blocks)
    expect(perDay.get('2026-10-08')).toBe(10)
    expect(perDay.get('2026-10-09')).toBe(6)
  })
})
