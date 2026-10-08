# mmp Extras + Translations — Design Spec (sub-project 5 and i18n)

Date: 2026-10-08 · Status: decided by Claude (user delegated approval) · Builds on all previous specs

## Purpose

1. Surface what needs attention across all projects without the user going looking: risky repos,
   stale work, overdue tasks, money owed, upcoming charges.
2. A weekly digest of time, AI spend, work done and money.
3. Translate the dashboard into Italian with a structure where adding a language is one file.

## Project health (local only, no network)

Computed during scans and stored with the other detected fields:

- Git gains `unpushed`: commits on HEAD not on any remote ref
  (`git rev-list --count HEAD --not --remotes`), null when unknown.
- `versions` (migration 6, `projects.versions` JSON): key framework/runtime versions read from
  lockfiles (falling back to the declared range): `laravel` (laravel/framework in composer.lock),
  `php` (composer.json `require.php`), `wordpress` (wp-includes/version.php `$wp_version`),
  `node` engines, `vue`, `react`, `nuxt`, `next`, `svelte`, `angular`, `vite`, `tailwindcss`
  (package-lock.json / package.json). Only what is present.
- Health flags, derived at read time for `active`/`paused` projects:
  `missing` (folder gone), `no_git` (not versioned), `no_remote` (git without a remote — no
  backup), `unpushed` (n commits not pushed), `uncommitted`, `dormant` (status active but no
  activity for 90+ days).
- Projects list: filter "Needs attention" and a filter by framework version (e.g. Laravel 9).
  Project page: a health line and detected versions.

## Upcoming charges

Derived, no new entity: the next occurrences (default 30 days) of recurring **expenses**
(to pay: domains, hosting) and recurring **agreements** (to invoice: maintenance fees), plus
one-off expenses dated in the window. Sorted by date.

## Overview (new home page at `/`; projects list moves to `/projects`)

- This week: wall-clock hours, AI cost, tasks completed, top projects by time.
- This month: earned, collected, margin.
- Needs attention: overdue tasks, projects with health flags (grouped by flag), clients owing
  money, upcoming charges (30 days).
- Weekly digest: a "Copy as text" button producing a Markdown summary of last/this week
  (localized in the UI).

## Digest in CLI/MCP (English)

`mmp digest [--week this|last]` and MCP `weekly_digest` return the same structure
(`hours`, `aiCost`, `topProjects`, `tasksCompleted`, `overdueTasks`, `health`, `owed`,
`upcoming`, `money`) and, for the CLI, a Markdown rendering. MCP `project_health`
lists projects with flags. API: `GET /overview`, `GET /health`, `GET /upcoming?days=`.

## Translations

- `web/src/locales/<code>.json`, each with `"_meta": { "name": "<native name>" }`.
  Locales are discovered with `import.meta.glob` — adding a language is adding one file.
- Ship `en` and `it` (complete).
- Language choice: `auto` (browser language, falling back to English) or an explicit locale,
  in Settings; stored per browser (localStorage) since it is a per-viewer preference.
- Dates and numbers already use the browser locale; with an explicit language they use it too.
- Server-produced labels shown in the UI (e.g. "No client" rows) are mapped to i18n keys in the
  UI. Error messages from the server stay in English (documented).
- A test fails if any locale misses keys present in `en.json` or has keys `en.json` lacks,
  or if placeholders (`{name}`) differ.
- CONTRIBUTING documents how to add a language.

## Out of scope

Dependency vulnerability checks or "latest version" lookups (need network), branch-behind
detection (needs fetch), email/Slack delivery of the digest, server-side translation of CLI/MCP
output, multi-user sync (sub-project 6).
