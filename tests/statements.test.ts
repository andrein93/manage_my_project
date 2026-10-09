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

describe('statements', () => {
  let acme: { id: string }
  const id = (name: string) => fx.app.projects.resolve(name).id
  const OCT = { from: '2026-10-01', to: '2026-10-31' }
  const draft = () => fx.app.statements.create({ clientId: acme.id, ...OCT })

  beforeEach(async () => {
    await fx.app.scan()
    acme = fx.app.clients.create({ name: 'Acme' })
    fx.app.projects.update(id('shop'), { clientId: acme.id })
    fx.app.projects.update(id('blog'), { clientId: acme.id })
    const f = fx.app.finance.repo
    f.addAgreement({ projectId: id('shop'), kind: 'hourly', amount: 50, startDate: '2026-10-01' })
    f.addAgreement({ projectId: id('blog'), kind: 'recurring', amount: 200, interval: 'month', startDate: '2026-01-01' })
    f.addAgreement({ projectId: id('blog'), kind: 'fixed', amount: 1000, startDate: '2026-10-01', endDate: '2026-10-31' })
    fx.app.time.repo.addEntry({ projectId: id('shop'), date: '2026-10-02', minutes: 120 })
    fx.app.time.repo.addEntry({ projectId: id('shop'), date: '2026-10-03', minutes: 60 })
  })

  it('prefills a draft from what was earned in the period', () => {
    const s = draft()
    expect(s).toMatchObject({ status: 'draft', number: null, clientName: 'Acme', vatRate: 22 })
    const hourly = s.lines.find((l) => l.projectName === 'shop')!
    expect(hourly).toMatchObject({ quantity: 3, unitCents: 5000, amountCents: 15000 })
    expect(s.lines.map((l) => l.amountCents).sort((a, b) => a - b)).toEqual([15000, 20000, 100000])
    expect(s).toMatchObject({ subtotalCents: 135000, vatCents: 29700, totalCents: 164700 })
    const report = fx.app.finance.report({ range: OCT }, 'client')
    expect(report.rows.find((r) => r.key === acme.id)!.earnedCents).toBe(s.subtotalCents)
  })

  it('gives one line per agreement when the rate changes mid-period', () => {
    const f = fx.app.finance.repo
    const first = f.agreements(id('shop'))[0]
    f.updateAgreement(first.id, { endDate: '2026-10-02' })
    f.addAgreement({ projectId: id('shop'), kind: 'hourly', amount: 80, startDate: '2026-10-03' })
    const lines = draft().lines.filter((l) => l.projectName === 'shop')
    expect(lines.map((l) => [l.quantity, l.unitCents, l.amountCents])).toEqual([
      [2, 5000, 10000],
      [1, 8000, 8000],
    ])
  })

  it('numbers issued statements per year without gaps', () => {
    const a = fx.app.statements.issue(draft().id, { issueDate: '2026-10-09' })
    const b = fx.app.statements.issue(draft().id, { issueDate: '2026-11-02' })
    const c = fx.app.statements.issue(draft().id, { issueDate: '2027-01-05' })
    expect([a.number, b.number, c.number]).toEqual(['PF-2026-001', 'PF-2026-002', 'PF-2027-001'])
    expect(a).toMatchObject({ status: 'issued', issueDate: '2026-10-09', dueDate: '2026-11-08' })
  })

  it('freezes billing data at issue', () => {
    fx.app.settings.update({ billing: { name: 'Me' } })
    fx.app.clients.update(acme.id, { billingName: 'Acme S.r.l.' })
    const s = fx.app.statements.issue(draft().id)
    fx.app.settings.update({ billing: { name: 'Someone else' } })
    fx.app.clients.update(acme.id, { billingName: 'Changed' })
    expect(fx.app.statements.get(s.id).snapshot).toMatchObject({ issuer: { name: 'Me' }, client: { name: 'Acme S.r.l.' } })
  })

  it('refuses to edit or delete issued statements, and to issue an empty one', () => {
    const empty = fx.app.statements.create({ clientId: acme.id, from: '2025-01-01', to: '2025-01-31' })
    expect(empty.lines).toEqual([])
    expect(() => fx.app.statements.issue(empty.id)).toThrow(/at least one line/)
    const s = fx.app.statements.issue(draft().id)
    expect(() => fx.app.statements.setLines(s.id, [])).toThrow(/draft/)
    expect(() => fx.app.statements.update(s.id, { notes: 'x' })).toThrow(/draft/)
    expect(() => fx.app.statements.remove(s.id)).toThrow(/draft/)
  })

  it('edits draft lines and computes amounts', () => {
    const d = draft()
    const s = fx.app.statements.setLines(d.id, [
      { projectId: id('shop'), description: 'Consulting', quantity: 1.5, unitCents: 3333 },
      { projectId: id('blog'), description: 'Hosting', quantity: 1, unitCents: 1000, amountCents: 900 },
    ])
    expect(s.lines.map((l) => [l.position, l.amountCents])).toEqual([
      [0, 5000],
      [1, 900],
    ])
    expect(s.subtotalCents).toBe(5900)
    expect(fx.app.statements.refill(d.id).subtotalCents).toBe(135000)
  })

  it('only accepts lines for the client projects, also at issue time', () => {
    const other = fx.app.clients.create({ name: 'Other' })
    fx.app.projects.update(id('blog'), { clientId: other.id })
    expect(() => fx.app.statements.setLines(draft().id, [{ projectId: id('blog'), description: 'x', quantity: 1, unitCents: 100 }])).toThrow(
      /does not belong/,
    )
    fx.app.projects.update(id('blog'), { clientId: acme.id })
    const d = draft()
    fx.app.projects.update(id('shop'), { clientId: other.id })
    expect(() => fx.app.statements.issue(d.id)).toThrow(/does not belong/)
  })

  it('paid records one net payment per project; unpaid removes exactly those; repeat is safe', () => {
    const s = fx.app.statements.issue(draft().id)
    fx.app.statements.markPaid(s.id, { date: '2026-11-05' })
    expect(fx.app.statements.markPaid(s.id, { date: '2026-11-05' }).status).toBe('paid')
    const pays = fx.app.finance.repo.payments({ clientId: acme.id })
    expect(pays.map((p) => p.amountCents).sort((a, b) => a - b)).toEqual([15000, 120000])
    expect(pays.every((p) => p.statementId === s.id && p.note.includes('PF-2026-001') && p.date === '2026-11-05')).toBe(true)
    fx.app.finance.repo.addPayment({ projectId: id('shop'), amount: 10, date: '2026-11-06' })
    fx.app.statements.markUnpaid(s.id)
    expect(fx.app.finance.repo.payments({ clientId: acme.id }).map((p) => p.amountCents)).toEqual([1000])
    expect(fx.app.statements.get(s.id)).toMatchObject({ status: 'issued', paidDate: null })
    // Payments already removed by hand: unpaid after paid again must not fail.
    fx.app.statements.markPaid(s.id)
    for (const p of fx.app.finance.repo.payments({ clientId: acme.id }).filter((p) => p.statementId === s.id)) {
      fx.app.finance.repo.removePayment(p.id)
    }
    expect(fx.app.statements.markUnpaid(s.id).status).toBe('issued')
  })

  it('void keeps the number; the next issue continues the sequence', () => {
    const a = fx.app.statements.issue(draft().id, { issueDate: '2026-10-09' })
    fx.app.statements.void(a.id)
    const b = fx.app.statements.issue(draft().id, { issueDate: '2026-10-10' })
    expect(fx.app.statements.get(a.id)).toMatchObject({ status: 'void', number: 'PF-2026-001' })
    expect(b.number).toBe('PF-2026-002')
  })

  it('deletes drafts, resolves by number and lists overdue issued statements', () => {
    const d = draft()
    fx.app.statements.remove(d.id)
    expect(() => fx.app.statements.get(d.id)).toThrow(/not found/i)
    const s = fx.app.statements.issue(draft().id, { issueDate: '2026-08-01' })
    expect(fx.app.statements.resolve('pf-2026-001')).toBe(s.id)
    expect(fx.app.statements.overdue().map((x) => x.id)).toEqual([s.id])
    expect(fx.app.statements.get(s.id).overdue).toBe(true)
    expect(fx.app.statements.list({ clientId: acme.id, status: 'issued' })).toHaveLength(1)
  })
})
