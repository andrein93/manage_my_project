# mmp Custom Project Fields — Design Spec and Plan

Date: 2026-10-09 · Status: approved to build (user asked to complete steps 4–6 without check-ins)

## Purpose

Let the user record what mmp cannot detect about a project — production URL, staging URL,
hosting provider, domain expiry, contract end, repository of the mobile app… — as **custom
fields** they define once and fill per project. Date fields can feed reminders (step 6).

Success: in Settings the user defines fields (name + kind); every project page shows them as a
"Fields" card to fill; values are validated by kind (links clickable, dates as dates); the CLI
and the AI can read and set them; project search finds projects by field values.

## Decisions (taken on the user's behalf)

- **Kinds:** `text`, `url`, `date`, `number`. No select/multi-select (YAGNI; text covers it).
- **Definitions are global** (every project gets every field); empty value = not set.
- **Date fields have `remindDays`** (default 30, null = never): step 6 uses it to remind before
  the date (e.g. domain expiry).
- **Local only:** definitions and values are not part of team sync (like statements). Shared
  projects keep their local field values.
- **Search:** the project list's text search also matches field values.
- **Deleting a field** soft-deletes the definition and hard-deletes its values.

## Data model (migration appended to `MIGRATIONS`)

```sql
CREATE TABLE project_fields (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL,
  kind TEXT NOT NULL, position REAL NOT NULL, remind_days INTEGER,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE TABLE project_field_values (
  project_id TEXT NOT NULL, field_id TEXT NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, field_id)
);
```

## Core — `src/core/fields.ts` (`FieldRepository`)

- `list(): ProjectField[]` (by position, then name), `resolve(ref)` (id, id prefix or name),
  `create({ name, kind, remindDays? })`, `update(id, { name?, remindDays? })` (kind is fixed after
  creation), `move(id, 'up'|'down')`, `remove(id)`.
- `values(projectId): FieldValue[]` — every defined field with its value (`''` when unset).
- `setValues(projectId, { [fieldId]: string | null })` — validates per kind, `''`/null clears.
- `allValues(): Map<projectId, string[]>` for search.
- `upcomingDates(today, maxDays)` — for step 6: `{ projectId, projectName, fieldName, date, daysLeft }`
  for date fields with `remindDays` whose date is within `remindDays` (and not past more than 0 days).
- Validation: names 1–60 chars, unique (case-insensitive); `url` must parse as http(s);
  `date` = YYYY-MM-DD real date; `number` finite (stored normalized, `,` accepted as decimal);
  `text` ≤ 2000 chars; `remindDays` integer 0–365 or null, only for date fields.

## Interfaces

- HTTP: `GET/POST /api/fields`, `PATCH/DELETE /api/fields/:id`, `POST /api/fields/:id/move`,
  `GET /api/projects/:id/fields`, `PUT /api/projects/:id/fields` ({ values }).
- CLI: `mmp field list | add <name> --kind <k> [--remind <days>] | remove <field> | set <project> <field> [value]`
  (no value = clear); `mmp show <project>` lists filled fields.
- MCP: `list_fields`, `set_project_field` (project, field, value); `get_project` includes `fields`.
- Dashboard: Settings "Custom fields" card (add, rename, reorder, remind days for dates, delete
  with two-click); project page "Fields" card (inputs by kind, URL opens in new tab, Save);
  strings in the six locales.

## Tasks (TDD, one commit each)

1. Migration + `FieldRepository` with validation, values, search hook, `upcomingDates` — `tests/fields.test.ts`.
2. Project search includes field values (`ProjectRepository.list({ q })`) — test.
3. HTTP routes + CLI + MCP — `tests/fields-interfaces.test.ts`; update MCP tool inventory.
4. Dashboard: api.ts, Settings card, project page card, locales; browser check on a test server.
5. README section; full suite; final review; merge and push.
