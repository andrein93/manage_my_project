import { afterEach, describe, expect, it, vi } from 'vitest'
import { readPref, writePref } from '../web/src/prefs'
import { THEME_KEY, applyThemePreference, parseThemePreference, readThemePreference } from '../web/src/theme'

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
  it('parses only known preferences', () => {
    expect(parseThemePreference('dark')).toBe('dark')
    expect(parseThemePreference('light')).toBe('light')
    expect(parseThemePreference('system')).toBe('system')
    expect(parseThemePreference('purple')).toBe('system')
    expect(parseThemePreference(null)).toBe('system')
  })

  it('reads the stored preference', () => {
    const s = memoryStorage()
    s.setItem(THEME_KEY, 'light')
    vi.stubGlobal('localStorage', s)
    expect(readThemePreference()).toBe('light')
  })

  it('applies data-theme only for explicit choices', () => {
    const attrs = new Map<string, string>()
    const root = {
      setAttribute: (k: string, v: string) => void attrs.set(k, v),
      removeAttribute: (k: string) => void attrs.delete(k),
    }
    applyThemePreference('dark', root)
    expect(attrs.get('data-theme')).toBe('dark')
    applyThemePreference('system', root)
    expect(attrs.has('data-theme')).toBe(false)
  })
})
