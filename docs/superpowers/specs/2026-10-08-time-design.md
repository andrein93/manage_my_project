# mmp Time — Design Spec (sub-project 3)

Date: 2026-10-08 · Status: draft for review · Builds on: Core and Organize specs

## Purpose

Show a solo maker where their time and AI spend go, per project, client and category, with
no manual tracking. This feeds sub-project 4 (profitability). Billing-grade timesheets
(rounding, billable flags, client reports) are out of scope.

Success criteria: after `npm start`, the Time page shows hours and AI cost for this week and
any past period (history imported from existing Claude Code transcripts), broken down by
project, client, category and day; manual entries cover calls/meetings; the AI can answer
"how many hours did I spend on client X this month?" through MCP.

## Decisions

- **Passive import, no hooks.** mmp reads Claude Code transcripts from `~/.claude/projects`
  (configurable). No change to the user's Claude Code configuration; full history available.
- **Sources:** Claude Code transcript messages (main sessions and subagents), git commits by
  the local user, manual entries. Editor heartbeats (VS Code extension) are a later sub-project.
- **Metadata only:** timestamps, cwd, session id, token/cost data. Message text is never stored.
- **Cost:** imported from Claude Code's own `cost-state` records (`totalCostUSD`,
  per-model `modelUsage`), i.e. API-equivalent cost. Subscription vs API pricing is handled in
  sub-project 4.

## Time model

- Signals are stored at **minute resolution**: one row per (cwd, minute, source).
- Signals of the same project are merged into **blocks**: a gap longer than the idle threshold
  (`idleMinutes`, default 15) closes a block. Block duration = last signal − first signal +
  2 minutes (padding so an isolated signal counts).
- Blocks are computed at read time, so changing the threshold re-computes history consistently.
- **Attribution at read time:** a signal's cwd maps to the deepest registered project that
  contains it (same rule as `get_current_project`). Unmatched cwds are "unassigned", grouped by
  cwd. Registering such a folder later re-attributes its whole history.
- Projects that are soft-deleted are treated as unmatched; archived/ignored projects still count.
- Concurrent work on two projects counts for both (no arbitrary splitting).
- Blocks crossing local midnight are split per day. Days use the machine's local timezone;
  weeks start on Monday (`weekStart` setting: `monday` | `sunday`).
- A session's cost is spread over days in proportion to that session's active minutes per day,
  and attributed to the session's project.
- Manual entries: project, date, minutes (1–1440), note. They add to automatic blocks.

## Data model (migration 3)

- `activity(cwd_key, cwd, minute TEXT 'YYYY-MM-DDTHH:MM' UTC, source ['claude'|'git'],
  session_id NULL, PRIMARY KEY (cwd_key, minute, source))` + index on `minute`.
- `ai_sessions(session_id PK, cwd_key, cwd, cost_usd REAL, model_usage JSON, first_at, last_at,
  updated_at)` — cost is the latest (highest) cumulative `totalCostUSD` seen.
- `time_entries(id, owner_id, project_id, date 'YYYY-MM-DD', minutes INTEGER, note, created_at,
  updated_at, deleted_at)`.
- `import_state(source_key PK, offset INTEGER, size INTEGER, updated_at)` — per transcript file
  (`claude:<path>`) and per repository (`git:<project_id>` storing the last imported commit date).
- Settings: `idleMinutes` (5–120), `claudeProjectsDir` (default `~/.claude/projects`),
  `weekStart`.

## Import rules

- Transcripts: every `*.jsonl` under the projects dir, recursively (includes
  `<session>/subagents/*.jsonl`). Read as a stream from the stored offset; only complete lines
  (ending in `\n`) are consumed and the offset advances to the last complete line.
- If the file size is smaller than the stored offset, re-read from 0 (dedup makes this safe).
- Lines of type `user`/`assistant` with `timestamp` and `cwd` produce a signal; `cost-state`
  lines update the session cost (keep the maximum `totalCostUSD`). Lines are pre-filtered by
  substring before `JSON.parse` for speed. Malformed lines are counted and skipped.
- Git: per registered project with a `.git` folder, `git log --all --author=<user.email>
  --format=%cI` since the last imported commit date (full history the first time). `user.email`
  comes from the repository's effective git config; no email → no git signals for that repo.
- Sync runs on dashboard start (in the background, not blocking the server), every 5 minutes
  while the server runs, on `mmp time sync`, and before MCP time tools answer. One sync at a
  time per process (shared promise), idempotent writes (`INSERT OR IGNORE`, upserts).
- Sync result: `{files, linesRead, signals, sessions, commits, skippedLines, errors[],
  durationMs}`. A missing transcripts dir is not an error (`claudeDirFound: false`).

## Reports

`report({ from, to, by: 'project'|'client'|'category'|'day', projectId?, clientId?,
categoryId? })` returns totals (`minutes`, `costUsd`, split into `autoMinutes` and
`manualMinutes`), rows for the requested grouping (each with minutes, cost and share of total),
a per-day series for the chart, and `unassigned` (cwd, minutes, cost) when no project/client/
category filter is set. Grouping by client/category puts projects without one under "none".

`blocks({ projectId, from, to })` lists blocks (start, end, minutes, sources, session ids) plus
manual entries, newest first.

Periods resolve on the server: `week`, `last-week`, `month`, `last-month`, `today`, or
explicit `from`/`to` dates (inclusive, local).

## Interfaces

- **HTTP:** `GET /time/report`, `GET /time/blocks`, `GET /time/status` (last sync, running,
  claudeDirFound), `POST /time/sync`, `POST /time/entries`, `PATCH|DELETE /time/entries/:id`;
  settings endpoint accepts `idleMinutes`, `claudeProjectsDir`, `weekStart`.
- **CLI:** `mmp time sync`, `mmp time report [--period|--from --to] [--by]
  [--project|--client|--category] [--json]`, `mmp time blocks --project <ref> [--from --to]`,
  `mmp time add <project> <duration> [--date] [--note]`, `mmp time remove <id>`.
  Durations: `90`, `90m`, `1h30m`, `1.5h`, `2h`.
- **MCP:** `time_report` (period/from/to, by, project/client/category refs), `log_time`
  (project, duration or minutes, date?, note?), `sync_time`.
- **Dashboard:** Time page (period picker, totals, daily bar chart, breakdown table by
  project/client/category, unassigned folders with "Add as project", manual entry form, manual
  entries list with delete, sync status); Time panel on the project page (this month, last 30
  days, AI cost, recent blocks); time and AI cost this month on the client page; Settings
  fields for idle threshold, transcripts folder and week start.

## Error handling

Same conventions as before (`UserError` → 400/404/409, MCP `isError`, CLI exit 1). Import
problems never abort a sync: they are collected in `errors[]`.

## Testing

Block computation (threshold, padding, midnight split, overlap), importer on fixture JSONL
(partial line, incremental offset, truncation, latest cost, subagents, malformed lines),
git import with a temp repo and author filter, reports by project/client/category/day,
unassigned, re-attribution after registering a folder, manual entries and duration parsing,
HTTP/MCP/CLI, and a timing check of the first import on the real transcripts.

## Out of scope

Billable flags, rounding, invoices/timesheet exports, live hooks, editor extensions, idle
detection beyond the gap threshold, per-person time (multi-user).
