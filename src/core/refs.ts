import { UserError } from './types.js'

const MIN_PREFIX = 6

/**
 * Resolves a user-typed reference against a list: exact id, id prefix (≥ 6 chars) or, when the
 * items have names, a case-insensitive name. Ambiguous matches are errors listing candidates.
 */
export function resolveRef<T extends { id: string; name?: string; title?: string }>(
  items: T[],
  ref: string,
  label: string,
  notFoundHint = '',
): T {
  const value = ref.trim()
  const lower = value.toLowerCase()
  const exact = items.find((i) => i.id === value)
  if (exact) return exact

  const byName = items.filter((i) => i.name !== undefined && i.name.toLowerCase() === lower)
  if (byName.length === 1) return byName[0]

  const byPrefix = value.length >= MIN_PREFIX ? items.filter((i) => i.id.startsWith(lower)) : []
  const matches = byName.length > 1 ? byName : byPrefix
  if (matches.length === 1) return matches[0]
  if (matches.length > 1) {
    const list = matches.map((i) => `  ${i.id.slice(0, 8)}  ${i.name ?? i.title ?? ''}`).join('\n')
    throw new UserError(`"${ref}" matches ${matches.length} ${label}s:\n${list}`, 'conflict')
  }
  throw new UserError(`${capitalize(label)} not found: ${ref}${notFoundHint}`, 'not_found')
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Trims a name and rejects empty or over-long values. */
export function cleanName(value: string | undefined, label: string, max = 200): string {
  const name = (value ?? '').trim()
  if (!name) throw new UserError(`${capitalize(label)} name cannot be empty`)
  // "none" means "no client/category" in filters and patches.
  if (name.toLowerCase() === 'none') throw new UserError(`"${name}" is reserved; choose another ${label} name`)
  if (name.length > max) throw new UserError(`${capitalize(label)} name is too long (max ${max})`)
  return name
}

/** Maps SQLite unique-constraint failures to a friendly conflict error. */
export function uniqueName<T>(label: string, name: string, fn: () => T): T {
  try {
    return fn()
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) {
      throw new UserError(`A ${label} named "${name}" already exists`, 'conflict')
    }
    throw error
  }
}
