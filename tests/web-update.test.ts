import { describe, expect, it } from 'vitest'
import { isNewBuild } from '../web/src/update'

describe('isNewBuild', () => {
  it('is true only when both builds are known and differ', () => {
    expect(isNewBuild('a', 'b')).toBe(true)
    expect(isNewBuild('a', 'a')).toBe(false)
  })
  it('never fires without stamps (dev server)', () => {
    expect(isNewBuild(null, 'b')).toBe(false)
    expect(isNewBuild('a', null)).toBe(false)
    expect(isNewBuild(null, null)).toBe(false)
  })
})
