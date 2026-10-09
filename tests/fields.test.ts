import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFixture, type Fixture } from './helpers.js'

let fx: Fixture
beforeEach(async () => {
  fx = createFixture({ 'shop/composer.json': '{}', 'blog/index.html': '' })
  await fx.app.scan()
})
afterEach(() => fx.cleanup())

const id = (name: string) => fx.app.projects.resolve(name).id

describe('custom fields', () => {
  it('defines, renames, reorders and removes fields', () => {
    const url = fx.app.fields.create({ name: 'Production URL', kind: 'url' })
    const expiry = fx.app.fields.create({ name: 'Domain expiry', kind: 'date' })
    expect(expiry.remindDays).toBe(30)
    expect(url.remindDays).toBeNull()
    expect(fx.app.fields.list().map((f) => f.name)).toEqual(['Production URL', 'Domain expiry'])
    fx.app.fields.move(expiry.id, 'up')
    expect(fx.app.fields.list().map((f) => f.name)).toEqual(['Domain expiry', 'Production URL'])
    fx.app.fields.update(url.id, { name: 'Live site' })
    expect(fx.app.fields.resolve('live site').id).toBe(url.id)
    expect(() => fx.app.fields.create({ name: 'live SITE', kind: 'text' })).toThrow(/already exists/)
    expect(() => fx.app.fields.create({ name: 'X', kind: 'colour' as never })).toThrow(/kind/)
    expect(() => fx.app.fields.update(url.id, { remindDays: 10 })).toThrow(/date/)
    fx.app.fields.setValues(id('shop'), { [url.id]: 'https://shop.test' })
    fx.app.fields.remove(url.id)
    expect(fx.app.fields.list().map((f) => f.name)).toEqual(['Domain expiry'])
    expect(fx.app.fields.values(id('shop')).map((v) => v.fieldId)).toEqual([expiry.id])
  })

  it('validates and normalises values by kind; empty clears', () => {
    const url = fx.app.fields.create({ name: 'URL', kind: 'url' })
    const date = fx.app.fields.create({ name: 'Expiry', kind: 'date' })
    const num = fx.app.fields.create({ name: 'Seats', kind: 'number' })
    const text = fx.app.fields.create({ name: 'Hosting', kind: 'text' })
    const shop = id('shop')
    fx.app.fields.setValues(shop, { [url.id]: ' https://shop.test/ ', [date.id]: '2027-03-01', [num.id]: '12,5', [text.id]: 'Hetzner' })
    expect(Object.fromEntries(fx.app.fields.values(shop).map((v) => [v.name, v.value]))).toEqual({
      URL: 'https://shop.test/',
      Expiry: '2027-03-01',
      Seats: '12.5',
      Hosting: 'Hetzner',
    })
    expect(() => fx.app.fields.setValues(shop, { [url.id]: 'javascript:alert(1)' })).toThrow(/http/)
    expect(() => fx.app.fields.setValues(shop, { [date.id]: '2027-02-30' })).toThrow(/date/i)
    for (const bad of ['2027-13-01', '2027-00-10', '2027-01-32']) {
      expect(() => fx.app.fields.setValues(shop, { [date.id]: bad })).toThrow(/Expiry: .* is not a valid date/)
    }
    expect(() => fx.app.fields.setValues(shop, { [num.id]: 'lots' })).toThrow(/number/)
    expect(() => fx.app.fields.setValues(shop, { nope: 'x' })).toThrow(/not found/i)
    fx.app.fields.setValues(shop, { [text.id]: '', [num.id]: null })
    expect(fx.app.fields.values(shop).filter((v) => v.value).map((v) => v.name)).toEqual(['URL', 'Expiry'])
  })

  it('finds projects by field values in search', () => {
    const host = fx.app.fields.create({ name: 'Hosting', kind: 'text' })
    fx.app.fields.setValues(id('blog'), { [host.id]: 'Hetzner Falkenstein' })
    expect(fx.app.projects.list({ query: 'falkenstein' }).map((p) => p.name)).toEqual(['blog'])
  })

  it('lists upcoming dates within each field remind window', () => {
    const expiry = fx.app.fields.create({ name: 'Domain expiry', kind: 'date' }) // 30 days
    const contract = fx.app.fields.create({ name: 'Contract end', kind: 'date', remindDays: 7 })
    const never = fx.app.fields.create({ name: 'Launch', kind: 'date', remindDays: null })
    fx.app.fields.setValues(id('shop'), { [expiry.id]: '2026-10-20', [contract.id]: '2026-10-20', [never.id]: '2026-10-09' })
    fx.app.fields.setValues(id('blog'), { [expiry.id]: '2026-10-01' })
    // Long past: no longer a reminder (passed dates stay for 30 days).
    const old = fx.app.fields.create({ name: 'Old contract', kind: 'date' })
    fx.app.fields.setValues(id('blog'), { [old.id]: '2026-08-01' })
    expect(fx.app.fields.upcomingDates('2026-10-08')).toEqual([
      { projectId: id('blog'), projectName: 'blog', fieldId: expiry.id, fieldName: 'Domain expiry', date: '2026-10-01', daysLeft: -7 },
      { projectId: id('shop'), projectName: 'shop', fieldId: expiry.id, fieldName: 'Domain expiry', date: '2026-10-20', daysLeft: 12 },
    ])
  })
})
