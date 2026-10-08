# mmp Finance — Design Spec (sub-project 4)

Date: 2026-10-08 · Status: draft for review · Builds on: Core, Organize, Time

## Purpose

Answer "is this project / client worth it?" for a solo maker: compare what a project earns
with what it costs (AI, direct expenses, a share of shared costs) and the time it takes,
giving margin and **effective hourly rate**, per period and over the project's lifetime.
Also answer "who still owes me money?".

Success criteria: the user records agreements (hourly, fixed, recurring), payments and
expenses for their projects, sets their AI plan, and sees per project/client: earned,
collected, owed, costs, margin and €/hour, in the dashboard, CLI and through their AI.

## Decisions

- Revenue models: **hourly**, **fixed price**, **recurring** (monthly/yearly). Own-product
  revenue (SaaS) is a later extension (it fits as payments without a client).
- Track **agreements** (expected revenue) **and payments** (cash received). No invoicing,
  VAT handling or invoice numbering: amounts are **net of VAT**.
- **One base currency** (setting, default `EUR`). AI costs arrive in USD and are converted with a
  **user-set USD→base rate** (no network calls). Changing the rate re-computes history.
- **AI plans** with validity periods: `api` (pay-as-you-go: Claude Code's reported cost) or
  `subscription` (fixed monthly fee in base currency, allocated by usage). No plan → `api`.
- **Shared expenses** are allocated to projects by hours worked in the same month.
- Money is stored as **integer cents** in the base currency.

## Data model (migration 5)

- `agreements(id, owner_id, project_id, kind ['hourly'|'fixed'|'recurring'], amount_cents,
  interval NULL ['month'|'year'] (recurring only), start_date, end_date NULL, note,
  created_at, updated_at, deleted_at)` — for `hourly`, `amount_cents` is the hourly rate.
- `payments(id, owner_id, project_id, agreement_id NULL, date, amount_cents, note, timestamps,
  deleted_at)`.
- `expenses(id, owner_id, project_id NULL (NULL = shared), amount_cents, interval NULL
  ['month'|'year'], start_date, end_date NULL, note, timestamps, deleted_at)` — one-off when
  `interval` is NULL (`start_date` is its date).
- `ai_plans(id, owner_id, kind ['api'|'subscription'], monthly_cents NULL, start_date,
  end_date NULL, note, timestamps, deleted_at)`.
- Settings: `currency` (3-letter code, default `EUR`), `usdRate` (base units per USD,
  default `1`).

## Accrual rules (period view)

All rules produce **amounts per local day**; a period sums its days.

- **Hourly:** each day's project minutes (automatic per-project blocks + manual entries,
  as in the Time report rows) × rate / 60, on days the agreement is active
  (`start_date ≤ day ≤ end_date`; open end = forever). Overlapping hourly agreements on the
  same project are rejected.
- **Fixed:** amount spread evenly over the days `start..end` inclusive (remainder cents on the
  last day). No end date → the full amount on `start_date`.
- **Recurring:** the full amount on each occurrence: the start date's day-of-month every month
  (`month`; clamped to the month's last day, e.g. the 31st → Feb 28) or its anniversary every
  year (`year`), while `≤ end_date`.
- **Expenses:** one-off on `start_date`; recurring like recurring agreements. Project expenses go
  to their project. Shared expenses on a day are split across projects in proportion to each
  project's minutes in that calendar month; with no minutes that month they stay
  **unallocated overhead** (in totals, not in project rows).
- **AI:** for each day, the plan covering it decides:
  - `api`: each project's API-equivalent cost that day (from Time) × `usdRate`;
  - `subscription`: the monthly fee accrues on the 1st of each covered month (or the plan's
    start date in its first month) and is split by each project's share of API-equivalent usage
    in that calendar month; with no usage it stays unallocated.
  AI plan periods must not overlap.
- Unassigned activity (folders that are not projects) does not belong to any project; its AI
  cost counts as unallocated overhead.

## Derived numbers

- `earned` = accrued revenue; `collected` = payments in the period; `costs` = AI + direct +
  allocated shared (+ unallocated overhead in totals only); `margin = earned − costs`;
  `hours` = project minutes / 60; `effectiveRate = margin / hours` (null when hours = 0).
- **Lifetime** view: from the earliest agreement/payment/expense/activity date to today.
- **Owed** (per project and client): lifetime earned up to today − lifetime collected. Positive =
  owed to the user; negative = client credit (prepaid).

## Interfaces

- **HTTP:** `GET /finance/report?period|from&to|lifetime&by=project|client&project&client`,
  `GET /finance/owed`, CRUD `/agreements`, `/payments`, `/expenses`, `/ai-plans`;
  settings accept `currency`, `usdRate`.
- **CLI:** `mmp finance report [--period|--from --to|--lifetime] [--by project|client]`,
  `mmp finance owed`, `mmp deal add|list|remove`, `mmp payment add|list|remove`,
  `mmp expense add|list|remove`, `mmp ai-plan add|list|remove` (flags as in the design chat:
  `--hourly 50 | --fixed 3000 | --recurring 150 --every month|year`, `--from`, `--to`, `--note`,
  `--project`, `--deal`, `--subscription 90 | --api`). Amounts accept `1500`, `1500.50`,
  `1.500,50`, `1,500.50`.
- **MCP:** `finance_report`, `owed_report`, `add_agreement`, `record_payment`, `add_expense`,
  `list_agreements`.
- **Dashboard:** Finance page (period incl. lifetime, KPIs, per project/client table sortable by
  margin and €/h, "Owed to you"); Money panel on the project page (lifetime summary,
  agreements, payments, direct expenses with add/remove); lifetime summary on the client page;
  Settings: currency, USD rate, AI plans, shared expenses.

## Command reference in Settings (requested 2026-10-08)

A **Commands** section in Settings documents everything the user can do outside the UI:

- **CLI:** every `mmp` command and subcommand with its usage line, description and options
  (flag + description, choices, defaults), **generated at runtime from the commander program**
  (`buildCli`), so it can never drift from the real CLI.
- **AI (MCP):** every MCP tool with its description and parameters, **generated from the
  running MCP server definition** (listed through an in-memory MCP client), plus a short list of
  example requests to ask an AI assistant (static, translatable strings).
- The MCP setup command already shown in Settings moves into this section.
- UI: tabs *CLI* / *AI*, a search box filtering by name or description, a copy button per usage
  line. Served by `GET /api/help` → `{ cli: CommandDoc[], mcp: ToolDoc[] }`.

## Validation and errors

Amounts > 0 (max 10 000 000.00), valid dates, `end_date ≥ start_date`, `interval` only for
recurring agreements/expenses, overlap checks (hourly agreements per project, AI plans).
Errors follow existing conventions (`UserError` → 400/404/409, MCP `isError`, CLI exit 1).

## Testing

Each accrual rule incl. month-end clamping and year boundaries; fixed-price remainder cents;
shared-expense and subscription allocation incl. months without hours/usage; USD conversion;
owed and credit; effective rate; overlap rejection; amount parsing; HTTP/MCP/CLI; a real-data
check with a sample subscription plan.

## Out of scope

Invoices, VAT, multiple currencies per record, exchange-rate history, taxes, budgets/forecasts,
own-product (SaaS) revenue integrations, billable flags.
