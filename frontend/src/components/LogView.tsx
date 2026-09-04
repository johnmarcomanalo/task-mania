import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, api } from '../api'
import type { Activity } from '../types'
import { formatDay, iso, shiftDay, today } from '../lib/dates'

interface Props {
  slug: string
  onOpen: (taskId: number) => void
  notify: (text: string, tone?: 'info' | 'error') => void
}

interface Group {
  key: string
  rows: Activity[]
}

/** `Today` / `Yesterday` for the two most recent days, `formatDay` beyond that. */
function dayHeading(key: string): string {
  if (key === today()) return 'Today'
  if (key === shiftDay(-1)) return 'Yesterday'
  return formatDay(key)
}

/** Consecutive rows sharing a local calendar day, in the order the server sent them. */
function groupByDay(rows: Activity[]): Group[] {
  const groups: Group[] = []
  for (const a of rows) {
    const key = iso(new Date(a.at))
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.rows.push(a)
    else groups.push({ key, rows: [a] })
  }
  return groups
}

export function LogView({ slug, onOpen, notify }: Props) {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<Activity[]>([])
  // Starts true: the mount effect below fetches immediately, so there is no
  // render in between where "no rows yet" could be mistaken for "no rows ever".
  const [loading, setLoading] = useState(true)

  // Guards against a slower, earlier request landing after a newer one (a
  // board switch) has already replaced `rows` — only the latest may write back.
  const reqId = useRef(0)

  const fetchActivity = useCallback(async () => {
    const id = ++reqId.current
    setLoading(true)
    try {
      const data = await api.activity(slug)
      if (id !== reqId.current) return
      setRows(data)
    } catch (e) {
      if (id !== reqId.current) return
      notify(e instanceof ApiError ? e.message : 'Could not load the activity log.', 'error')
    } finally {
      if (id === reqId.current) setLoading(false)
    }
  }, [slug, notify])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- loading the log as soon as this view opens (or the board changes) is the whole point of this effect
    void fetchActivity()
  }, [fetchActivity])

  const query = q.trim().toLowerCase()
  const filtered = query
    ? rows.filter((a) => (a.task_title ?? '').toLowerCase().includes(query) || a.text.toLowerCase().includes(query))
    : rows
  const groups = groupByDay(filtered)

  return (
    <div className="listview">
      <div className="listview__inner" style={{ maxWidth: 640 }}>
        <h1 className="listview__title">Activity log</h1>

        <input
          className="input"
          type="text"
          placeholder="Search the log…"
          aria-label="Search the log"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ fontSize: 12, minHeight: 30 }}
        />

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {groups.map((g) => (
            <div key={g.key}>
              <div className="logday">{dayHeading(g.key)}</div>
              {g.rows.map((a) => (
                <div className="logrow" key={a.id}>
                  <span className="logrow__when">
                    {new Date(a.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {a.task_title ? (
                    <button className="btn btn-ghost logrow__task" onClick={() => onOpen(a.task_id!)}>
                      {a.task_title}
                    </button>
                  ) : (
                    <span className="logrow__task" />
                  )}
                  <span className="logrow__text">{a.text}</span>
                </div>
              ))}
            </div>
          ))}
        </div>

        {!loading && rows.length === 0 && (
          <p style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>Nothing recorded yet.</p>
        )}

        {!loading && rows.length > 0 && filtered.length === 0 && (
          <p style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>No log lines match "{q.trim()}".</p>
        )}
      </div>
    </div>
  )
}
