# mmp — manage my projects

A local-first project manager for people who build things on their own.

Clone mmp into the folder that holds all your projects. It maps every sibling folder as a
project, detects its stack, git state and last activity, and gives you three ways to work
with them:

- a **web dashboard** to browse, filter, tag and annotate projects;
- a **CLI** (`mmp list`, `mmp show`, …);
- an **MCP server**, so your AI assistant (Claude Code, Cursor, Codex, …) can answer
  "which projects haven't I touched in three months?" or "add D:\clients to my workspaces".

Everything stays on your machine, in a single SQLite file.

> **Status:** v0.1 — the core registry. Tasks, automatic time tracking and profitability
> tracking are on the [roadmap](#roadmap).

## Requirements

- Node.js **22.13 or newer** (uses the built-in `node:sqlite`, nothing to compile)
- git (optional, for branch/commit/dirty info)

## Install

```bash
cd ~/projects            # the folder that contains all your projects
git clone https://github.com/andrein93/manage_my_project.git mmp
cd mmp
npm install              # also builds the app
npm start                # scans ../ and opens the dashboard on http://localhost:4477
```

On first run the parent folder (`~/projects` above) becomes your first **workspace**: every
folder directly inside it is a project. Add more workspaces or single folders from the
dashboard (Settings), the CLI or your AI.

To use `mmp` as a global command, run `npm link` inside the repo.

## Connect your AI (MCP)

Register mmp once, for every project, with Claude Code:

```bash
claude mcp add --scope user mmp -- node "/absolute/path/to/mmp/bin/mmp.js" mcp
```

The exact command for your install is shown in the dashboard under **Settings → Connect your AI**.
Any other MCP client works the same way: run `node bin/mmp.js mcp` over stdio.

| Tool | What it does |
|---|---|
| `list_projects` | Filter by status, stack, tag, inactivity, free text |
| `get_project` | Full details of a project (by id, path or name) |
| `get_current_project` | The project that contains a given path, e.g. the AI's working directory |
| `scan_projects` | Rescan all workspaces |
| `add_project` | Register a single folder |
| `add_workspace` | Add a folder of projects and scan it |
| `update_project` | Change name, description or status |
| `tag_project` | Add/remove tags |

## CLI

```
mmp start [--no-open]               start the dashboard (scans first)
mmp scan [--json]                   rescan workspaces
mmp list [--status s] [--stack s] [--tag t] [--inactive days] [-q text] [--all] [--json]
mmp show <ref> [--json]             ref = id, path or name
mmp add <path>                      register a single folder
mmp workspace list|add|remove       manage scanned folders
mmp set <ref> [--name] [--description] [--status active|paused|archived|ignored]
mmp tag <ref> [--add t...] [--remove t...]
mmp mcp                             MCP server on stdio (started by your AI client)
```

`list` hides archived and ignored projects unless you pass `--all` or `--status`.

## How scanning works

- Every direct subfolder of a workspace is a project. Files, hidden folders, mmp itself and
  names in the ignore list (`node_modules`, `vendor`, …) are skipped.
- **Stack** is detected from top-level files: Laravel, PHP, WordPress, Node (+ Vue, React,
  Nuxt, Next, Svelte, Angular, Express), Python, Go, Rust, Ruby, static HTML.
- **Git** info is read only when the folder itself is a repository.
- **Last activity** is the latest of the last commit and the newest top-level file change.
- Rescans never overwrite what you edited (name, description, status, tags).
- A folder that disappears is flagged as *missing*, never deleted. It comes back by itself
  if the folder reappears. Set a project to *ignored* to hide it for good.

## Configuration

Copy `.env.example` to `.env` (it is gitignored). Environment variables win over `.env`.

| Variable | Default | |
|---|---|---|
| `MMP_PORT` | `4477` | Dashboard port |
| `MMP_HOST` | `127.0.0.1` | Interface to bind; keep it local |
| `MMP_DATA_DIR` | `~/.manage-my-projects` | Where `mmp.db` lives (survives re-cloning mmp) |
| `MMP_OPEN_BROWSER` | `true` | Open the browser on `mmp start` |
| `MMP_ALLOWED_HOSTS` | | Extra `Host` names accepted, e.g. a local virtual host |

### Using a local domain (Laragon, XAMPP, MAMP…)

If mmp lives inside your web root you can reach it at e.g. `http://mmp.test` by
reverse-proxying to the Node server:

1. Enable Apache's `mod_proxy` and `mod_proxy_http` (Laragon: *Menu → Apache → Modules*).
2. Add a `.htaccess` in the mmp folder (it is gitignored, so it stays local):

   ```apache
   RewriteEngine On
   RewriteRule ^(.*)$ http://127.0.0.1:4477/$1 [P,L]
   ```

3. Keep `mmp start` running.

Apache usually listens on every network interface: add `Require local` to that virtual
host if you do not want other devices on your network to reach the dashboard.

## Security

The dashboard can open folders on your machine, so the server:

- listens on `127.0.0.1` only;
- rejects requests whose `Host` header is not local (blocks DNS rebinding);
- accepts writes only as JSON (blocks cross-site form posts);
- opens only folders of registered projects, without a shell.

## Development

```bash
npm run dev:server   # tsc --watch for the backend
npm start            # run the server (restart after backend changes)
npm run dev:web      # Vite dev server on :5177, proxies /api to :4477
npm test             # Vitest
npm run typecheck
```

Layout: `src/core` (database, scanner, repositories), `src/cli`, `src/server` (Fastify API),
`src/mcp`, `web/` (Vue 3 + Tailwind dashboard), `tests/`. Design notes live in
`docs/superpowers/specs`.

UI strings live in `web/src/locales/en.json`. To add a language, add a file with the same
keys and register it in `web/src/i18n.ts`.

## Roadmap

1. ~~Core: scanner, registry, CLI, dashboard, MCP~~ (v0.1)
2. Tasks per project, manageable by your AI
3. Automatic time tracking (Claude Code hooks, git activity)
4. Profitability: income, costs (time, AI tokens, hosting), effective hourly rate
5. Project health, renewals (domains, SSL, hosting), weekly reports
6. Optional sync server to share projects across people and machines

## License

MIT
