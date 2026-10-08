import type { App } from './app.js'

const isNone = (ref: string) => ref.trim().toLowerCase() === 'none'

/** Client name/id → id; 'none' passes through; undefined stays undefined. */
export function resolveClientFilter(app: App, ref: string | undefined): string | undefined {
  if (ref === undefined) return undefined
  return isNone(ref) ? 'none' : app.clients.resolve(ref).id
}

/** Category name/id → id; 'none' passes through; undefined stays undefined. */
export function resolveCategoryFilter(app: App, ref: string | undefined): string | undefined {
  if (ref === undefined) return undefined
  return isNone(ref) ? 'none' : app.categories.resolve(ref).id
}

/** For patches: undefined = unchanged, 'none'/null = clear, otherwise resolve to an id. */
export function resolveClientPatch(app: App, ref: string | null | undefined): string | null | undefined {
  if (ref === undefined) return undefined
  return ref === null || isNone(ref) ? null : app.clients.resolve(ref).id
}

export function resolveCategoryPatch(app: App, ref: string | null | undefined): string | null | undefined {
  if (ref === undefined) return undefined
  return ref === null || isNone(ref) ? null : app.categories.resolve(ref).id
}
