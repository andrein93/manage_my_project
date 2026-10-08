# mmp Organize — Design Spec (sub-project 2)

Date: 2026-10-08 · Status: draft for review · Builds on: `2026-10-07-core-design.md`

## Purpose

Let a solo maker classify projects by **client** and **category**, filter by them everywhere,
and manage **tasks** per project — from the dashboard, the CLI and their AI (MCP).

Success criteria: the user can assign a client and a category to each of their 74 projects,
filter the project list by them, keep a to-do list or kanban per project, see every open task
across projects grouped by due date, and ask their AI to create, list and complete tasks.

## Decisions

- Client and category are first-class fields (not tags). Clients are entities because
  sub-project 4 (finance) will attach rates and billing data to them. Tags stay for free labels.
- Custom user-defined fields are out of scope; they can be added later as new tables
  (`custom_fields`, `project_field_values`) without touching clients or categories.
- One client (optional) and one category (optional) per project.
- Tasks live in mmp's SQLite database, not in project repositories.
- Tasks are essential only: fixed statuses, no subtasks, no custom columns, no assignees
  (column reserved).
- AI integration is on request via MCP tools. Claude Code hooks (auto-showing tasks at session
  start) are deferred to sub-project 3.

## Data model (migration 2)

- `clients(id, owner_id, name UNIQUE NOCASE among non-deleted, email, notes, created_at,
  updated_at, deleted_at)`
- `categories(id, owner_id, name UNIQUE NOCASE among non-deleted, color, position, created_at,
  updated_at, deleted_at)` — `color` is a `#rrggbb` string.
- `projects` gains `client_id NULL REFERENCES clients(id)` and `category_id NULL REFERENCES
  categories(id)`.
- `tasks(id, owner_id, project_id REFERENCES projects(id), title, description, status
  ['todo'|'in_progress'|'done'], priority ['low'|'normal'|'high'|'urgent'], due_date NULL
  ('YYYY-MM-DD'), position REAL, completed_at NULL, assignee_id NULL, created_at, updated_at,
  deleted_at)`.
- Uniqueness among non-deleted rows uses partial unique indexes
  (`... WHERE deleted_at IS NULL`).
- Seed categories, only when the table is empty: Client work, Side project, Product / SaaS,
  Internal (each with a distinct color).

## Rules

- Moving a task to `done` sets `completed_at`; leaving `done` clears it.
- New tasks get `position = max(position in that project+status) + 1`. Moving a task between
  or within columns takes an explicit `position` (fractional values allowed for inserts
  between neighbours).
- Deleting a client or category soft-deletes it and clears the reference on its projects.
- Deleting a task is a soft delete.
- Tasks of soft-deleted projects are never listed. Tasks of `archived`/`ignored` projects are
  hidden from cross-project listings unless `all` is set; they always show on the project page.
- Due groups use the machine's local date: `overdue` (< today), `today`, `week`
  (today+1 … today+7), `later` (> today+7), `none` (no due date). Done tasks are not grouped
  as overdue.
- Client/category refs: id, id prefix (≥ 6 chars) or name (case-insensitive). Task refs: id or
  id prefix (≥ 6 chars). Ambiguous refs are errors listing candidates.
- Client and category names are trimmed and non-empty; duplicates → conflict error.

## Interfaces

### HTTP API (`/api`)

- `GET|POST /clients`, `GET|PATCH|DELETE /clients/:id` (GET includes projects and counts).
- `GET|POST /categories`, `PATCH|DELETE /categories/:id`.
- `GET /projects` gains `client` (id or `none`) and `category` (id or `none`) filters; `PATCH
  /projects/:id` accepts `clientId` / `categoryId` (null clears).
- `GET /tasks` with `project`, `client`, `category`, `status` (comma list), `priority`,
  `due` (`overdue|today|week`), `all`; `POST /tasks` (`projectId`, `title`, …);
  `PATCH|DELETE /tasks/:id`.
- `GET /meta` gains `clients` and `categories` (for filters).

### Dashboard

- Navigation: Projects, Tasks, Clients, Settings.
- Projects: client and category filters (including "No client"/"No category"); rows show the
  client name and a category color dot.
- Project detail: client select with inline "New client…", category select; a Tasks section
  with list/kanban toggle, quick add, drag-and-drop between kanban columns and a keyboard
  alternative (status menu on each card), inline edit of title, priority and due date.
- Tasks: open tasks across projects grouped by due group; filters for project, client,
  category, priority, status; quick add with a project picker.
- Clients: list with project and open-task counts; client page to edit name, email, notes and
  see its projects.
- Settings: Categories section (add, rename, recolor, reorder, delete).

### CLI

```
mmp client list | add <name> [--email --notes] | show <ref> | edit <ref> [--name --email --notes] | remove <ref>
mmp category list | add <name> [--color] | edit <ref> [--name --color] | remove <ref>
mmp set <project> [--client <ref|none>] [--category <ref|none>]
mmp list [--client <ref|none>] [--category <ref|none>]
mmp task list [--project] [--client] [--category] [--status] [--priority] [--due overdue|today|week] [--all]
mmp task add "<title>" --project <ref> [--priority] [--due YYYY-MM-DD] [--description]
mmp task edit <ref> [--title --status --priority --due <date|none> --description]
mmp task done <ref>
mmp task remove <ref>
```

Unknown client names are errors with a hint to run `mmp client add` (no implicit creation).
Task ids are printed as 8-character prefixes.

### MCP tools

New: `list_clients`, `create_client`, `update_client`, `list_categories`, `list_tasks`,
`create_tasks` (`project` ref + array of `{title, description?, priority?, due_date?}`),
`update_task` (also used to complete), `delete_task`.
Extended: `list_projects` (`client`, `category` filters), `update_project` (`client`,
`category`; null clears). Server instructions mention: use `get_current_project` before
creating tasks for "this project".

## Error handling

Same conventions as Core: `UserError('invalid' | 'not_found' | 'conflict')` → HTTP
400/404/409, MCP `isError`, CLI exit code 1.

## Testing

- Migration 2 applied to a database populated by migration 1: projects and edits preserved,
  categories seeded once.
- Repositories: clients, categories (uniqueness, soft delete clears references), tasks
  (status/completed_at, positions, filters, due groups with a fixed "today").
- HTTP API, MCP tools and CLI commands for the new features.

## Out of scope

Custom fields, subtasks, custom statuses, assignees, recurring tasks, TODO-comment import,
Claude Code hooks, time tracking, finance fields on clients.
