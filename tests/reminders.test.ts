import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildNotifyCommand } from '../src/server/notify.js'
import { createFixture, TODAY, type Fixture } from './helpers.js'

let fx: Fixture
beforeEach(async () => {
  fx = createFixture({ 'shop/composer.json': '{}', 'blog/index.html': '' })
  await fx.app.scan()
})
afterEach(() => fx.cleanup())

const id = (name: string) => fx.app.projects.resolve(name).id

/** TODAY is 2026-10-08. */
function seed() {
  const shop = id('shop')
  const [late, today] = fx.app.tasks.create(shop, [
    { title: 'Late invoice fix', dueDate: '2026-10-01' },
    { title: 'Call Acme', dueDate: TODAY },
    { title: 'Next month', dueDate: '2026-11-20' },
  ])
  fx.app.finance.repo.addExpense({ amount: 15, startDate: '2026-10-10', note: 'Domain shop.test', projectId: shop })
  fx.app.finance.repo.addExpense({ amount: 99, startDate: '2026-10-25', note: 'Too far' })
  const acme = fx.app.clients.create({ name: 'Acme' })
  fx.app.projects.update(shop, { clientId: acme.id })
  fx.app.finance.repo.addAgreement({ projectId: shop, kind: 'fixed', amount: 500, startDate: '2026-07-01', endDate: '2026-07-31' })
  const s = fx.app.statements.issue(fx.app.statements.create({ clientId: acme.id, from: '2026-07-01', to: '2026-07-31' }).id, { issueDate: '2026-08-01' })
  const expiry = fx.app.fields.create({ name: 'Domain expiry', kind: 'date', remindDays: 14 })
  fx.app.fields.setValues(id('blog'), { [expiry.id]: '2026-10-15' })
  return { late, today, statement: s, expiry }
}

describe('reminders', () => {
  it('collects every kind, most urgent first', () => {
    const { late, today, statement, expiry } = seed()
    const list = fx.app.reminders.list(TODAY)
    expect(list.map((r) => r.kind)).toEqual(['statement_overdue', 'task_overdue', 'task_due_today', 'charge_soon', 'field_date'])
    expect(list.map((r) => r.key)).toEqual([
      `statement_overdue:${statement.id}`,
      `task_overdue:${late.id}`,
      `task_due_today:${today.id}:${TODAY}`,
      expect.stringMatching(/^charge_soon:pay:/),
      `field_date:${id('blog')}:${expiry.id}:2026-10-15`,
    ])
    expect(list[1]).toMatchObject({ severity: 'danger', title: 'Overdue task: Late invoice fix', href: `/projects/${id('shop')}`, date: '2026-10-01' })
    expect(list[0]).toMatchObject({ title: 'Statement PF-2026-001 is overdue', href: `/statements/${statement.id}` })
    expect(list[3]).toMatchObject({ title: 'To pay: Domain shop.test', date: '2026-10-10', params: { amountCents: 1500 } })
    expect(list[4]).toMatchObject({ title: 'Domain expiry: 2026-10-15', params: { days: 7, project: 'blog' } })
  })

  it('dismissed reminders stay hidden; snoozed ones come back the next day', () => {
    seed()
    const [first, second] = fx.app.reminders.list(TODAY)
    fx.app.reminders.dismiss(first.key)
    fx.app.reminders.snooze(second.key, TODAY)
    const keys = fx.app.reminders.list(TODAY).map((r) => r.key)
    expect(keys).not.toContain(first.key)
    expect(keys).not.toContain(second.key)
    const tomorrow = fx.app.reminders.list('2026-10-09').map((r) => r.key)
    expect(tomorrow).not.toContain(first.key)
    expect(tomorrow).toContain(second.key)
  })

  it('notifies each reminder at most once a day', () => {
    seed()
    const due = fx.app.reminders.dueForNotification(TODAY)
    expect(due).toHaveLength(5)
    fx.app.reminders.markNotified(due.map((r) => r.key), TODAY)
    expect(fx.app.reminders.dueForNotification(TODAY)).toHaveLength(0)
    expect(fx.app.reminders.dueForNotification('2026-10-09').length).toBeGreaterThan(0)
  })
})

describe('desktop notification command', () => {
  it('Windows: PowerShell toast with the text encoded, never interpolated into the command line', () => {
    const { cmd, args } = buildNotifyCommand('win32', "Reminder's \"title\" & <b>", 'Body; rm -rf /')
    expect(cmd).toBe('powershell.exe')
    expect(args.slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-EncodedCommand'])
    const script = Buffer.from(args[3], 'base64').toString('utf16le')
    expect(script).toContain("Reminder''s &quot;title&quot; &amp; &lt;b&gt;")
    expect(script).toContain('Body; rm -rf /')
    expect(args.join(' ')).not.toContain('rm -rf')
  })

  it('macOS: osascript with escaped quotes; Linux: notify-send arguments', () => {
    expect(buildNotifyCommand('darwin', 'Say "hi"', 'a\\b')).toEqual({
      cmd: 'osascript',
      args: ['-e', 'display notification "a\\\\b" with title "Say \\"hi\\""'],
    })
    expect(buildNotifyCommand('linux', 'T', 'B')).toEqual({ cmd: 'notify-send', args: ['--app-name=mmp', 'T', 'B'] })
  })
})

describe('desktop notification run', () => {
  it('does nothing while notifications are off; then groups 3+ and never repeats in a day', async () => {
    const { sendDueNotifications } = await import('../src/server/notify.js')
    seed()
    const sent: [string, string][] = []
    const send = async (title: string, body: string) => {
      sent.push([title, body])
      return true
    }
    expect(await sendDueNotifications(fx.app, TODAY, send)).toBe(0)
    fx.app.settings.update({ notifications: { desktop: true } })
    expect(await sendDueNotifications(fx.app, TODAY, send)).toBe(5)
    expect(sent).toHaveLength(1)
    expect(sent[0][0]).toBe('mmp: 5 things need you')
    expect(sent[0][1]).toContain('Statement PF-2026-001 is overdue')
    expect(await sendDueNotifications(fx.app, TODAY, send)).toBe(0)
  })

  it('sends one or two reminders individually, and keeps them pending if the system refuses', async () => {
    const { sendDueNotifications } = await import('../src/server/notify.js')
    fx.app.settings.update({ notifications: { desktop: true } })
    fx.app.tasks.create(id('shop'), [{ title: 'Call Acme', dueDate: TODAY }])
    const sent: string[] = []
    expect(await sendDueNotifications(fx.app, TODAY, async () => false)).toBe(0)
    expect(await sendDueNotifications(fx.app, TODAY, async (title) => (sent.push(title), true))).toBe(1)
    expect(sent).toEqual(['Due today: Call Acme'])
  })
})
