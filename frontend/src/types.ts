export type Priority = 'high' | 'normal' | 'low'

export type View = 'board' | 'due' | 'log' | 'archive'

export type RepeatRule =
  | { freq: 'weekly'; weekday: number }
  | { freq: 'monthly'; day: number }
  | { freq: 'monthly'; nth: 1 | 2 | 3 | 4 | -1; weekday: number }

export interface Column {
  id: number
  key: string
  name: string
  position: number
  is_done: boolean
}

export interface TaskFile {
  id: number
  name: string
  mime: string | null
  size: number
  url: string
  is_image: boolean
}

export interface Activity {
  id: number
  task_id: number | null
  text: string
  at: string
}

export interface Task {
  id: number
  column_id: number
  column_key: string
  title: string
  source: string
  sender: string | null
  due: string
  priority: Priority
  quote: string
  attachments: string
  tags: string[]
  shot: string | null
  captured: string | null
  done_on: string | null
  position: number
  files: TaskFile[]
  history?: Activity[]
  /** Absent on the local Laravel API. */
  repeat?: RepeatRule | null
}

/** A channel the board captures from. Tasks store the name, not the id. */
export interface Source {
  id: number
  name: string
  position: number
  is_archived: boolean
  /** Only present from the sources endpoint, which counts them. */
  task_count?: number
}

export interface Board {
  id: number
  name: string
  slug: string
  description: string | null
  /** Includes archived ones so a task still carrying one stays readable. */
  sources: Source[]
  priorities: Priority[]
  /** False when screenshots are captured and typed rather than read automatically. */
  scan_enabled: boolean
  columns: Column[]
  tasks: Task[]
  activity: Activity[]
  archived_count?: number
  streak?: { streak: number; done_today: number; week: { label: string; count: number }[] }
  /** What this backend supports; absent on the local Laravel API. */
  features?: { repeat: boolean; archive: boolean }
}

export interface ArchivePage {
  tasks: Task[]
  total: number
  page: number
  per_page: number
}

/** A proposed task from a screenshot read, before the user confirms it. */
export interface ScanRow {
  key: string
  include: boolean
  title: string
  sender: string
  due: string
  priority: Priority
  column_key: string
  quote: string
  attachments: string
  tags: string[]
  confidence: string
}

export interface ScanResult {
  screenshot: { path: string; url: string }
  source: string
  rows: Omit<ScanRow, 'key' | 'include'>[]
  error: string | null
  /** True when automatic reading is off: capture-and-type, not a failure. */
  manual?: boolean
}

export const PRIORITY_LABEL: Record<Priority, string> = {
  high: 'Urgent',
  normal: 'Normal',
  low: 'Low',
}

export const PRIORITIES: Priority[] = ['high', 'normal', 'low']

/**
 * What the picker offers: the active sources, plus whichever archived one the
 * task already carries, so opening an old task never blanks its source.
 */
export function pickable(sources: Source[], current?: string): Source[] {
  return sources.filter((s) => !s.is_archived || s.name === current)
}
