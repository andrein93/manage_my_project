# mmp Sync — Design Spec (sub-project 6)

Date: 2026-10-08 · Status: decided by Claude (user delegated approval)

## Purpose

Let a small team share projects, clients, categories, tasks and money records, and see who
worked how much on each project, while every member keeps using the local-first mmp. The sync
server is the Laravel part agreed at the start ("a PHP version").

Success criteria: two people run their own mmp against one self-hosted server; a client, a
task or an agreement created by one appears for the other after a sync; the same git repository
cloned on both machines is one shared project; tasks can be assigned to team members; each
project page shows hours per member.

## Decisions

- **One server = one team.** Self-hosted Laravel 12 app in `sync-server/` (SQLite by default,
  any Laravel database works). Members are created by the admin with
  `php artisan mmp:user "Name" email` (prints an API token); `mmp:token email` issues another.
  Authentication: Laravel Sanctum bearer tokens.
- **Relay server.** The server stores opaque records (`table`, `id`, `data`, `updated_at`,
  `deleted_at`, author) and hands out changes by a monotonically increasing `seq`. It validates
  table names and sizes but does not interpret entities, so new mmp features rarely need server
  changes.
- **Last write wins** per record on the client-provided `updated_at` (ISO-8601 UTC). Ties keep
  the stored version. Clock skew between machines is a documented limitation.
- **Deletions** sync as soft deletes (`deleted_at`).
- The token is stored in `<dataDir>/sync.json` (not in the database, not in `.env` of the repo).

## Synced data

| Table | Shared fields |
|---|---|
| `users` | id, name (server members; read-only on clients) |
| `clients`, `categories` | all user fields |
| `projects` | id, name, description, status, client_id, category_id, tags, remote_key, owner_id |
| `tasks` | all fields incl. assignee_id |
| `agreements`, `payments`, `expenses` | all fields |
| `time_entries` | all fields (manual time) |
| `time_daily` | user_id, project_id, date, minutes, cost_usd (each member's automatic time) |

Local-only: paths, workspaces, scan results (stack, git, versions), activity minutes, AI
sessions, AI plans, settings.

## Client model (migration 7)

- Each synced table gains `sync_rev` (the `updated_at` last exchanged with the server). A row is
  *dirty* when `sync_rev IS NULL OR sync_rev <> updated_at`.
- `projects` gains `remote_key` (normalized git remote: lower-case host + path, no scheme, user,
  `.git` suffix) and `local` (1 = has a folder on this machine). Projects pulled without a local
  match are stored with `local = 0`, `path = ''`, `path_key = 'remote:<id>'`; the scanner never
  touches them, and they show "Not on this computer".
- `time_daily(user_id, project_id, date, minutes, cost_usd, updated_at, sync_rev)`: own rows are
  computed from the Time report before each push (last 60 days); other members' rows are pulled.
- `sync_state(key, value)`: cursor and last result.

## Flows

- **Login** (`mmp sync login <url> <token>`): `GET /api/v1/me`; the local user is re-keyed to the
  server user id everywhere (owner/assignee/user columns) in one transaction with deferred
  foreign keys. Members are pulled into `users`.
- **Sync** (`mmp sync`, every 2 minutes while the dashboard runs, and from the dashboard):
  1. refresh own `time_daily`;
  2. push dirty rows (batches of 200); accepted rows get `sync_rev = updated_at`;
  3. pull changes since the cursor (pages of 500) and apply them with plain SQL, never through
     repository methods (so applying a change does not bump `updated_at` and cause ping-pong);
  4. save the cursor.
- **Project identity across machines:**
  - pushing: local projects carry `remote_key`;
  - pulling a project whose id is unknown locally: if a local, never-synced project has the same
    `remote_key`, it is **re-keyed** to the remote id (references updated); otherwise it is stored
    as `local = 0`;
  - scanning: a new folder whose git remote matches a `local = 0` project attaches to it.
- **Applying pulled rows:** last write wins against the local row; a dirty local row newer than
  the incoming one is kept (it will be pushed next).
- **Logout** (`mmp sync logout`): forgets the server and token; data stays.

## Server API (`/api/v1`, bearer token)

- `GET /me` → `{ user: {id, name, email}, server: {name, version} }`
- `GET /members` → `[{id, name}]`
- `POST /sync/push` `{ changes: [{table, id, data, updated_at, deleted_at}] }` (≤ 500 changes,
  each `data` ≤ 64 KB) → `{ accepted: [ids], ignored: [ids] }` (ignored = older than stored)
- `GET /sync/pull?since=<seq>&limit=<n>` → `{ changes: [...same shape + author_id], cursor, more }`

## Interfaces (client)

- CLI: `mmp sync login <url> <token>`, `mmp sync` (push + pull), `mmp sync status`,
  `mmp sync logout`, `mmp members`.
- MCP: `sync_now`, `list_members`; `update_task` accepts `assignee` (member name/id or null).
- HTTP: `GET /api/sync/status`, `POST /api/sync/run`, `POST /api/sync/login`,
  `POST /api/sync/logout`, `GET /api/members`.
- Dashboard: Settings → Team sync (server URL + token, status, sync now, members);
  task assignee select (when members exist); project page "Team time" (hours per member, this
  month); projects not on this computer are labelled and cannot be opened.

## Testing

- Laravel feature tests: auth, push/pull, last-write-wins, validation, members, artisan commands.
- Client tests against an in-process fake server implementing the same protocol: login re-key,
  push/pull round trip between two local apps, deletes, conflicts, project matching by remote
  (re-key and attach on scan), no ping-pong.
- A real end-to-end run: `php artisan serve` + two mmp data dirs.

## Out of scope

Per-record permissions, multiple teams per server, realtime push (websockets), end-to-end
encryption, team-wide Time/Finance reports (reports stay personal; team hours are shown per
project), syncing settings and AI plans.
