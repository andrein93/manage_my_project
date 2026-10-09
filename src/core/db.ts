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
  `
  CREATE TABLE activity (
    cwd_key TEXT NOT NULL,
    cwd TEXT NOT NULL,
    minute TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('claude', 'git')),
    session_id TEXT,
    PRIMARY KEY (cwd_key, minute, source)
  ) WITHOUT ROWID;
  CREATE INDEX activity_minute ON activity(minute);
  CREATE INDEX activity_session ON activity(session_id) WHERE session_id IS NOT NULL;

  CREATE TABLE ai_sessions (
    session_id TEXT PRIMARY KEY,
    cwd_key TEXT NOT NULL,
    cwd TEXT NOT NULL,
    cost_usd REAL NOT NULL DEFAULT 0,
    model_usage TEXT NOT NULL DEFAULT '{}',
    first_at TEXT,
    last_at TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE time_entries (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id),
    project_id TEXT NOT NULL REFERENCES projects(id),
    date TEXT NOT NULL,
    minutes INTEGER NOT NULL CHECK (minutes BETWEEN 1 AND 1440),
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE INDEX time_entries_date ON time_entries(date) WHERE deleted_at IS NULL;

  CREATE TABLE import_state (
    source_key TEXT PRIMARY KEY,
    offset INTEGER NOT NULL DEFAULT 0,
    size INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );
  `,
  `
  CREATE TABLE session_minutes (
    session_id TEXT NOT NULL,
    minute TEXT NOT NULL,
    PRIMARY KEY (session_id, minute)
  ) WITHOUT ROWID;
  CREATE INDEX session_minutes_minute ON session_minutes(minute);
  DELETE FROM import_state WHERE source_key LIKE 'claude:%';
  `,
  `
  CREATE TABLE agreements (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id),
    project_id TEXT NOT NULL REFERENCES projects(id),
    kind TEXT NOT NULL CHECK (kind IN ('hourly', 'fixed', 'recurring')),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    interval TEXT CHECK (interval IN ('month', 'year')),
    start_date TEXT NOT NULL,
    end_date TEXT,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE INDEX agreements_project ON agreements(project_id) WHERE deleted_at IS NULL;

  CREATE TABLE payments (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id),
    project_id TEXT NOT NULL REFERENCES projects(id),
    agreement_id TEXT REFERENCES agreements(id),
    date TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );

  CREATE TABLE expenses (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id),
    project_id TEXT REFERENCES projects(id),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    interval TEXT CHECK (interval IN ('month', 'year')),
    start_date TEXT NOT NULL,
    end_date TEXT,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );

  CREATE TABLE ai_plans (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id),
    kind TEXT NOT NULL CHECK (kind IN ('api', 'subscription')),
    monthly_cents INTEGER,
    start_date TEXT NOT NULL,
    end_date TEXT,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );
  `,
  `
  ALTER TABLE projects ADD COLUMN versions TEXT NOT NULL DEFAULT '{}';
  `,
  `
  ALTER TABLE clients ADD COLUMN sync_rev TEXT;
  ALTER TABLE categories ADD COLUMN sync_rev TEXT;
  ALTER TABLE projects ADD COLUMN sync_rev TEXT;
  ALTER TABLE tasks ADD COLUMN sync_rev TEXT;
  ALTER TABLE agreements ADD COLUMN sync_rev TEXT;
  ALTER TABLE payments ADD COLUMN sync_rev TEXT;
  ALTER TABLE expenses ADD COLUMN sync_rev TEXT;
  ALTER TABLE time_entries ADD COLUMN sync_rev TEXT;
  ALTER TABLE projects ADD COLUMN shared INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE projects ADD COLUMN remote_key TEXT;
  ALTER TABLE projects ADD COLUMN local INTEGER NOT NULL DEFAULT 1;
  CREATE INDEX projects_remote_key ON projects(remote_key) WHERE remote_key IS NOT NULL;

  CREATE TABLE time_daily (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    date TEXT NOT NULL,
    minutes INTEGER NOT NULL,
    cost_usd REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    sync_rev TEXT,
    UNIQUE (user_id, device_id, project_id, date)
  );

  CREATE TABLE sync_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // Statements (pro-forma) and billing details. Local only: not part of team sync.
  `
  ALTER TABLE clients ADD COLUMN billing_name TEXT NOT NULL DEFAULT '';
  ALTER TABLE clients ADD COLUMN billing_address TEXT NOT NULL DEFAULT '';
  ALTER TABLE clients ADD COLUMN billing_tax_id TEXT NOT NULL DEFAULT '';
  ALTER TABLE payments ADD COLUMN statement_id TEXT;

  CREATE TABLE statements (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    number TEXT,
    year INTEGER,
    seq INTEGER,
    period_from TEXT NOT NULL,
    period_to TEXT NOT NULL,
    issue_date TEXT,
    due_date TEXT,
    paid_date TEXT,
    vat_rate REAL NOT NULL DEFAULT 0,
    language TEXT NOT NULL DEFAULT 'en',
    notes TEXT NOT NULL DEFAULT '',
    snapshot TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE UNIQUE INDEX statements_number ON statements(year, seq) WHERE seq IS NOT NULL;

  CREATE TABLE statement_lines (
    id TEXT PRIMARY KEY,
    statement_id TEXT NOT NULL REFERENCES statements(id),
    position INTEGER NOT NULL,
    project_id TEXT NOT NULL,
    agreement_id TEXT,
    description TEXT NOT NULL,
    quantity REAL NOT NULL,
    unit_cents INTEGER NOT NULL,
    amount_cents INTEGER NOT NULL
  );
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
  // After a team login the local user is the server identity (other members live in users too).
  const me = hasTable(db, 'sync_state')
    ? (db.prepare("SELECT value FROM sync_state WHERE key = 'userId'").get() as { value: string } | undefined)
    : undefined
  if (me) return me.value
  return (db.prepare('SELECT id FROM users ORDER BY created_at LIMIT 1').get() as { id: string }).id
}

function hasTable(db: DB, name: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)
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
