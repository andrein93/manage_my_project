import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFixture, type Fixture } from './helpers.js'

let fx: Fixture
beforeEach(() => {
  fx = createFixture({ 'shop/composer.json': '{}', 'blog/index.html': '' })
})
afterEach(() => fx.cleanup())

describe('billing data', () => {
  it('stores and validates billing settings', () => {
    expect(fx.app.settings.get().billing).toMatchObject({ numberPrefix: 'PF-', vatRate: 22, dueDays: 30 })
    fx.app.settings.update({ billing: { name: 'Andrea Merlin', iban: 'IT60X0542811101000000123456' } })
    expect(fx.app.settings.get().billing).toMatchObject({ name: 'Andrea Merlin', vatRate: 22, iban: 'IT60X0542811101000000123456' })
    expect(() => fx.app.settings.update({ billing: { vatRate: 150 } })).toThrow(/vatRate/)
    expect(() => fx.app.settings.update({ billing: { numberPrefix: 'a b' } })).toThrow(/prefix/)
    expect(() => fx.app.settings.update({ billing: { dueDays: 1.5 } })).toThrow(/dueDays/)
  })

  it('stores client billing fields', () => {
    const c = fx.app.clients.create({ name: 'Acme' })
    expect(c).toMatchObject({ billingName: '', billingAddress: '', billingTaxId: '' })
    const u = fx.app.clients.update(c.id, { billingName: 'Acme S.r.l.', billingTaxId: 'IT01234567890' })
    expect(u).toMatchObject({ billingName: 'Acme S.r.l.', billingTaxId: 'IT01234567890', billingAddress: '', email: '' })
  })
})
