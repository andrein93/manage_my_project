# mmp Statements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Client statements (pro-forma): a draft prefilled from what was earned in a period, editable, issued with a per-year number, printed to PDF from the browser, and marked paid (which records payments).

**Architecture:** Revenue accrual is extracted from `FinanceService.compute` into `earnedByAgreement(range)` (one source of truth). A new `StatementRepository` (`src/core/finance/statements.ts`) owns statements and lines in SQLite (migration appended to `MIGRATIONS`) and uses `FinanceRepository.addPayment/removePayment` for paid/unpaid. Interfaces follow the existing finance patterns: HTTP in `src/server/finance-routes.ts`, CLI in `src/cli/finance.ts`, MCP in `src/mcp/finance-tools.ts`. The dashboard gets a statement page, a print page and billing settings.

**Tech Stack:** Node 22 `node:sqlite`, TypeScript, Fastify + zod, commander, MCP SDK, Vue 3 + vue-router + vue-i18n, vitest.

**Spec:** `docs/superpowers/specs/2026-10-09-statements-design.md`

## Global Constraints

- Amounts in integer cents; mmp figures are net of VAT. VAT is display-only (document rate); payments recorded on "paid" are net per project.
- Statements, lines and billing fields are local (not in the team-sync `COLUMNS` lists); payments created by statements sync like any payment.
- Number format `${prefix}${year}-${seq padded to 3}`; sequence per issue year, assigned inside a transaction; never reused (void keeps it).
- Only drafts are editable or deletable; issued/paid/void are read-only except status transitions draft→issued→paid⇄issued, issued→void.
- Every line's project must belong to the statement's client.
- CLI and MCP text in English; UI strings in all six locales (`tests/locales.test.ts`). The print page uses the statement's `language`.
- Follow existing patterns: soft-delete columns (`deleted_at`), `owner_id`, `newId()`, `now()`, `UserError(message, 'not_found')`, `transaction(db, fn)`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Issuing two statements back to back, and the first issue of a new year → numbers 001, 002 and the year restarts at 001; no duplicate on retry after an error. Test in Task 3.
2. Marking paid twice, or unpaid on a statement whose payments were deleted by hand → no duplicate payments, no crash. Test in Task 3.
3. A client's project moved to another client after the draft was created → issue refuses with a clear message (line project no longer belongs to the client). Test in Task 3.
4. Hourly agreement with a rate change mid-period (two agreements) → two lines with their own hours and rates, totals equal the finance report's earned for that client and period. Test in Task 1/3.
5. Print page opened while the UI is dark → prints light, in the statement's language. Browser check in Task 7.

---

### Task 1: `earnedByAgreement` (refactor with regression guard)

**Files:** Modify `src/core/finance/report.ts`. Test: `tests/finance.test.ts` (append) — read the file first to reuse its fixtures/helpers.

**Interfaces — Produces:**

```ts
export interface AgreementEarning { agreementId: string; projectId: string; cents: number; minutes: number; occurrences: number }
// FinanceService
earnedByAgreement(range: DateRange): AgreementEarning[]
```

`cents` is unrounded (the report rounds totals); `minutes` is summed for hourly agreements (0 otherwise); `occurrences` counts recurring fee dates in range (0 otherwise).

- [ ] **Step 1: Failing test.** In `tests/finance.test.ts`, using the existing fixture setup (projects, an hourly agreement with logged time, a fixed agreement, a recurring agreement), add:

```ts
it('earnedByAgreement matches the report earned per project', () => {
  const range = { from: '2026-10-01', to: '2026-10-31' }
  const byAgreement = app.finance.earnedByAgreement(range)
  const report = app.finance.report({ range }, 'project')
  for (const row of report.rows) {
    const sum = byAgreement.filter((e) => e.projectId === row.key).reduce((s, e) => s + e.cents, 0)
    expect(Math.round(sum)).toBe(row.earnedCents)
  }
  expect(byAgreement.find((e) => e.minutes > 0)).toBeDefined()
})
```

Adapt project/agreement setup to the helpers already in the file (read it); the assertion stays as written.

- [ ] **Step 2:** `npx vitest run tests/finance.test.ts` → FAIL (`earnedByAgreement` is not a function).
- [ ] **Step 3: Implement.** In `report.ts`, move the body of the `// Revenue` loop into:

```ts
  /** What each agreement earned in `range` (unrounded cents), with hours and fee counts for statements. */
  earnedByAgreement(range: DateRange): AgreementEarning[] {
    const ext = { from: monthOf(range.from).from, to: monthOf(range.to).to }
    const daily = this.time.daily(ext)
    this.addTeamMinutes(daily, ext)
    return this.earnedFrom(range, daily)
  }

  private earnedFrom(range: DateRange, daily: ReturnType<TimeRepository['daily']>): AgreementEarning[] {
    const out: AgreementEarning[] = []
    for (const a of this.repo.agreements()) {
      const earned: DayAmounts = new Map()
      let minutesSum = 0
      let count = 0
      if (a.kind === 'hourly') {
        for (const [day, minutes] of daily.get(a.projectId)?.minutes ?? new Map<string, number>()) {
          if (day < range.from || day > range.to || day < a.startDate || (a.endDate && day > a.endDate)) continue
          addTo(earned, day, (minutes * a.amountCents) / 60)
          minutesSum += minutes
        }
      } else if (a.kind === 'fixed') {
        spreadFixed(a.amountCents, a.startDate, a.endDate, range, earned)
      } else {
        for (const day of occurrences(a.startDate, a.endDate, a.interval ?? 'month', range.to)) {
          if (day >= range.from) {
            addTo(earned, day, a.amountCents)
            count++
          }
        }
      }
      let cents = 0
      for (const v of earned.values()) cents += v
      out.push({ agreementId: a.id, projectId: a.projectId, cents, minutes: minutesSum, occurrences: count })
    }
    return out
  }
```

and in `compute`, replace the revenue loop with `for (const e of this.earnedFrom(range, daily)) acc(e.projectId).earned += e.cents`. Export `AgreementEarning` from `src/core/finance/types.ts`. Use the actual type name of `this.time.daily(...)`'s return (read `src/core/time` to name it; if it is not exported, export it).

- [ ] **Step 4:** `npx vitest run tests/finance.test.ts tests/finance-interfaces.test.ts` → PASS (existing finance tests are the regression guard).
- [ ] **Step 5: Commit** `refactor(finance): earnedByAgreement as the single revenue accrual`.

---

### Task 2: Schema, billing settings, client billing fields

**Files:** Modify `src/core/db.ts` (append a migration string to `MIGRATIONS`), `src/core/settings.ts`, `src/core/clients.ts`, `src/core/types.ts` (Client/ClientInput), `src/server/routes.ts` (`settingsBody`), the clients route body schema (in `src/server/organize-routes.ts`; read it). Test: `tests/statements.test.ts` (new; this task adds its first tests).

**Interfaces — Produces:**
- Settings: `billing: Billing` with `interface Billing { name: string; address: string; taxId: string; iban: string; footer: string; numberPrefix: string; vatRate: number; dueDays: number }`, default `{ name: '', address: '', taxId: '', iban: '', footer: '', numberPrefix: 'PF-', vatRate: 22, dueDays: 30 }`. `settings.update({ billing: Partial<Billing> })` merges and validates (texts ≤ 2000 chars, prefix ≤ 12 chars of `[A-Za-z0-9/_-]`, vatRate 0–100, dueDays integer 0–365).
- Client: `billingName`, `billingAddress`, `billingTaxId` (strings, default ''); `ClientInput` accepts them (≤ 2000 chars each).

Migration (append as a new array element):

```sql
ALTER TABLE clients ADD COLUMN billing_name TEXT NOT NULL DEFAULT '';
ALTER TABLE clients ADD COLUMN billing_address TEXT NOT NULL DEFAULT '';
ALTER TABLE clients ADD COLUMN billing_tax_id TEXT NOT NULL DEFAULT '';
ALTER TABLE payments ADD COLUMN statement_id TEXT;

CREATE TABLE statements (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  number TEXT,
  year INTEGER,
  seq INTEGER,
  period_from TEXT NOT NULL,
  period_to TEXT NOT NULL,
  issue_date TEXT,
  due_date TEXT,
  paid_date TEXT,
  vat_rate REAL NOT NULL DEFAULT 0,
  language TEXT NOT NULL DEFAULT 'en',
  notes TEXT NOT NULL DEFAULT '',
  snapshot TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE UNIQUE INDEX statements_number ON statements(year, seq) WHERE seq IS NOT NULL;

CREATE TABLE statement_lines (
  id TEXT PRIMARY KEY,
  statement_id TEXT NOT NULL REFERENCES statements(id),
  position INTEGER NOT NULL,
  project_id TEXT NOT NULL,
  agreement_id TEXT,
  description TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit_cents INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL
);
```

- [ ] **Step 1: Failing tests** in `tests/statements.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFixture, type Fixture } from './helpers.js'

let fx: Fixture
beforeEach(() => (fx = createFixture({ 'shop/composer.json': '{}', 'blog/index.html': '' })))
afterEach(() => fx.cleanup())

describe('billing data', () => {
  it('stores and validates billing settings', () => {
    expect(fx.app.settings.get().billing).toMatchObject({ numberPrefix: 'PF-', vatRate: 22, dueDays: 30 })
    fx.app.settings.update({ billing: { name: 'Andrea Merlin', iban: 'IT60X0542811101000000123456' } })
    expect(fx.app.settings.get().billing).toMatchObject({ name: 'Andrea Merlin', vatRate: 22 })
    expect(() => fx.app.settings.update({ billing: { vatRate: 150 } })).toThrow(/vatRate/)
    expect(() => fx.app.settings.update({ billing: { numberPrefix: 'a b' } })).toThrow(/prefix/)
  })

  it('stores client billing fields', () => {
    const c = fx.app.clients.create({ name: 'Acme' })
    const u = fx.app.clients.update(c.id, { billingName: 'Acme S.r.l.', billingTaxId: 'IT01234567890' })
    expect(u).toMatchObject({ billingName: 'Acme S.r.l.', billingTaxId: 'IT01234567890', billingAddress: '' })
  })
})
```

(Use the client-creation method name that `ClientRepository` actually has — read `src/core/clients.ts`.)

- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** the migration, `Billing` in settings (`DEFAULT_SETTINGS.billing`, validation in `update`, merged with the current value), client columns in the row mapper, `create`/`update` and the `Client`/`ClientInput` types; extend `settingsBody` with `billing: z.object({...}).partial().strict().optional()` and the client route schema with the three fields.
- [ ] **Step 4:** `npx vitest run tests/statements.test.ts && npm test` → PASS (full suite: migrations must not break sync or other tests).
- [ ] **Step 5: Commit** `feat(finance): billing details for you and your clients; statements schema`.

---

### Task 3: `StatementRepository`

**Files:** Create `src/core/finance/statements.ts`; modify `src/core/finance/types.ts`, `src/core/finance/repository.ts` (payments get `statementId`), `src/core/app.ts` (wire `statements`). Test: `tests/statements.test.ts`.

**Interfaces — Produces** (types in `types.ts`):

```ts
export const STATEMENT_STATUSES = ['draft', 'issued', 'paid', 'void'] as const
export type StatementStatus = (typeof STATEMENT_STATUSES)[number]
export interface StatementLine { id: string; position: number; projectId: string; projectName: string; agreementId: string | null; description: string; quantity: number; unitCents: number; amountCents: number }
export interface BillingParty { name: string; address: string; taxId: string }
export interface StatementSnapshot { issuer: BillingParty & { iban: string; footer: string }; client: BillingParty }
export interface Statement {
  id: string; clientId: string; clientName: string; status: StatementStatus; number: string | null
  periodFrom: string; periodTo: string; issueDate: string | null; dueDate: string | null; paidDate: string | null
  vatRate: number; language: string; notes: string; snapshot: StatementSnapshot | null
  lines: StatementLine[]; subtotalCents: number; vatCents: number; totalCents: number; currency: string
  overdue: boolean; createdAt: string; updatedAt: string
}
export interface StatementLineInput { projectId: string; description: string; quantity: number; unitCents: number; amountCents?: number }
```

`StatementRepository(db, finance: FinanceService, financeRepo: FinanceRepository, settings: SettingsRepository, clients: ClientRepository, projects: ProjectRepository, today: () => string)` with:

```ts
list(filter?: { clientId?: string; status?: StatementStatus }): Statement[]   // newest first
get(id: string): Statement                                                    // throws not_found
resolve(ref: string): string                                                  // by number (case-insensitive) or id
create(input: { clientId: string; from: string; to: string; language?: string }): Statement  // prefilled draft
update(id: string, input: { periodFrom?: string; periodTo?: string; vatRate?: number; language?: string; notes?: string; dueDate?: string | null }): Statement
setLines(id: string, lines: StatementLineInput[]): Statement
refill(id: string): Statement
issue(id: string, input?: { issueDate?: string }): Statement
markPaid(id: string, input?: { date?: string }): Statement
markUnpaid(id: string): Statement
void(id: string): Statement
remove(id: string): void                                                      // drafts only
overdue(): Statement[]                                                        // issued, due_date < today
```

- [ ] **Step 1: Failing tests** — append to `tests/statements.test.ts` a `describe('statements')` with a helper that creates client Acme, assigns `shop` and `blog` to it, adds an hourly agreement (50/h from 2026-10-01) to `shop` with time entries via `fx.app.time.log(...)` (read `TimeService` for the manual entry method) totalling 3 h in October, a recurring 200/month agreement on `blog` from 2026-01-01, and a fixed 1000 agreement on `blog` from 2026-10-01 to 2026-10-31. Tests:

```ts
it('prefills a draft from what was earned in the period', () => {
  const s = fx.app.statements.create({ clientId: acme.id, from: '2026-10-01', to: '2026-10-31' })
  expect(s.status).toBe('draft')
  expect(s.number).toBeNull()
  const hourly = s.lines.find((l) => l.projectName === 'shop')!
  expect(hourly).toMatchObject({ quantity: 3, unitCents: 5000, amountCents: 15000 })
  expect(s.lines.map((l) => l.amountCents).sort((a, b) => a - b)).toEqual([15000, 20000, 100000])
  expect(s.subtotalCents).toBe(135000)
  expect(s.vatCents).toBe(29700) // 22% default
  expect(s.totalCents).toBe(164700)
  const report = fx.app.finance.report({ range: { from: '2026-10-01', to: '2026-10-31' } }, 'client')
  expect(report.rows.find((r) => r.key === acme.id)!.earnedCents).toBe(s.subtotalCents)
})

it('numbers issued statements per year without gaps', () => {
  const a = fx.app.statements.issue(draft().id, { issueDate: '2026-10-09' })
  const b = fx.app.statements.issue(draft().id, { issueDate: '2026-11-02' })
  const c = fx.app.statements.issue(draft().id, { issueDate: '2027-01-05' })
  expect([a.number, b.number, c.number]).toEqual(['PF-2026-001', 'PF-2026-002', 'PF-2027-001'])
  expect(a.dueDate).toBe('2026-11-08')
})

it('freezes billing data at issue', () => {
  fx.app.settings.update({ billing: { name: 'Me' } })
  const s = fx.app.statements.issue(draft().id)
  fx.app.settings.update({ billing: { name: 'Someone else' } })
  expect(fx.app.statements.get(s.id).snapshot!.issuer.name).toBe('Me')
})

it('refuses to edit or delete issued statements, and to issue an empty one', () => {
  const empty = fx.app.statements.create({ clientId: acme.id, from: '2025-01-01', to: '2025-01-31' })
  expect(() => fx.app.statements.issue(empty.id)).toThrow(/at least one line/)
  const s = fx.app.statements.issue(draft().id)
  expect(() => fx.app.statements.setLines(s.id, [])).toThrow(/draft/)
  expect(() => fx.app.statements.remove(s.id)).toThrow(/draft/)
})

it('only accepts lines for the client projects, also at issue time', () => {
  const other = fx.app.clients.create({ name: 'Other' })
  const d = draft()
  const shop = fx.app.projects.resolve('shop')
  expect(() => fx.app.statements.setLines(d.id, [{ projectId: shop.id, description: 'x', quantity: 1, unitCents: 100 }])).not.toThrow()
  fx.app.projects.update(shop.id, { clientId: other.id })
  expect(() => fx.app.statements.issue(d.id)).toThrow(/does not belong/)
})

it('paid records one net payment per project; unpaid removes exactly those; repeat is safe', () => {
  const s = fx.app.statements.issue(draft().id)
  fx.app.statements.markPaid(s.id, { date: '2026-11-05' })
  fx.app.statements.markPaid(s.id, { date: '2026-11-05' }) // no-op when already paid
  const pays = fx.app.finance.repo.payments({ clientId: acme.id })
  expect(pays.map((p) => p.amountCents).sort((a, b) => a - b)).toEqual([15000, 120000])
  expect(pays.every((p) => p.statementId === s.id && p.note.includes('PF-2026-001'))).toBe(true)
  fx.app.finance.repo.addPayment({ projectId: fx.app.projects.resolve('shop').id, amount: 10, date: '2026-11-06' })
  fx.app.statements.markUnpaid(s.id)
  expect(fx.app.finance.repo.payments({ clientId: acme.id }).map((p) => p.amountCents)).toEqual([1000])
  expect(fx.app.statements.get(s.id).status).toBe('issued')
})

it('void keeps the number; the next issue continues the sequence', () => {
  const a = fx.app.statements.issue(draft().id, { issueDate: '2026-10-09' })
  fx.app.statements.void(a.id)
  const b = fx.app.statements.issue(draft().id, { issueDate: '2026-10-10' })
  expect(fx.app.statements.get(a.id)).toMatchObject({ status: 'void', number: 'PF-2026-001' })
  expect(b.number).toBe('PF-2026-002')
})

it('lists overdue issued statements', () => {
  const s = fx.app.statements.issue(draft().id, { issueDate: '2026-08-01' }) // due 2026-08-31 < TODAY 2026-10-08
  expect(fx.app.statements.overdue().map((x) => x.id)).toEqual([s.id])
  expect(fx.app.statements.get(s.id).overdue).toBe(true)
})
```

where `draft()` creates a prefilled October draft for Acme. Access to `fx.app.finance.repo` must match how the app exposes the finance repository (read `src/core/app.ts`; adapt the property path, not the assertion).

- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** `src/core/finance/statements.ts`. Key rules (all inside `transaction` where they write):
  - Prefill: `finance.earnedByAgreement({from,to})` filtered to agreements whose project's `client.id === clientId` and `Math.round(cents) > 0`; descriptions per spec (`formatMinutes`-style hours with 2 decimals: `quantity = Math.round(minutes / 60 * 100) / 100`); hourly `unitCents = a.amountCents`, `amountCents = Math.round(cents)` (not quantity × unit, so it equals the report exactly); fixed `quantity 1, unit = amount = round(cents)`; recurring `quantity = occurrences, unit = a.amountCents, amount = round(cents)`. Order by project name, then kind (hourly, fixed, recurring).
  - `language` default: `'en'`; `vatRate` default from `settings.billing.vatRate`.
  - `setLines`: draft only; each project must belong to the client; `quantity > 0` finite, `unitCents` integer; `amountCents` defaults to `Math.round(quantity * unitCents)`; description 1–500 chars; positions 0..n-1.
  - `issue`: draft only; ≥ 1 line and subtotal ≠ 0; re-check every line's project belongs to the client (`"Line <n>: project <name> does not belong to <client> any more"`); `year` = issue year; `seq = (SELECT MAX(seq) FROM statements WHERE year = ?) + 1` (or 1); `number = prefix + year + '-' + String(seq).padStart(3, '0')`; `due_date = issueDate + dueDays` unless already set; `snapshot` from current billing settings and client billing fields (fallback: client name for billingName).
  - `markPaid`: issued only (paid → no-op returning the statement); one `financeRepo.addPayment({ projectId, amount: cents/100, date, note: \`Statement ${number}\` })` per project, then set `statement_id` on those payment rows (extend `addPayment` input with optional `statementId` instead of a second UPDATE); status `paid`, `paid_date`.
  - `markUnpaid`: paid only; soft-delete payments with that `statement_id` (`financeRepo.removePayment` for each found); status `issued`, `paid_date` null.
  - `void`: issued only. `remove`: draft only (hard delete lines, soft delete statement).
  - Totals: subtotal Σ amount; `vatCents = Math.round(subtotal * vatRate / 100)`; `overdue = status === 'issued' && dueDate < today()`.
  - Payments: add `statementId: string | null` to `Payment`/`toPayment`, and `statementId?: string` to `PaymentInput`.
  - Wire in `app.ts`: `statements: new StatementRepository(...)` exposed on `App`.
- [ ] **Step 4:** `npx vitest run tests/statements.test.ts && npm test` → PASS.
- [ ] **Step 5: Commit** `feat(finance): statements — prefilled drafts, numbering, issue, paid/unpaid, void`.

---

### Task 4: HTTP routes

**Files:** Modify `src/server/finance-routes.ts`. Test: `tests/finance-interfaces.test.ts` (append; read its setup).

Routes (zod-validated like the existing finance routes; `UserError` → 4xx via the existing error handler):

| Method | Path | Body / query | Calls |
|---|---|---|---|
| GET | `/api/statements` | `?client=&status=` | `list` |
| POST | `/api/statements` | `{ clientId, from, to, language? }` | `create` |
| GET | `/api/statements/:id` | | `get` |
| PATCH | `/api/statements/:id` | `{ periodFrom?, periodTo?, vatRate?, language?, notes?, dueDate? }` | `update` |
| PUT | `/api/statements/:id/lines` | `{ lines: StatementLineInput[] }` (≤ 200) | `setLines` |
| POST | `/api/statements/:id/refill` · `/issue` (`{issueDate?}`) · `/paid` (`{date?}`) · `/unpaid` · `/void` | | |
| DELETE | `/api/statements/:id` | | `remove` → 204 |

- [ ] **Step 1: Failing test:** create client + project + agreement via the API, `POST /api/statements` → 200 draft with lines; `POST …/issue` → number; `POST …/paid` → status paid and `GET /api/finance/owed` reflects it; `DELETE` on an issued statement → 400; unknown id → 404.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS + `npm test`.
- [ ] **Step 5: Commit** `feat(server): statements API`.

---

### Task 5: CLI

**Files:** Modify `src/cli/finance.ts` (inside `registerFinanceCommands`). Test: `tests/finance-interfaces.test.ts` or `tests/cli.test.ts` (whichever already tests finance CLI; read them).

Commands (`statement` group, alias `st`):
- `create <client> [--from <date>] [--to <date>] [--period this-month|last-month]` (default `last-month`; dates via existing `resolvePeriod`/`rangeFrom` helpers in `src/core/time/periods.ts`) → prints the draft (see `show`).
- `list [--client <ref>] [--status <s>]` → table NUMBER (or "draft"), CLIENT, PERIOD, TOTAL, STATUS (overdue shown as `issued (overdue)`).
- `show <ref>` → header, lines table (DESCRIPTION, QTY, UNIT, AMOUNT), subtotal/VAT/total, and `Print: http://localhost:<port>/statements/<id>/print`.
- `issue <ref> [--date]`, `paid <ref> [--date]`, `unpaid <ref>`, `void <ref>`, `delete <ref>`.

- [ ] **Step 1: Failing test:** `statement create Acme --period last-month` (fixture with an agreement and time last month relative to TODAY 2026-10-08 → September) prints a table with a total; `statement issue <id>` prints `PF-2026-001`; `statement list` contains `PF-2026-001`.
- [ ] Steps 2–4 as usual. **Step 5: Commit** `feat(cli): mmp statement`.

---

### Task 6: MCP tools

**Files:** Modify `src/mcp/finance-tools.ts`. Test: `tests/mcp.test.ts` (append; read its harness).

Tools: `create_statement` ({ client, from?, to?, period? } → draft summary with lines and print URL), `list_statements` ({ client?, status? }), `issue_statement` ({ statement }), `mark_statement_paid` ({ statement, date? }). Descriptions written for an AI ("Prepares a draft pro-forma statement for a client from what was earned in a period; the user reviews and edits it in the dashboard before issuing").

- [ ] Failing test: list tools includes the four; `create_statement` for Acme returns text containing the total and `/statements/`; `issue_statement` returns the number. Implement, pass, `npm test`. **Commit** `feat(mcp): statement tools`.

---

### Task 7: Dashboard

**Files:** Modify `web/src/api.ts`, `web/src/main.ts` (routes), `web/src/views/FinanceView.vue` (Statements tab), `web/src/views/ClientDetailView.vue` (billing fields + statements section), `web/src/views/SettingsView.vue` (+ new `web/src/components/BillingSettings.vue`), `web/src/views/OverviewView.vue` (overdue statements), locales ×6. Create `web/src/views/StatementView.vue`, `web/src/views/StatementPrintView.vue`, `web/src/statements.ts` (pure helpers). Test: `tests/web-statements.test.ts`. Server: `src/core/overview.ts` + `overview-types.ts` add `attention.overdueStatements: { id, number, clientName, totalCents, dueDate }[]` (test in `tests/extras.test.ts` or wherever overview is tested).

- [ ] **Step 1: Failing tests** for pure helpers in `web/src/statements.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { lineAmount, statementTotals } from '../web/src/statements'

describe('statement helpers', () => {
  it('computes a line amount from quantity and unit, rounding to cents', () => {
    expect(lineAmount(1.5, 3333)).toBe(5000)
    expect(lineAmount(0.333, 100)).toBe(33)
  })
  it('totals with VAT rounding like the server', () => {
    expect(statementTotals([15000, 20000, 100000], 22)).toEqual({ subtotalCents: 135000, vatCents: 29700, totalCents: 164700 })
    expect(statementTotals([], 22)).toEqual({ subtotalCents: 0, vatCents: 0, totalCents: 0 })
  })
})
```

plus the overview test for `overdueStatements`.

- [ ] **Step 2:** FAIL. **Step 3: Implement:**
  - `api.ts`: `Statement`, `StatementLine`, `StatementLineInput` types (re-exported from `src/core/finance/types`), `Billing` on `Settings`, client billing fields, and calls for every route of Task 4.
  - Routes: `{ path: '/statements/:id', name: 'statement', component: StatementView, props: true }`, `{ path: '/statements/:id/print', name: 'statement-print', component: StatementPrintView, props: true, meta: { bare: true } }`. In `App.vue`, when `route.meta.bare` render only `<RouterView />` (no sidebar, topbar, toasts, palette) and force `data-theme="light"` on `<html>` while mounted (restore on unmount).
  - `FinanceView`: a segmented toggle "Report | Statements"; the Statements tab lists `api.statements({})` with number/"Draft", client, period, total (formatMoney), status badge (draft neutral, issued accent, overdue danger, paid fresh, void dormant), row → statement page.
  - `ClientDetailView`: billing fields (billing name, address textarea, tax id) in the existing form; a "Statements" card with the client's statements and a "New statement" button with a period select (last month default, this month, custom from/to) → `api.createStatement` → navigate to it.
  - `StatementView`: PageHeader (number or "Draft", client, status badge); for drafts: period + "Refill from period" (confirm via a second click like other destructive buttons), VAT rate, language select (the six locales), due date, notes, editable lines table (project select limited to the client's projects, description, quantity, unit price, amount auto = `lineAmount` unless typed), add/remove/move lines, Save (PUT lines + PATCH fields), Issue, Delete draft. For issued/paid: read-only lines, totals, actions Print (opens print route in a new tab), Mark paid (date input default today) / Mark unpaid, Void (two-click confirm). Totals via `statementTotals`.
  - `StatementPrintView`: uses a local vue-i18n instance or `i18n.global.t` with `locale` = statement.language for its strings; A4 layout with `@page { size: A4; margin: 16mm }`, issuer block (snapshot.issuer or current billing for drafts with a "DRAFT" watermark), client block, number/issue/due dates, lines table, subtotal/VAT/total, IBAN, footer, notes; a "Print / Save as PDF" button hidden in `@media print`.
  - `BillingSettings.vue`: card with the Billing fields; saved via `api.updateSettings({ billing })`.
  - Overview: "Overdue statements" list in Needs attention (number, client, total, due date → statement page).
  - Strings: add a `statement` section (and `settings.billing*`, `clients.billing*`, `overview.overdueStatements`) to all six locales; keys identical; placeholders kept.
- [ ] **Step 4:** `npm run typecheck && npm test && npm run build`. Browser (headless CDP, test server on port 4488 with a temp data dir): create client with billing data, project with agreement and logged time, new statement → lines prefilled; edit a line; issue → number; print page in dark UI renders light, in the chosen language; mark paid → Finance "Collected" updates; overview shows an overdue statement when issue date is old.
- [ ] **Step 5: Commit** `feat(web): statements — editor, print page, billing settings, overdue on overview`.

---

### Task 8: Docs and wrap-up

- [ ] README: a "Statements" subsection under the finance section (what it is and is not, flow, print to PDF, CLI and AI examples).
- [ ] Add AI examples to `commands.example` in all locales only if the key structure allows (it is an array excluded from key parity; add one item "Prepare the October statement for Acme." translated).
- [ ] `npm run typecheck && npm test && npm run build`; commit `docs: statements`.
