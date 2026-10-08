# mmp Finance — Implementation Plan

Spec: `docs/superpowers/specs/2026-10-08-finance-design.md`. Inline execution, TDD for core logic.

1. **Pure helpers** (`src/core/finance/`): `money.ts` (parse amounts in both decimal styles,
   format cents), `accrual.ts` (occurrence dates with month-end clamping, fixed-price daily
   split with remainder, per-day maps). Unit tests.
2. **Migration 5 + settings** (`currency`, `usdRate`) and **repository** (`repository.ts`):
   agreements, payments, expenses, AI plans with validation and overlap checks.
3. **Time data per project and day**: refactor `TimeRepository` to expose daily minutes and
   API-equivalent cost per project (shared with `report`).
4. **Finance engine** (`report.ts`): period and lifetime reports by project/client, shared
   expense and subscription allocation, overhead, owed. Tests.
5. **Interfaces**: HTTP routes, MCP tools, CLI (`finance`, `deal`, `payment`, `expense`,
   `ai-plan`). Tests.
6. **Command reference**: `GET /api/help` generated from commander + MCP tool list. Tests.
7. **Dashboard**: Finance page, Money panel on project page, client lifetime summary, Settings
   (currency/rate, AI plans, shared expenses, Commands section).
8. README, real-data check, review, fixes, push.
