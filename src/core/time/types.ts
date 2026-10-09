// Plain types shared by the server and the dashboard (no runtime imports here).

export const GROUP_BY = ['project', 'client', 'category', 'day'] as const
export type GroupBy = (typeof GROUP_BY)[number]

export interface DateRange {
  /** Inclusive local dates, YYYY-MM-DD. */
  from: string
  to: string
}

export interface ReportRow {
  /** Project/client/category id, 'none', or a date for `day`. */
  key: string
  label: string
  color: string | null
  minutes: number
  costUsd: number
  /** Share of the report's total minutes, 0–1. */
  share: number
}

export interface TimeReport {
  range: DateRange
  by: GroupBy
  totals: { minutes: number; autoMinutes: number; manualMinutes: number; costUsd: number }
  rows: ReportRow[]
  days: { date: string; minutes: number; costUsd: number }[]
  unassigned: { cwd: string; minutes: number; costUsd: number }[]
}

export interface TimeEntry {
  id: string
  projectId: string
  projectName: string
  date: string
  minutes: number
  note: string
  createdAt: string
  updatedAt: string
}

export interface WorkBlock {
  start: string
  end: string
  minutes: number
  sources: ('claude' | 'git' | 'editor')[]
  sessionIds: string[]
}

export interface SyncResult {
  claudeDirFound: boolean
  files: number
  filesRead: number
  linesRead: number
  skippedLines: number
  signals: number
  sessions: number
  commits: number
  errors: { source: string; message: string }[]
  durationMs: number
}
