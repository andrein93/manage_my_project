import type { DB } from '../db.js'
import { now } from '../ids.js'

const CHILDREN = ['tasks', 'time_entries', 'agreements', 'payments', 'expenses', 'time_daily', 'statement_lines']

/**
 * Sharing a local project whose repository is already a team project (pulled as "not on this
 * computer"): the team project takes over the folder and the local project's data.
 * Call inside a transaction with deferred foreign keys. Returns the team project id.
 */
export function mergeIntoTeamProject(db: DB, localId: string, teamId: string): string {
  const local = db.prepare('SELECT * FROM projects WHERE id = ?').get(localId) as Record<string, unknown>
  for (const table of CHILDREN) db.prepare(`UPDATE ${table} SET project_id = ? WHERE project_id = ?`).run(teamId, localId)
  db.prepare('INSERT OR IGNORE INTO project_tags (project_id, tag_id) SELECT ?, tag_id FROM project_tags WHERE project_id = ?').run(teamId, localId)
  db.prepare('DELETE FROM project_tags WHERE project_id = ?').run(localId)
  // Custom field values are local: the user's values for this folder win over any typed on the team project.
  db.prepare(
    `INSERT INTO project_field_values (project_id, field_id, value, updated_at)
     SELECT ?, field_id, value, updated_at FROM project_field_values WHERE project_id = ?
     ON CONFLICT(project_id, field_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(teamId, localId)
  db.prepare('DELETE FROM project_field_values WHERE project_id = ?').run(localId)
  // Free the folder, then hand it to the team project (folder data is local, not synced).
  db.prepare("UPDATE projects SET path_key = 'merged:' || id WHERE id = ?").run(localId)
  db.prepare(
    `UPDATE projects SET local = 1, shared = 1, path = ?, path_key = ?, workspace_id = ?, source = ?, stack = ?, git = ?,
       versions = ?, last_activity_at = ?, missing_since = ? WHERE id = ?`,
  ).run(
    local.path as string,
    local.path_key as string,
    local.workspace_id as string | null,
    local.source as string,
    local.stack as string,
    local.git as string | null,
    local.versions as string,
    local.last_activity_at as string | null,
    local.missing_since as string | null,
    teamId,
  )
  if (local.sync_rev === null) db.prepare('DELETE FROM projects WHERE id = ?').run(localId)
  else {
    const ts = now()
    db.prepare('UPDATE projects SET deleted_at = ?, updated_at = ? WHERE id = ?').run(ts, ts, localId)
  }
  return teamId
}
