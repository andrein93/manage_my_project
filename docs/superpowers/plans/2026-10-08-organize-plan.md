# mmp Organize — Implementation Plan

Spec: `docs/superpowers/specs/2026-10-08-organize-design.md`. Execution: inline, TDD for core
logic, commit per milestone.

1. **Migration 2** (`src/core/db.ts`): clients, categories (+ seed), project columns, tasks,
   partial unique indexes. Test: migrating a v1 database keeps data.
2. **Refs helper** (`src/core/refs.ts`): resolve by id / id prefix (≥ 6) / name, ambiguity errors.
3. **Clients & categories** (`src/core/clients.ts`, `src/core/categories.ts`): CRUD, soft
   delete clearing project references, counts.
4. **Projects**: `client`/`category` summaries on `Project`, filters (`id` | `none`),
   `clientId`/`categoryId` in patches.
5. **Tasks** (`src/core/tasks.ts`): create (bulk), update (completed_at, position), delete,
   list with filters and due groups (injectable today), resolve.
6. **App facade** wiring; **HTTP routes** (`src/server/routes/*.ts` split by resource).
7. **MCP tools** (split `src/mcp/` by resource) and **CLI** commands (`client`, `category`,
   `task`, extended `set`/`list`).
8. **Dashboard**: nav, Projects filters + row badges, Project detail (client/category selects,
   tasks list/kanban with DnD + keyboard), Tasks view (due groups), Clients list/detail,
   Settings categories.
9. README, full verification on the real database, independent review, fixes, push.
