import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_TOASTS, dismissToast, pushToast, toasts } from '../web/src/toasts'

beforeEach(() => {
  vi.useFakeTimers()
  for (const t of [...toasts.value]) dismissToast(t.id)
})
afterEach(() => vi.useRealTimers())

describe('toasts', () => {
  it('auto-dismisses info toasts', () => {
    pushToast('Scan finished', 'info', 1000)
    expect(toasts.value).toHaveLength(1)
    vi.advanceTimersByTime(1000)
    expect(toasts.value).toHaveLength(0)
  })

  it('keeps errors until dismissed', () => {
    const id = pushToast('Offline', 'error')
    vi.advanceTimersByTime(60_000)
    expect(toasts.value.map((t) => t.id)).toEqual([id])
    dismissToast(id)
    expect(toasts.value).toHaveLength(0)
  })

  it('replaces a toast with the same message', () => {
    pushToast('Offline', 'error')
    pushToast('Offline', 'error')
    expect(toasts.value).toHaveLength(1)
  })

  it('drops the oldest beyond the limit', () => {
    for (let i = 0; i < MAX_TOASTS + 2; i++) pushToast(`m${i}`, 'error')
    expect(toasts.value).toHaveLength(MAX_TOASTS)
    expect(toasts.value[0].message).toBe('m2')
  })
})
