import { localUserId, transaction, type DB } from './db.js'
import { newId, now } from './ids.js'
import { cleanName, resolveRef, uniqueName } from './refs.js'
import { UserError, type Category, type CategoryInput } from './types.js'

interface CategoryRow {
  id: string
  name: string
  color: string
  position: number
  project_count: number
  created_at: string
  updated_at: string
}

/** Used in turn for new categories without an explicit color. */
const PALETTE = ['#4f56d6', '#1f9d6b', '#d97706', '#64748b', '#db2777', '#0891b2', '#7c3aed', '#65a30d']

const SELECT = `
  SELECT g.*,
    (SELECT COUNT(*) FROM projects p WHERE p.category_id = g.id AND p.deleted_at IS NULL) AS project_count
  FROM categories g
  WHERE g.deleted_at IS NULL`

export class CategoryRepository {
  constructor(private readonly db: DB) {}

  list(): Category[] {
    return (this.db.prepare(`${SELECT} ORDER BY g.position, g.name COLLATE NOCASE`).all() as unknown as CategoryRow[]).map(
      toCategory,
    )
  }

  get(id: string): Category | null {
    const row = this.db.prepare(`${SELECT} AND g.id = ?`).get(id) as CategoryRow | undefined
    return row ? toCategory(row) : null
  }

  /** id, id prefix or name. */
  resolve(ref: string): Category {
    return resolveRef(this.list(), ref, 'category')
  }

  create(input: CategoryInput): Category {
    return transaction(this.db, () => this.createUnlocked(input))
  }

  private createUnlocked(input: CategoryInput): Category {
    const name = cleanName(input.name, 'category', 80)
    const existing = this.list()
    const color = input.color === undefined ? PALETTE[existing.length % PALETTE.length] : cleanColor(input.color)
    const position = input.position ?? Math.max(0, ...existing.map((c) => c.position)) + 1
    const id = newId()
    const ts = now()
    uniqueName('category', name, () =>
      this.db
        .prepare(
          'INSERT INTO categories (id, owner_id, name, color, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(id, localUserId(this.db), name, color, position, ts, ts),
    )
    return this.get(id)!
  }

  update(id: string, input: CategoryInput): Category {
    const category = this.require(id)
    const name = input.name === undefined ? category.name : cleanName(input.name, 'category', 80)
    const color = input.color === undefined ? category.color : cleanColor(input.color)
    if (input.position !== undefined && !Number.isFinite(input.position)) throw new UserError('Invalid position')
    uniqueName('category', name, () =>
      this.db
        .prepare('UPDATE categories SET name = ?, color = ?, position = ?, updated_at = ? WHERE id = ?')
        .run(name, color, input.position ?? category.position, now(), id),
    )
    return this.get(id)!
  }

  /** Moves a category one step up or down, renumbering positions 1…n in one transaction. */
  move(id: string, direction: 'up' | 'down'): Category[] {
    this.require(id)
    transaction(this.db, () => {
      const ids = this.list().map((c) => c.id)
      const from = ids.indexOf(id)
      const to = direction === 'up' ? from - 1 : from + 1
      if (to >= 0 && to < ids.length) [ids[from], ids[to]] = [ids[to], ids[from]]
      const ts = now()
      ids.forEach((cid, i) => this.db.prepare('UPDATE categories SET position = ?, updated_at = ? WHERE id = ?').run(i + 1, ts, cid))
    })
    return this.list()
  }

  /** Soft-deletes the category and detaches it from its projects. */
  remove(id: string): Category {
    const category = this.require(id)
    const ts = now()
    transaction(this.db, () => {
      this.db.prepare('UPDATE categories SET deleted_at = ?, updated_at = ? WHERE id = ?').run(ts, ts, id)
      this.db.prepare('UPDATE projects SET category_id = NULL, updated_at = ? WHERE category_id = ?').run(ts, id)
    })
    return category
  }

  private require(id: string): Category {
    const category = this.get(id)
    if (!category) throw new UserError(`Category not found: ${id}`, 'not_found')
    return category
  }
}

function cleanColor(value: string): string {
  const color = value.trim().toLowerCase()
  if (!/^#[0-9a-f]{6}$/.test(color)) throw new UserError(`Invalid color "${value}". Use #rrggbb.`)
  return color
}

function toCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    position: Number(row.position),
    projectCount: Number(row.project_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
