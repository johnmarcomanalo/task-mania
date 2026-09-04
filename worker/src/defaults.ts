export const DEFAULT_COLUMNS: { key: string; name: string; is_done: boolean; is_cancelled: boolean }[] = [
  { key: 'inbox', name: 'Inbox', is_done: false, is_cancelled: false },
  { key: 'todo', name: 'To Do', is_done: false, is_cancelled: false },
  { key: 'doing', name: 'In Progress', is_done: false, is_cancelled: false },
  { key: 'wait', name: 'Waiting', is_done: false, is_cancelled: false },
  { key: 'review', name: 'For Review', is_done: false, is_cancelled: false },
  { key: 'done', name: 'Done', is_done: true, is_cancelled: false },
  { key: 'cancelled', name: 'Cancelled', is_done: false, is_cancelled: true },
]

export const DEFAULT_SOURCES = [
  'Viber', 'Email', 'Messenger', 'WhatsApp', 'Teams', 'SMS', 'Slack', 'Manual',
] as const

export const PRIORITIES = ['high', 'normal', 'low'] as const
export type Priority = (typeof PRIORITIES)[number]

/** Matches the width of tasks.source, which holds the name verbatim. */
export const SOURCE_MAX_NAME = 24
