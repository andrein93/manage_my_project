import { afterEach, describe, expect, it, vi } from 'vitest'
import { readPref, writePref } from '../web/src/prefs'
import { THEME_KEY, applyThemePreference, parseThemePreference, readThemePreference, themeFromStorageEvent } from '../web/src/theme'

function memoryStorage() {
  const data = new Map<string, string>()
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data,
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('prefs', () => {
  it('round-trips and removes values', () => {
    const s = memoryStorage()
    vi.stubGlobal('localStorage', s)
    writePref('k', 'v')
    expect(readPref('k')).toBe('v')
    writePref('k', null)
    expect(s.data.has('k')).toBe(false)
  })

  it('survives a throwing storage', () => {
    const blocked = () => {
      throw new Error('blocked')
    }
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked })
    expect(readPref('k')).toBeNull()
    expect(() => writePref('k', 'v')).not.toThrow()
  })
})

describe('theme', () => {
  it('defaults to dark for anything but light', () => {
    expect(parseThemePreference('light')).toBe('light')
    expect(parseThemePreference('dark')).toBe('dark')
    expect(parseThemePreference('system')).toBe('dark')
    expect(parseThemePreference('purple')).toBe('dark')
    expect(parseThemePreference(null)).toBe('dark')
  })

  it('falls back to dark when storage is blocked', () => {
    const blocked = () => {
      throw new Error('blocked')
    }
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked })
    expect(readThemePreference()).toBe('dark')
  })

  it('reads the stored preference', () => {
    const s = memoryStorage()
    s.setItem(THEME_KEY, 'light')
    vi.stubGlobal('localStorage', s)
    expect(readThemePreference()).toBe('light')
  })

  it('always sets data-theme', () => {
    const attrs = new Map<string, string>()
    const root = {
      setAttribute: (k: string, v: string) => void attrs.set(k, v),
      removeAttribute: (k: string) => void attrs.delete(k),
    }
    applyThemePreference('dark', root)
    expect(attrs.get('data-theme')).toBe('dark')
    applyThemePreference('light', root)
    expect(attrs.get('data-theme')).toBe('light')
  })
})

describe('cross-tab theme sync', () => {
  it('reads the new theme from another tab', () => {
    expect(themeFromStorageEvent({ key: THEME_KEY, newValue: 'light' })).toBe('light')
  })

  it('treats a removed key as dark (the default)', () => {
    expect(themeFromStorageEvent({ key: THEME_KEY, newValue: null })).toBe('dark')
  })

  it('ignores other keys', () => {
    expect(themeFromStorageEvent({ key: 'mmp.language', newValue: 'it' })).toBeNull()
  })

  it('handles storage being cleared (key null) as dark', () => {
    expect(themeFromStorageEvent({ key: null, newValue: null })).toBe('dark')
  })
})
