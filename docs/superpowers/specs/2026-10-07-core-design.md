# mmp Core — Design Spec

Date: 2026-10-07 · Status: approved (sub-project 1 of 6)

## Purpose

`mmp` (manage my projects) is an open-source, local-first tool for solo developers/makers.
You clone it into the folder that holds all your projects; it maps every sibling folder as a
project and exposes them through a CLI, a local web dashboard and an MCP server so any AI
assistant (Claude Code, Cursor, Codex…) can query and manage them.

The full product is split into sub-projects, each with its own spec → plan → implementation:

1. **Core** (this spec): scanner, project registry, CLI, dashboard, MCP server
2. Tasks
3. Automatic time tracking (Claude Code hooks, git)
4. Finance / profitability
5. Extras (project health, renewals, reports)
6. Multi-user sync (separate Laravel server)

Success criteria for Core: a user can clone, `npm install`, `npm start`, see all their projects
in the browser with stack/git/activity info, edit/filter/tag them, and ask their AI about them
through MCP.

## Decisions

- Single Node package, shared `core` library. CLI, web server and MCP server all open the same
  SQLite file directly (WAL mode + busy timeout). No daemon is required for MCP or CLI.
- Node ≥ 22.13, built-in `node:sqlite` (no native modules to compile).
- TypeScript compiled with `tsc` to `dist/`; dashboard is Vue 3 + Vite + Tailwind, built to
  `dist/web`. `npm install` triggers the build via `prepare`.
- Fastify for the HTTP API; `@modelcontextprotocol/sdk` (stdio) for MCP; `commander` for CLI.
- English only, but every UI string goes through `vue-i18n` (`en.json`) so translations can be
  added later.
- Multi-user readiness without multi-user features: UUID ids, `created_at`/`updated_at`,
  soft delete (`deleted_at`), `owner_id` pointing to a single local user.

## Configuration

Precedence: process env > `.env` (repo root, loaded with `process.loadEnvFile`) > defaults.
`.env.example` is committed, `.env` is gitignored. Secrets never go in the database.

| Key | Default |
|---|---|
| `MMP_PORT` | `4477` |
| `MMP_HOST` | `127.0.0.1` |
| `MMP_DATA_DIR` | `~/.manage-my-projects` |
| `MMP_OPEN_BROWSER` | `true` |
| `MMP_ALLOWED_HOSTS` | empty (comma list of extra Host headers, e.g. `manage_my_project.test`) |

## Data model

- `users(id, name, created_at, updated_at)` — one local row created on first run.
- `workspaces(id, path, path_key UNIQUE, created_at, updated_at, deleted_at)`
- `projects(id, owner_id, workspace_id NULL, source['scan'|'manual'], name, description,
  status['active'|'paused'|'archived'|'ignored'], path, path_key UNIQUE, stack JSON,
  git JSON NULL, last_activity_at NULL, missing_since NULL, created_at, updated_at, deleted_at)`
- `tags(id, name UNIQUE)`, `project_tags(project_id, tag_id)`
- `settings(key PRIMARY KEY, value JSON)` — e.g. `ignore_names`.
- `schema_migrations(version)`.

`path_key` is the resolved path, lower-cased on Windows/macOS, used for identity.
Timestamps are ISO-8601 UTC strings.

## Scanner

- First run: if there are no workspaces, the parent folder of the mmp install is added.
- Candidates: direct child directories of each workspace. Skipped: files, hidden folders
  (`.` prefix), the mmp install folder itself, names in `ignore_names`
  (default `node_modules`, `vendor`, `$RECYCLE.BIN`).
- Stack detection (top level only):
  `artisan`+`composer.json`→`laravel`; `wp-config.php`/`wp-content`→`wordpress`;
  `composer.json`→`php`; `package.json`→`node` plus `vue`/`react`/`nuxt`/`next`/`svelte`/
  `angular`/`express` from dependencies; `pyproject.toml`/`requirements.txt`→`python`;
  `go.mod`→`go`; `Cargo.toml`→`rust`; `Gemfile`→`ruby`; plain `*.php`/`*.html` fallbacks
  → `php`/`static`.
- Git: only when the folder itself contains `.git`. Uses the `git` CLI with a timeout:
  branch, last commit date, `origin` remote, dirty flag. Any failure → `git: null`.
- Last activity: max(last commit date, newest mtime among top-level entries).
- Reconcile per scan:
  - new folder → insert `status=active`, `source=scan`
  - known project → update only detected fields (`stack`, `git`, `last_activity_at`);
    never `name`, `description`, `status`, tags
  - known `scan` project whose folder is gone → set `missing_since` (never delete)
  - folder back → clear `missing_since`
  - `ignored` projects stay in the DB so rescans do not resurrect them
  - manual projects are refreshed the same way (detection + missing check)
- Runs on `mmp scan`, on dashboard start, from the dashboard "Rescan" button and via MCP.
  No file watcher. Git probes run with bounded concurrency (8).
- Returns a summary `{added, updated, missing, restored, total, durationMs}`.

## Project references

Anywhere a project is referenced (CLI, MCP, API) a `ref` may be an id, an exact path or a name
(case-insensitive). Ambiguous names produce an error listing the candidates.

## Interfaces

### CLI (`mmp`)

`start`, `scan`, `list [--status] [--stack] [--tag] [--inactive <days>] [--query] [--all] [--json]`,
`show <ref> [--json]`, `add <path>`, `workspace add|remove|list [path]`,
`set <ref> [--name] [--description] [--status]`, `tag <ref> [--add <t...>] [--remove <t...>]`,
`mcp`. `list` hides `ignored` and `archived` unless `--all` or `--status` is passed.

### MCP tools

`list_projects`, `get_project`, `get_current_project(path)` (project containing a path),
`scan_projects`, `add_project`, `add_workspace`, `update_project`, `tag_project`.
Results are JSON text content. Errors are returned as `isError` results with a message.

### HTTP API (`/api`)

`GET /projects` (same filters as CLI), `GET /projects/:id`, `PATCH /projects/:id`,
`PUT /projects/:id/tags`, `POST /projects` (manual add), `POST /projects/:id/open`
(`{target: 'folder'|'vscode'}`), `POST /scan`, `GET|POST /workspaces`,
`DELETE /workspaces/:id`, `GET|PUT /settings`, `GET /meta` (version, stacks, tags).

### Dashboard

- **Projects**: search, filters (status, stack, tag, inactive days), sort by last activity /
  name, badges (stack, dirty git, missing).
- **Project detail**: info, git, edit name/description/status/tags, open folder / VS Code.
- **Settings**: workspaces, ignore list, rescan.
- Refreshes on window focus and every 30 s.

## Security

- Server binds to `MMP_HOST` (127.0.0.1).
- `Host` header must be `localhost`, `127.0.0.1` or in `MMP_ALLOWED_HOSTS` (blocks DNS rebinding).
- Mutating requests must be JSON (`content-type: application/json`) — blocks simple-form CSRF.
- "Open" only acts on paths of registered projects; processes are spawned without a shell.

## Error handling

- Scanner never throws for a single project: per-folder errors are collected and returned.
- Validation errors → HTTP 400 / MCP `isError` / CLI exit code 1 with a message.
- Unknown ref → 404 / clear message.

## Testing

Vitest. Unit tests on stack detection, ref resolution, config loading; integration tests on
the scanner (temp dirs, real git repos when `git` is available), the repository layer
(in-memory SQLite) and the HTTP API (Fastify `inject`), plus an MCP smoke test via the SDK
in-memory transport.

## Out of scope (Core)

Tasks, time tracking, finance, multi-user sync, file watchers, translations beyond English,
Laragon reverse proxy (documented in README only).
