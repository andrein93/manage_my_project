import type { App } from './app.js'
import { resolveRef } from './refs.js'

/** Member name/id → id; "none"/null clears; undefined stays undefined. */
export function resolveAssignee(app: App, ref: string | null | undefined): string | null | undefined {
  if (ref === undefined) return undefined
  if (ref === null || ref.trim().toLowerCase() === 'none') return null
  return resolveRef(app.sync.members(), ref, 'team member').id
}
