export const DEFAULT_COLUMNS = [
  { key: 'inbox', name: 'Inbox', is_done: false },
  { key: 'todo', name: 'To Do', is_done: false },
  { key: 'doing', name: 'In Progress', is_done: false },
  { key: 'wait', name: 'Waiting', is_done: false },
  { key: 'review', name: 'For Review', is_done: false },
  { key: 'done', name: 'Done', is_done: true },
] as const

export const DEFAULT_SOURCES = [
  'Viber', 'Email', 'Messenger', 'WhatsApp', 'Teams', 'SMS', 'Slack', 'Manual',
] as const

export const PRIORITIES = ['high', 'normal', 'low'] as const
export type Priority = (typeof PRIORITIES)[number]

/** Matches the width of tasks.source, which holds the name verbatim. */
export const SOURCE_MAX_NAME = 24
