import { describe, expect, it } from 'vitest'
import { STAGGER_CAP, STAGGER_STEP, staggerDelay, tween } from '../web/src/motion'

describe('staggerDelay', () => {
  it('steps per item', () => {
    expect(staggerDelay(0)).toBe(0)
    expect(staggerDelay(3)).toBeCloseTo(3 * STAGGER_STEP)
  })

  it('is capped so long lists do not wait', () => {
    expect(staggerDelay(200)).toBeCloseTo(STAGGER_CAP * STAGGER_STEP)
    expect(staggerDelay(200)).toBeLessThan(0.5)
  })

  it('is zero with reduced motion and for negative indexes', () => {
    expect(staggerDelay(5, true)).toBe(0)
    expect(staggerDelay(-1)).toBe(0)
  })
})

describe('tween', () => {
  it('starts, ends and eases out', () => {
    expect(tween(0, 100, 0)).toBe(0)
    expect(tween(0, 100, 1)).toBe(100)
    expect(tween(0, 100, 0.5)).toBeGreaterThan(50)
  })

  it('clamps progress and works downwards', () => {
    expect(tween(10, 20, 2)).toBe(20)
    expect(tween(10, 20, -1)).toBe(10)
    expect(tween(100, 0, 1)).toBe(0)
  })
})
