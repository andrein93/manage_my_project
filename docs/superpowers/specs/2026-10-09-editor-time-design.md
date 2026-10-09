# mmp Editor Time (VS Code extension) — Design Spec and Plan

Date: 2026-10-09 · Status: approved to build (user asked to complete steps 4–6 without check-ins)

## Purpose

mmp estimates time from Claude Code sessions and git commits. Time spent coding by hand in the
editor, without the AI and before a commit, is missed. A small VS Code extension sends a
heartbeat while the user is actively editing, and mmp counts those minutes like the others.

Success: with the extension installed and `mmp start` running, typing in a project for 20
minutes adds about 20 minutes to that project in the Time page (merged with Claude Code/git
minutes, never double counted); the work block shows the "Editor" source; nothing is sent when
VS Code is not focused or idle; if mmp is not running the extension stays silent and retries.

## Decisions (taken on the user's behalf)

- **Transport:** HTTP to the local mmp server, `POST /api/time/heartbeat { path, at? }` (JSON,
  loopback + Host check already enforced, JSON-only writes already block form CSRF). No token:
  same trust model as the dashboard.
- **Granularity:** at most one heartbeat per minute per workspace folder; a heartbeat marks that
  minute as active (same minute model as Claude Code and git signals: `activity` rows with
  `source = 'editor'`), so overlapping sources never double count.
- **What counts as activity:** text edits, saves, switching editors — only while the VS Code
  window is focused. Opening VS Code and leaving it idle counts nothing.
- **Path sent:** the workspace folder containing the file (or the file's folder if none); mmp
  attributes it to the registered project containing it, otherwise it shows under "Activity
  outside your projects", like Claude Code sessions.
- **Extension stack:** plain JavaScript (CommonJS), no build step and no runtime dependencies;
  Node's global `fetch` (VS Code ≥ 1.80). Packaged with `npx @vscode/vsce package` (documented),
  installed with `code --install-extension`.
- **Other editors:** the endpoint is documented so JetBrains/Neovim users can script it.

## Server

- Migration (appended): rebuild `activity` so `source` accepts `'editor'`
  (`CHECK (source IN ('claude', 'git', 'editor'))`), copying rows and recreating its indexes.
- `TimeService.recordEditor(path: string, at = Date.now())`: path must be absolute, ≤ 1000 chars;
  `at` older than 24 h or more than 5 min in the future is rejected; inserts
  `(pathKey(path), path, minuteKey(at), 'editor', NULL)` with `INSERT OR IGNORE`.
- Types: `'editor'` joins the source unions (`Signal`, `WorkBlock.sources`); locales get
  `time.sources.editor` ("Editor").
- Route `POST /api/time/heartbeat` → 204; validation errors → 400.

## Extension (`vscode-extension/`)

- `package.json`: name `mmp-time`, publisher `mmp`, `engines.vscode ^1.80.0`,
  `activationEvents: ["onStartupFinished"]`, `main: ./extension.js`, settings
  `mmp.serverUrl` (default `http://localhost:4477`) and `mmp.enabled` (default true), command
  `mmp.showStatus`.
- `heartbeat.js` (pure, tested from vitest): `createHeartbeat({ send, now, minIntervalMs = 60_000 })`
  returning `activity(folder)` — sends when the folder changed or a minute passed since the last
  successful send for it; after a failed send, waits 5 minutes before trying again (server not
  running) and reports `status()` = `'ok' | 'offline' | 'idle'`.
- `extension.js`: wires VS Code events (`onDidChangeTextDocument`, `onDidSaveTextDocument`,
  `onDidChangeActiveTextEditor`) when `window.state.focused`, only for `file:` documents; a
  status bar item `$(clock) mmp` with tooltip (sending / mmp not running) and the
  `mmp.showStatus` command.
- `README.md` for the extension: install, settings, privacy (only folder paths and timestamps,
  to localhost).

## Tasks

1. Migration + `recordEditor` + route + types + locales — tests in `tests/editor-time.test.ts`
   (heartbeats count minutes, merge with Claude minutes without double counting, validation,
   block source).
2. Extension with `heartbeat.js` tests in `tests/editor-heartbeat.test.ts`.
3. README (main: "Editor time" section; extension README); full suite; review; merge; push.
