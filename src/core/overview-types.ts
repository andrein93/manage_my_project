// Plain types shared by the server and the dashboard (no runtime imports here).
import type { HealthFlag } from './types.js'

export interface UpcomingItem {
  /** The expense or agreement this charge comes from. */
  sourceId: string
  date: string
  /** pay = a cost coming up; invoice = a recurring fee to bill. */
  direction: 'pay' | 'invoice'
  /** The user's note; empty when none (renderers pick a default label). */
  label: string
  projectId: string | null
  projectName: string | null
  amountCents: number
}

export interface Overview {
  today: string
  currency: string
  week: {
    from: string
    to: string
    minutes: number
    costUsd: number
    tasksCompleted: number
    topProjects: { id: string; name: string; minutes: number }[]
  }
  month: { from: string; to: string; earnedCents: number; collectedCents: number; marginCents: number }
  attention: {
    overdueTasks: { id: string; title: string; dueDate: string; projectId: string; projectName: string }[]
    health: { projectId: string; projectName: string; flags: HealthFlag[] }[]
    owed: { clientId: string; clientName: string; owedCents: number }[]
    upcoming: UpcomingItem[]
    /** Issued statements past their due date. */
    overdueStatements: { id: string; number: string; clientName: string; totalCents: number; dueDate: string }[]
  }
}

export interface Digest {
  from: string
  to: string
  currency: string
  minutes: number
  costUsd: number
  earnedCents: number
  collectedCents: number
  topProjects: { name: string; minutes: number }[]
  tasksCompleted: { title: string; projectName: string }[]
  overdueTasks: number
  health: Record<string, string[]>
  owedCents: number
  upcoming: UpcomingItem[]
}
