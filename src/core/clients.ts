import { localUserId, transaction, type DB } from './db.js'
import { newId, now } from './ids.js'
import { cleanName, resolveRef, uniqueName } from './refs.js'
import { UserError, type Client, type ClientInput } from './types.js'

interface ClientRow {
  id: string
  name: string
  email: string
  notes: string
  project_count: number
  open_task_count: number
  created_at: string
  updated_at: string
}

const SELECT = `
  SELECT c.*,
    (SELECT COUNT(*) FROM projects p WHERE p.client_id = c.id AND p.deleted_at IS NULL) AS project_count,
    (SELECT COUNT(*) FROM tasks t JOIN projects p ON p.id = t.project_id
      WHERE p.client_id = c.id AND p.deleted_at IS NULL AND t.deleted_at IS NULL AND t.status != 'done') AS open_task_count
  FROM clients c
  WHERE c.deleted_at IS NULL`

export class ClientRepository {
  constructor(private readonly db: DB) {}

  list(): Client[] {
    return (this.db.prepare(`${SELECT} ORDER BY c.name COLLATE NOCASE`).all() as unknown as ClientRow[]).map(toClient)
  }

  get(id: string): Client | null {
    const row = this.db.prepare(`${SELECT} AND c.id = ?`).get(id) as ClientRow | undefined
    return row ? toClient(row) : null
  }

  /** id, id prefix or name. */
  resolve(ref: string): Client {
    return resolveRef(this.list(), ref, 'client', '. Create it first (mmp client add, or create_client).')
  }

  create(input: ClientInput): Client {
    const name = cleanName(input.name, 'client')
    const id = newId()
    const ts = now()
    uniqueName('client', name, () =>
      this.db
        .prepare(
          'INSERT INTO clients (id, owner_id, name, email, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(id, localUserId(this.db), name, cleanText(input.email, 320), cleanText(input.notes, 20_000), ts, ts),
    )
    return this.get(id)!
  }

  update(id: string, input: ClientInput): Client {
    const client = this.require(id)
    const name = input.name === undefined ? client.name : cleanName(input.name, 'client')
    uniqueName('client', name, () =>
      this.db
        .prepare('UPDATE clients SET name = ?, email = ?, notes = ?, updated_at = ? WHERE id = ?')
        .run(
          name,
          input.email === undefined ? client.email : cleanText(input.email, 320),
          input.notes === undefined ? client.notes : cleanText(input.notes, 20_000),
          now(),
          id,
        ),
    )
    return this.get(id)!
  }

  /** Soft-deletes the client and detaches it from its projects. */
  remove(id: string): Client {
    const client = this.require(id)
    const ts = now()
    transaction(this.db, () => {
      this.db.prepare('UPDATE clients SET deleted_at = ?, updated_at = ? WHERE id = ?').run(ts, ts, id)
      this.db.prepare('UPDATE projects SET client_id = NULL, updated_at = ? WHERE client_id = ?').run(ts, id)
    })
    return client
  }

  private require(id: string): Client {
    const client = this.get(id)
    if (!client) throw new UserError(`Client not found: ${id}`, 'not_found')
    return client
  }
}

export function cleanText(value: string | undefined, max: number): string {
  const text = (value ?? '').trim()
  if (text.length > max) throw new UserError(`Text is too long (max ${max} characters)`)
  return text
}

function toClient(row: ClientRow): Client {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    notes: row.notes,
    projectCount: Number(row.project_count),
    openTaskCount: Number(row.open_task_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
