import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFixture, type Fixture } from './helpers.js'

let fx: Fixture
const OCT = { from: '2026-10-01', to: '2026-10-31' }

/** One transcript line per listed local time; ends with the session's cost. */
function session(dir: string, id: string, cwd: string, day: string, times: string[], usd: number) {
  const lines = times.map((t) =>
    JSON.stringify({ type: 'user', timestamp: new Date(`${day}T${t}`).toISOString(), cwd, sessionId: id }),
  )
  lines.push(JSON.stringify({ type: 'cost-state', sessionId: id, totalCostUSD: usd }))
  writeFileSync(join(dir, `${id}.jsonl`), lines.join('\n') + '\n')
}

beforeEach(async () => {
  fx = createFixture({ 'shop/composer.json': '{}', 'blog/index.html': '' })
  await fx.app.scan()
  const dir = join(fx.root, '.claude-projects')
  mkdirSync(dir)
  // shop: 10:00–11:00 every 10 min → one 62-minute block; blog: 09:00–09:28 → 30 minutes.
  session(dir, 's1', join(fx.root, 'shop'), '2026-10-01', ['10:00', '10:10', '10:20', '10:30', '10:40', '10:50', '11:00'], 10)
  session(dir, 's2', join(fx.root, 'blog'), '2026-10-02', ['09:00', '09:07', '09:14', '09:21', '09:28'], 5)
  fx.app.settings.update({ claudeProjectsDir: dir, usdRate: 0.9 })
  await fx.app.time.sync()
})
afterEach(() => fx.cleanup())

const id = (name: string) => fx.app.projects.resolve(name).id
const row = (report: ReturnType<typeof fx.app.finance.report>, label: string) => report.rows.find((r) => r.label === label)!

function setupMoney() {
  const f = fx.app.finance.repo
  f.addAgreement({ projectId: id('shop'), kind: 'hourly', amount: 60, startDate: '2026-10-01' })
  f.addAgreement({ projectId: id('shop'), kind: 'recurring', amount: '150', interval: 'month', startDate: '2026-09-15' })
  f.addAgreement({ projectId: id('blog'), kind: 'fixed', amount: '3.000', startDate: '2026-10-01', endDate: '2026-10-30' })
  f.addPayment({ projectId: id('blog'), amount: '1000', date: '2026-10-05', note: 'Deposit' })
  f.addExpense({ projectId: id('shop'), amount: '15', startDate: '2026-10-03', note: 'Domain' })
  f.addExpense({ amount: '20', interval: 'month', startDate: '2026-01-10', note: 'VPS' })
}

describe('finance report', () => {
  it('accrues revenue and allocates costs (pay-as-you-go AI)', () => {
    setupMoney()
    const report = fx.app.finance.report({ range: OCT })
    expect(report.currency).toBe('EUR')

    const shop = row(report, 'shop')
    expect(shop.minutes).toBe(62)
    expect(shop.earnedCents).toBe(6200 + 15000) // 62 min at 60/h + October fee
    expect(shop.aiCents).toBe(900) // $10 × 0.9
    expect(shop.expenseCents).toBe(1500 + Math.round((2000 * 62) / 92))
    expect(shop.marginCents).toBe(shop.earnedCents - shop.costCents)
    expect(shop.effectiveRateCents).toBe(Math.round(shop.marginCents / (62 / 60)))

    const blog = row(report, 'blog')
    expect(blog).toMatchObject({ minutes: 30, earnedCents: 300000, collectedCents: 100000, aiCents: 450 })
    expect(blog.expenseCents).toBe(Math.round((2000 * 30) / 92))
    expect(report.totals.earnedCents).toBe(shop.earnedCents + blog.earnedCents)
    expect(report.totals.overheadCents).toBe(0)
    expect(report.totals.minutes).toBe(92) // wall-clock hours from the Time report
  })

  it('splits a subscription by usage instead of the API cost', () => {
    setupMoney()
    fx.app.finance.repo.addAiPlan({ kind: 'subscription', monthlyAmount: 90, startDate: '2026-10-01' })
    const report = fx.app.finance.report({ range: OCT })
    expect(row(report, 'shop').aiCents).toBe(6000) // 10/15 of 90
    expect(row(report, 'blog').aiCents).toBe(3000)
  })

  it('keeps costs without project hours or usage as overhead', () => {
    fx.app.finance.repo.addExpense({ amount: 20, startDate: '2026-11-05', note: 'Tool' })
    fx.app.finance.repo.addAiPlan({ kind: 'subscription', monthlyAmount: 90, startDate: '2026-11-01' })
    const report = fx.app.finance.report({ range: { from: '2026-11-01', to: '2026-11-30' } })
    expect(report.rows).toEqual([])
    expect(report.totals).toMatchObject({ overheadCents: 11000, costCents: 11000, marginCents: -11000, effectiveRateCents: null })
    expect(fx.app.finance.report({ range: { from: '2026-11-01', to: '2026-11-30' } }, 'project', { projectId: id('shop') }).totals.overheadCents).toBe(0)
  })

  it('groups by client and filters', () => {
    setupMoney()
    const acme = fx.app.clients.create({ name: 'Acme' })
    fx.app.projects.update(id('shop'), { clientId: acme.id })
    const byClient = fx.app.finance.report({ range: OCT }, 'client')
    expect(byClient.rows.map((r) => r.label).sort()).toEqual(['Acme', 'No client'])
    const onlyAcme = fx.app.finance.report({ range: OCT }, 'project', { clientId: acme.id })
    expect(onlyAcme.rows.map((r) => r.label)).toEqual(['shop'])
  })

  it('computes lifetime totals and what clients owe up to today', () => {
    setupMoney()
    const acme = fx.app.clients.create({ name: 'Acme' })
    fx.app.projects.update(id('shop'), { clientId: acme.id })
    // Today is 2026-10-08 in the fixture.
    const lifetime = fx.app.finance.report({ lifetime: true })
    expect(lifetime.range).toEqual({ from: '2026-01-10', to: '2026-10-08' })
    expect(row(lifetime, 'blog').earnedCents).toBe(80000) // 8 of 30 days at 100/day

    const owed = fx.app.finance.owed()
    expect(owed.find((o) => o.clientName === 'Acme')).toMatchObject({ owedCents: 15000 + 6200 }) // Sep 15 fee + hours
    expect(owed.find((o) => o.clientName === 'No client')).toMatchObject({ earnedCents: 80000, collectedCents: 100000, owedCents: -20000 })
  })
})

describe('finance records', () => {
  it('validates agreements and rejects overlapping hourly rates', () => {
    const f = fx.app.finance.repo
    f.addAgreement({ projectId: id('shop'), kind: 'hourly', amount: 50, startDate: '2026-01-01', endDate: '2026-06-30' })
    expect(() => f.addAgreement({ projectId: id('shop'), kind: 'hourly', amount: 60, startDate: '2026-06-01' })).toThrow(/already has an hourly rate/)
    expect(f.addAgreement({ projectId: id('shop'), kind: 'hourly', amount: 60, startDate: '2026-07-01' }).amountCents).toBe(6000)
    expect(() => f.addAgreement({ projectId: id('shop'), kind: 'fixed', amount: 100, interval: 'month' })).toThrow(/Only recurring/)
    expect(() => f.addAgreement({ projectId: id('shop'), kind: 'fixed', amount: 100, startDate: '2026-05-01', endDate: '2026-04-01' })).toThrow(/before the start/)
    expect(() => f.addAgreement({ projectId: id('shop'), kind: 'bonus' as never, amount: 1 })).toThrow(/Invalid agreement type/)
    expect(() => f.addAgreement({ projectId: 'nope', kind: 'fixed', amount: 1 })).toThrow(/Project not found/)
    const fixed = f.addAgreement({ projectId: id('shop'), kind: 'fixed', amount: 100, startDate: '2026-05-01' })
    expect(f.updateAgreement(fixed.id, { endDate: '2026-05-31' }).endDate).toBe('2026-05-31')
    expect(f.resolve('agreements', fixed.id.slice(0, 8))).toBe(fixed.id)
    f.removeAgreement(fixed.id)
    expect(f.agreements(id('shop'))).toHaveLength(2)
  })

  it('validates payments, expenses and AI plans', () => {
    const f = fx.app.finance.repo
    const deal = f.addAgreement({ projectId: id('shop'), kind: 'fixed', amount: 1000 })
    expect(() => f.addPayment({ projectId: id('blog'), amount: 10, agreementId: deal.id })).toThrow(/does not belong/)
    expect(f.addPayment({ projectId: id('shop'), amount: '500,00', agreementId: deal.id }).amountCents).toBe(50000)
    expect(() => f.addPayment({ projectId: id('shop'), amount: 0 })).toThrow(/Invalid amount/)
    expect(() => f.addExpense({ amount: 10, endDate: '2026-12-31' })).toThrow(/Only recurring/)
    const shared = f.addExpense({ amount: 10, interval: 'month', startDate: '2026-01-01' })
    expect(f.updateExpense(shared.id, { endDate: '2026-06-30' }).endDate).toBe('2026-06-30')
    expect(f.expenses({ shared: true })).toHaveLength(1)

    f.addAiPlan({ kind: 'api', startDate: '2026-01-01', endDate: '2026-04-30' })
    expect(() => f.addAiPlan({ kind: 'subscription', monthlyAmount: 90, startDate: '2026-04-01' })).toThrow(/Overlaps/)
    expect(() => f.addAiPlan({ kind: 'subscription', startDate: '2026-05-01' })).toThrow(/Monthly fee/)
    expect(f.addAiPlan({ kind: 'subscription', monthlyAmount: '90', startDate: '2026-05-01' }).monthlyCents).toBe(9000)
  })

  it('validates currency settings', () => {
    expect(fx.app.settings.update({ currency: 'usd', usdRate: 1 })).toMatchObject({ currency: 'USD', usdRate: 1 })
    expect(() => fx.app.settings.update({ currency: 'EURO' })).toThrow(/3-letter/)
    expect(() => fx.app.settings.update({ usdRate: 0 })).toThrow(/positive/)
  })
})
