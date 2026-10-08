import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { newId, now } from './ids.js'

export type DB = DatabaseSync

export const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE workspaces (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    path_key TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );

  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id),
    workspace_id TEXT REFERENCES workspaces(id),
    source TEXT NOT NULL CHECK (source IN ('scan', 'manual')),
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived', 'ignored')),
    path TEXT NOT NULL,
    path_key TEXT NOT NULL UNIQUE,
    stack TEXT NOT NULL DEFAULT '[]',
    git TEXT,
    last_activity_at TEXT,
    missing_since TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );

  CREATE TABLE tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE
  );

  CREATE TABLE project_tags (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (project_id, tag_id)
  );

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  `
  CREATE TABLE clients (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE UNIQUE INDEX clients_name_unique ON clients(name COLLATE NOCASE) WHERE deleted_at IS NULL;

  CREATE TABLE categories (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    position REAL NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE UNIQUE INDEX categories_name_unique ON categories(name COLLATE NOCASE) WHERE deleted_at IS NULL;

  ALTER TABLE projects ADD COLUMN client_id TEXT REFERENCES clients(id);
  ALTER TABLE projects ADD COLUMN category_id TEXT REFERENCES categories(id);

  CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id),
    project_id TEXT NOT NULL REFERENCES projects(id),
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done')),
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    due_date TEXT,
    position REAL NOT NULL,
    completed_at TEXT,
    assignee_id TEXT REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE INDEX tasks_project ON tasks(project_id) WHERE deleted_at IS NULL;
  `,
]

/** Starter categories, created once when the categories table has never been used. */
const SEED_CATEGORIES: [string, string][] = [
  ['Client work', '#4f56d6'],
  ['Side project', '#1f9d6b'],
  ['Product / SaaS', '#d97706'],
  ['Internal', '#64748b'],
]

/** Opens (or creates) the database, applies pending migrations and ensures the local user. */
export function openDatabase(file: string): DB {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  // busy_timeout first: switching to WAL needs a lock another process may hold.
  db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  migrate(db)
  ensureLocalUser(db)
  seedCategories(db)
  return db
}

function migrate(db: DB): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)')
  for (let i = 0; i < MIGRATIONS.length; i++) {
    // Re-read the version under the write lock: another process may have migrated meanwhile.
    transaction(db, () => {
      const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null }
      if ((row.v ?? 0) > i) return
      db.exec(MIGRATIONS[i])
      db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(i + 1)
    })
  }
}

function ensureLocalUser(db: DB): void {
  if (db.prepare('SELECT id FROM users LIMIT 1').get()) return
  transaction(db, () => {
    if (db.prepare('SELECT id FROM users LIMIT 1').get()) return
    const ts = now()
    db.prepare('INSERT INTO users (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(newId(), 'Local user', ts, ts)
  })
}

function seedCategories(db: DB): void {
  const empty = () => (db.prepare('SELECT COUNT(*) AS n FROM categories').get() as { n: number }).n === 0
  if (!empty()) return
  transaction(db, () => {
    if (!empty()) return
    const ts = now()
    const owner = localUserId(db)
    SEED_CATEGORIES.forEach(([name, color], i) => {
      db.prepare(
        'INSERT INTO categories (id, owner_id, name, color, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(newId(), owner, name, color, i + 1, ts, ts)
    })
  })
}

export function localUserId(db: DB): string {
  return (db.prepare('SELECT id FROM users ORDER BY created_at LIMIT 1').get() as { id: string }).id
}

export function transaction<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
