# mmp Statements — Design Spec

Date: 2026-10-09 · Status: draft for review · Builds on: Finance spec

## Purpose

Turn what mmp already knows (hours, agreements, what was earned) into a document to send a
client: a **statement / pro-forma** for a period, printable to PDF, tracked as issued and paid.
It has no fiscal value: the legal invoice is still made in the user's invoicing software, which
can copy the figures from it.

Success criteria: from a client page, "New statement" for a period produces a draft whose lines
are the amounts earned in that period; the user edits it, issues it (it gets a number and is
frozen), prints it to a clean A4 PDF from the browser; marking it paid records the payments, so
"Collected" and "Owed to you" update. The same works from the CLI and the AI (MCP).

## Decisions

- **Pro-forma only.** No fiscal numbering rules, no SDI/XML, no withholding or stamp duty.
- **Editable draft prefilled from accruals** (user's choice), then issue → frozen.
- **Paid creates payments** on the projects of the lines (user's choice); unmarking removes them.
- **Header with full billing data**: the user's own (Settings) and the client's (client page).
- **PDF via the browser's print**: a dedicated print page, "Save as PDF". No PDF library, same
  fonts and translations as the dashboard; CLI and MCP return the print URL.
- **Net amounts.** mmp amounts are net of VAT; the statement shows net subtotal, VAT at a
  document-level rate (display only, default from Settings, may be 0) and total. Payments
  recorded on "paid" are the **net** subtotal per project.

## Data model (migration)

`statements`: `id` (uuid), `client_id`, `status` (`draft` | `issued` | `paid` | `void`),
`number` (null until issued), `year` (issue year, for numbering), `seq` (per-year counter),
`period_from`, `period_to`, `issue_date`, `due_date`, `paid_date`, `vat_rate` (percent, number),
`language` (locale code), `notes`, `snapshot` (JSON: issuer and client billing data at issue
time, null for drafts), `created_at`, `updated_at`. Unique `(year, seq)`.

`statement_lines`: `id`, `statement_id`, `position`, `project_id`, `agreement_id` (null for
manual lines), `description`, `quantity` (real; hours for hourly lines, 1 otherwise),
`unit_cents`, `amount_cents` (stored, = round(quantity × unit_cents) unless edited).

`payments` gains `statement_id` (nullable) so "paid" can remove exactly what it created.

Settings gain `billing`: `{ name, address, taxId, iban, footer, numberPrefix ('PF-'),
vatRate (22), dueDays (30) }`. Clients gain `billingName`, `billingAddress`, `billingTaxId`.

## Behaviour

**Prefill.** `FinanceService.earnedByAgreement(range)` (extracted from the existing revenue
loop in `compute`, which then uses it — one source of truth) returns, per agreement, the cents
earned and, for hourly agreements, the minutes. A draft for client C and period P gets one line
per agreement of C's projects with earned > 0:
- hourly: "<project> — <hours> h × <rate>", quantity = hours (2 decimals), unit = rate;
- fixed: "<project> — <note or 'Fixed price'> (share for the period)", quantity 1;
- recurring: "<project> — <note or 'Recurring fee'> (<n> × <interval>)", quantity = n.
Lines are sorted by project name, then kind. An empty period gives an empty draft (allowed).

**Edit (draft only).** Change period (re-prefill on request only: "Refill from period" replaces
the lines after a confirmation), notes, VAT rate, language, due date; add/edit/remove/reorder
lines; every line's project must belong to the statement's client.

**Issue.** Requires at least one line and a non-zero total. In one transaction: `seq` =
max(seq for the year) + 1, `number` = `${prefix}${year}-${seq padded to 3}`, `issue_date` =
today (or given), `due_date` = issue + dueDays unless set, `snapshot` = billing data now.
Issued statements are read-only except status changes.

**Paid / unpaid.** `paid(date)`: for each project, sum the line amounts → one `Payment`
(`statement_id` set, note "Statement <number>"), status `paid`. `unpaid`: deletes the payments
with that `statement_id`, status back to `issued`.

**Void.** Issued (not paid) → `void`; the number stays used. Drafts are deleted instead.

**Totals.** subtotal = Σ amount_cents; vat = round(subtotal × vat_rate / 100); total.

## Interfaces

- **HTTP:** `GET /api/statements?client=&status=`, `POST /api/statements` ({clientId, from, to}),
  `GET/PATCH/DELETE /api/statements/:id`, `PUT /api/statements/:id/lines`,
  `POST /api/statements/:id/refill|issue|paid|unpaid|void`. Settings/clients routes accept the
  new billing fields.
- **CLI:** `mmp statement create <client> --from <date> --to <date>` (or `--period last-month`),
  `list [--client] [--status]`, `show <ref>` (lines and totals in a table + print URL),
  `issue <ref>`, `paid <ref> [--date]`, `unpaid <ref>`, `void <ref>`, `delete <ref>`.
  `<ref>` is the number or the id.
- **MCP tools:** `create_statement` (client, period), `list_statements`, `issue_statement`,
  `mark_statement_paid`. Editing lines stays in the dashboard.
- **Dashboard:**
  - Finance page: a "Statements" tab (list: number or "Draft", client, period, total, status
    badge, due/overdue).
  - Client page: "Statements" section + "New statement" (period picker: last month, this month,
    custom).
  - Statement page `/statements/:id`: header data preview, line editor (draft) or read-only
    view, totals, actions (Issue, Print, Mark paid / unpaid, Void, Delete draft).
  - Print page `/statements/:id/print`: A4, always light, no app chrome, `@page` margins,
    issuer block, client block, number/dates, lines table, totals, IBAN and footer, document
    language = statement's `language`. Opens the print dialog with a button (not automatically).
  - Settings: "Billing details" card. Client page: billing fields.
  - Overview "Needs attention": issued statements past their due date.
- New strings in all six locales. The print page uses the statement's language, not the UI's.

## Testing

- Unit: prefill for hourly/fixed/recurring and multi-project clients; `earnedByAgreement`
  matches the existing finance report totals (regression); totals and VAT rounding.
- Repository: numbering per year without gaps or duplicates (two issues in a row, new year
  resets), issue freezes the snapshot (later settings change does not alter it), paid/unpaid
  create and remove exactly the statement's payments, void keeps the number, drafts deletable,
  issued not editable, lines must belong to the client's projects.
- Routes, CLI and MCP: create → issue → paid round trip.
- Browser: editor, print page in light theme from the dark UI, PDF from the print dialog.
