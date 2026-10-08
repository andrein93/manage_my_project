import { describe, expect, it } from 'vitest'
import { MAX_PER_GROUP, fuzzyScore, isPaletteShortcut, searchPalette, type PaletteItem } from '../web/src/palette'

const item = (group: PaletteItem['group'], label: string, extra: Partial<PaletteItem> = {}): PaletteItem => ({ id: `${group}:${label}`, group, label, ...extra })

describe('fuzzyScore', () => {
  it('ranks prefix > word start > contains > subsequence', () => {
    const prefix = fuzzyScore('man', 'manage_my_projects')!
    const word = fuzzyScore('man', 'my manager')!
    const contains = fuzzyScore('man', 'woman')!
    const subseq = fuzzyScore('mmp', 'manage my projects')!
    expect(prefix).toBeGreaterThan(word)
    expect(word).toBeGreaterThan(contains)
    expect(contains).toBeGreaterThan(subseq)
  })

  it('returns null when letters are missing or out of order', () => {
    expect(fuzzyScore('xyz', 'manage')).toBeNull()
    expect(fuzzyScore('pm', 'mp')).toBeNull()
  })

  it('ignores case and accents', () => {
    expect(fuzzyScore('CITTA', 'Città di Padova')).not.toBeNull()
    expect(fuzzyScore('città', 'CITTA')).not.toBeNull()
  })

  it('does not choke on regex characters', () => {
    expect(() => fuzzyScore('(', 'a (b)')).not.toThrow()
    expect(fuzzyScore('c++', 'Learn C++ fast')).not.toBeNull()
    expect(fuzzyScore('[', 'abc')).toBeNull()
  })
})

describe('searchPalette', () => {
  const items = [
    item('pages', 'Projects'),
    item('pages', 'Tasks'),
    item('actions', 'Rescan'),
    item('projects', 'shop-frontend', { hint: 'Acme' }),
    item('projects', 'shop-backend'),
    item('clients', 'Acme', { keywords: 'acme spa' }),
  ]

  it('shows only pages and actions for an empty query', () => {
    expect(searchPalette(items, '  ').map((g) => g.group)).toEqual(['pages', 'actions'])
  })

  it('filters every group and keeps group order', () => {
    const groups = searchPalette(items, 'shop')
    expect(groups.map((g) => g.group)).toEqual(['projects'])
    expect(groups[0].items.map((i) => i.label)).toEqual(['shop-backend', 'shop-frontend'])
  })

  it('matches keywords', () => {
    const clients = searchPalette(items, 'spa').find((g) => g.group === 'clients')
    expect(clients?.items[0].label).toBe('Acme')
  })

  it('caps each group', () => {
    const many = Array.from({ length: 30 }, (_, i) => item('projects', `proj-${i}`))
    expect(searchPalette(many, 'proj')[0].items).toHaveLength(MAX_PER_GROUP)
  })
})

describe('isPaletteShortcut', () => {
  const key = (k: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {}) => ({
    key: k,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
  })

  it('accepts Ctrl+K and Cmd+K in any case', () => {
    expect(isPaletteShortcut(key('k', { ctrlKey: true }))).toBe(true)
    expect(isPaletteShortcut(key('K', { metaKey: true }))).toBe(true)
  })

  it('rejects plain K and extra modifiers', () => {
    expect(isPaletteShortcut(key('k'))).toBe(false)
    expect(isPaletteShortcut(key('k', { ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(isPaletteShortcut(key('k', { ctrlKey: true, altKey: true }))).toBe(false)
  })
})

describe('isPaletteShortcut with key-less events', () => {
  it('does not throw when key is missing (Chrome autofill keydown)', () => {
    const e = { key: undefined as unknown as string, ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }
    expect(() => isPaletteShortcut(e)).not.toThrow()
    expect(isPaletteShortcut(e)).toBe(false)
  })
})
