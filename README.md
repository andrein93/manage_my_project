# mmp — manage my projects

A local-first project manager for people who build things on their own.

Clone mmp into the folder that holds all your projects. It maps every sibling folder as a
project, detects its stack, git state and last activity, and gives you three ways to work
with them:

- a **web dashboard** to browse, filter, tag and annotate projects, group them by **client**
  and **category**, manage **tasks** as a list or a kanban board, see **where your time and
  AI spend go** (estimated automatically from your Claude Code sessions and git commits), and
  find out **which projects really pay off** and **who still owes you money**;
- a **CLI** (`mmp list`, `mmp show`, …);
- an **MCP server**, so your AI assistant (Claude Code, Cursor, Codex, …) can answer
  "which projects haven't I touched in three months?" or "add D:\clients to my workspaces".

Everything stays on your machine, in a single SQLite file.

> **Status:** v0.4 — project registry, clients, categories, tasks, automatic time tracking and
> profitability. See the [roadmap](#roadmap) for what is next.

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
| `list_projects` | Filter by status, stack, tag, client, category, inactivity, free text |
| `get_project` | Full details of a project (by id, path or name) |
| `get_current_project` | The project that contains a given path, e.g. the AI's working directory |
| `scan_projects` | Rescan all workspaces |
| `add_project` | Register a single folder |
| `add_workspace` | Add a folder of projects and scan it |
| `update_project` | Change name, description, status, client or category |
| `tag_project` | Add/remove tags |
| `list_clients` / `create_client` / `update_client` | Manage clients |
| `list_categories` | Categories defined in Settings |
| `list_tasks` | Open tasks by project, client, category, priority or due date |
| `create_tasks` | Add one or many tasks to a project ("turn the README roadmap into tasks") |
| `update_task` | Edit or complete a task |
| `delete_task` | Delete a task |
| `time_report` | Hours and AI cost by project, client, category or day for any period |
| `log_time` | Log a call or meeting manually |
| `sync_time` | Import new Claude Code and git activity now |
| `finance_report` | Earned, collected, costs, margin and €/hour by project or client |
| `owed_report` | Who still owes you money |
| `list_agreements` / `add_agreement` | Hourly rates, fixed prices, recurring fees |
| `record_payment` | "Acme paid me 1,500 today" |
| `add_expense` | Project costs or shared costs (split by hours) |

The full, always up-to-date list (with every parameter) is in the dashboard under
**Settings → Commands**.

## CLI

```
mmp start [--no-open]               start the dashboard (scans first)
mmp scan [--json]                   rescan workspaces
mmp list [--status s] [--stack s] [--tag t] [--inactive days] [-q text] [--all] [--json]
mmp show <ref> [--json]             ref = id, path or name
mmp add <path>                      register a single folder
mmp workspace list|add|remove       manage scanned folders
mmp set <ref> [--name] [--description] [--status active|paused|archived|ignored]
             [--client <name|none>] [--category <name|none>]
mmp tag <ref> [--add t...] [--remove t...]

mmp client list | add <name> [--email --notes] | show <ref> | edit <ref> | remove <ref>
mmp category list | add <name> [--color #rrggbb] | edit <ref> | remove <ref>

mmp task list [--project] [--client] [--category] [--status s...] [--priority p...]
              [--due overdue|today|week] [--all] [--json]
mmp task add "<title>" --project <ref> [--priority low|normal|high|urgent] [--due YYYY-MM-DD]
mmp task show|done|remove <id>
mmp task edit <id> [--title] [--status todo|in_progress|done] [--priority] [--due <date|none>]

mmp time sync                      import new Claude Code / git activity
mmp time report [--period today|week|last-week|month|last-month] [--from --to]
                [--by project|client|category|day] [--project/--client/--category]
mmp time blocks --project <ref>    work blocks and manual entries
mmp time add <project> <duration> [--date] [--note]   e.g. mmp time add shop 1h30m --note "Call"
mmp time remove <id>

mmp finance report [--period ...|--from --to|--lifetime] [--by project|client]
mmp finance owed
mmp deal add <project> --hourly 50 | --fixed 3000 | --recurring 150 [--every month|year] [--from --to]
mmp deal list | end <id> | remove <id>
mmp payment add <project> <amount> [--date] [--note] [--deal <id>]
mmp payment list | remove <id>
mmp expense add <amount> --note "VPS" [--project <ref>] [--every month|year] [--from --to]
mmp expense list | remove <id>
mmp ai-plan add --subscription 90 | --api [--from --to]
mmp ai-plan list | end <id> | remove <id>
mmp mcp                             MCP server on stdio (started by your AI client)
```

`list` hides archived and ignored projects unless you pass `--all` or `--status`.
`mmp list --client none` shows projects without a client. Task ids can be shortened to their
first 6–8 characters, like git commits.

## Clients, categories and tasks

- A project has at most one **client** and one **category**. Clients have their own page
  (email, notes, projects, open tasks). Categories are yours to rename, recolor and reorder in
  Settings; mmp starts you with *Client work*, *Side project*, *Product / SaaS* and *Internal*.
- **Tasks** belong to a project and have a status (to do, in progress, done), a priority and an
  optional due date. Each project page has a list and a kanban board; the **Tasks** page shows
  every open task grouped by due date (overdue, today, next 7 days, later, no date).
- Removing a client or a category never removes projects; they just lose the label.

## Time tracking

mmp estimates your working time **without timers and without changing your Claude Code setup**:

- It reads the session transcripts Claude Code already keeps in `~/.claude/projects`
  (incrementally, metadata only: timestamps, working folder, session cost — **never the
  conversation text**) and the commits you authored in each registered repository.
- Activity in the same project is merged into **work blocks**; a pause longer than the idle
  threshold (15 minutes by default, see Settings) ends a block.
- Each session's folder decides the project. Sessions in folders that are not projects appear
  under *Activity outside your projects*; register the folder and its whole history moves over.
- **AI cost** is the API-equivalent cost Claude Code records for each session (on a subscription
  plan this is not what you pay).
- Calls and meetings can be logged manually from the Time page, the CLI or your AI.
- The first import of a long history takes a few seconds and runs in the background.

## Money

Record **how each project is paid** and mmp tells you whether it is worth it:

- **Agreements:** hourly rate (earned = hours tracked × rate), fixed price (spread evenly between
  its start and end dates) or recurring fee (every month or year). A project can have several.
- **Payments** you receive, so you see what was earned *and* what was collected; the difference
  is what clients still owe you (or their prepaid credit).
- **Costs:** AI (see below), project expenses (a domain), and shared expenses (a server, a tool)
  split across projects by hours worked each month.
- **AI plan:** pay-as-you-go uses the cost Claude Code reports, converted with your USD rate;
  with a subscription, the monthly fee is split across projects by how much each used.
- **Margin** = earned − costs, and **effective hourly rate** = margin ÷ hours worked, per period
  or since the beginning.

All amounts are in one currency (Settings → Finance) and **net of VAT**. mmp is not an
invoicing tool.

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
2. ~~Clients, categories and tasks, manageable by your AI~~ (v0.2)
3. ~~Automatic time tracking from Claude Code sessions and git~~ (v0.3)
4. ~~Profitability: agreements, payments, costs, AI plans, effective hourly rate~~ (v0.4)
5. Project health, renewals (domains, SSL, hosting), weekly reports
6. Optional sync server to share projects across people and machines

## License

MIT
