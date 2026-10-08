import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const DIR = join(import.meta.dirname, '..', 'web', 'src', 'locales')
const load = (file: string) => JSON.parse(readFileSync(join(DIR, file), 'utf8')) as Record<string, unknown>

/** Flattens nested messages to "a.b.c" → value (arrays keep their index). */
function flatten(obj: unknown, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  if (typeof obj === 'string') out.set(prefix, obj)
  else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) for (const [kk, vv] of flatten(v, prefix ? `${prefix}.${k}` : k)) out.set(kk, vv)
  }
  return out
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
const plurals = (s: string) => s.split(' | ').length

const english = flatten(load('en.json'))
const others = readdirSync(DIR).filter((f) => f.endsWith('.json') && f !== 'en.json')

describe('locales', () => {
  it('ships at least Italian next to English', () => {
    expect(others).toContain('it.json')
  })

  describe.each(others)('%s', (file) => {
    const messages = flatten(load(file))

    it('has a native name', () => {
      expect(messages.get('_meta.name')).toBeTruthy()
    })

    it('has exactly the same keys as English', () => {
      const missing = [...english.keys()].filter((k) => !messages.has(k) && !k.startsWith('commands.example.'))
      const extra = [...messages.keys()].filter((k) => !english.has(k) && !k.startsWith('commands.example.'))
      expect({ missing, extra }).toEqual({ missing: [], extra: [] })
    })

    it('keeps placeholders and plural forms', () => {
      const wrong = [...english].filter(([k, v]) => {
        const t = messages.get(k)
        return t !== undefined && (placeholders(t).join() !== placeholders(v).join() || plurals(t) !== plurals(v))
      })
      expect(wrong.map(([k]) => k)).toEqual([])
    })

    it('avoids characters with special meaning in vue-i18n', () => {
      const risky = [...messages].filter(([k, v]) => k !== '_meta.name' && /@[:.a-z]|\{[^\w}]/.test(v))
      expect(risky.map(([k]) => k)).toEqual([])
    })
  })
})
