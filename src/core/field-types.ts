// Plain types shared by the server and the dashboard (no runtime imports here).

export const FIELD_KINDS = ['text', 'url', 'date', 'number'] as const
export type FieldKind = (typeof FIELD_KINDS)[number]

export interface ProjectField {
  id: string
  name: string
  kind: FieldKind
  position: number
  /** Date fields: remind this many days before the date; null = never. Always null for other kinds. */
  remindDays: number | null
}

export interface FieldValue {
  fieldId: string
  name: string
  kind: FieldKind
  /** '' when not set. */
  value: string
}

export interface UpcomingFieldDate {
  projectId: string
  projectName: string
  fieldId: string
  fieldName: string
  date: string
  /** Negative when the date has passed. */
  daysLeft: number
}
