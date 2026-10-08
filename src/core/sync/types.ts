// Plain types shared by the server and the dashboard (no runtime imports here).

export interface SyncRunResult {
  pushed: number
  pulled: number
  applied: number
  skipped: number
  durationMs: number
}

export interface SyncStatus {
  configured: boolean
  url: string | null
  user: { id: string; name: string; email: string } | null
  running: boolean
  lastRun: (SyncRunResult & { at: string }) | null
  lastError: string | null
}

export interface TeamMember {
  id: string
  name: string
  me: boolean
}
