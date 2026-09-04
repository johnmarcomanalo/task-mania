import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, api } from '../api'
import type { Column, Task } from '../types'
import { formatDay } from '../lib/dates'

interface Props {
  slug: string
  columns: Column[]
  todoColumnId: number
  onRestored: () => void
  notify: (text: string, tone?: 'info' | 'error') => void
}

export function ArchiveView({ slug, todoColumnId, onRestored, notify }: Props) {
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<Task[]>([])
  const [total, setTotal] = useState(0)
  // Starts true: the mount effect below fetches immediately, so there is no
  // render in between where "no rows yet" could be mistaken for "no rows ever".
  const [loading, setLoading] = useState(true)

  // Guards against an in-flight page ("Load more") landing after a newer
  // search has already replaced `rows` — only the most recent request may
  // write back into state.
  const reqId = useRef(0)

  const fetchPage = useCallback(async (query: string, pageNum: number, append: boolean) => {
    const id = ++reqId.current
    setLoading(true)
    try {
      const data = await api.archive(slug, query, pageNum)
      if (id !== reqId.current) return
      setRows((prev) => (append ? [...prev, ...data.tasks] : data.tasks))
      setTotal(data.total)
      setPage(data.page)
    } catch (e) {
      if (id !== reqId.current) return
      notify(e instanceof ApiError ? e.message : 'Could not load the archive.', 'error')
    } finally {
      if (id === reqId.current) setLoading(false)
    }
  }, [slug, notify])

  // Only the search box is debounced — typing settles here before it drives a fetch.
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQ(q), 300)
    return () => window.clearTimeout(timer)
  }, [q])

  // Page 1 loads at once: on mount `debouncedQ` already equals its initial '',
  // so this fires on the first render, not behind the search debounce; later
  // it re-fires only once the search settles.
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- loading page 1 as soon as this view opens or the search settles is the whole point of this effect
    void fetchPage(debouncedQ, 1, false)
  }, [debouncedQ, fetchPage])

  async function restore(task: Task) {
    try {
      await api.moveTask(task.id, { column_id: todoColumnId, position: 0 })
      void fetchPage(debouncedQ, 1, false)
      notify('Restored to To Do')
      onRestored()
    } catch (e) {
      notify(e instanceof ApiError ? e.message : 'Could not restore that task.', 'error')
    }
  }

  return (
    <div className="listview">
      <div className="listview__inner" style={{ maxWidth: 720 }}>
        <h1 className="listview__title">Archive</h1>

        <input
          className="input"
          type="text"
          placeholder="Search archived tasks…"
          aria-label="Search archived tasks"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ fontSize: 12, minHeight: 30 }}
        />

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {rows.map((t) => (
            <div className="archrow" key={t.id}>
              <span className="archrow__when">{t.done_on ? formatDay(t.done_on) : ''}</span>
              <span>{t.title}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-neutral-500)' }}>
                <span>{t.sender ?? t.source}</span>
                {t.tags.map((tag) => (
                  <span key={tag} className="tcard__tag">{tag}</span>
                ))}
              </span>
              <button
                className="btn btn-ghost"
                style={{ fontSize: 11.5, minHeight: 26 }}
                onClick={() => void restore(t)}
              >
                Restore
              </button>
            </div>
          ))}
        </div>

        {!loading && rows.length === 0 && (
          <p style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>
            Nothing archived yet — tasks move here 30 days after they are done.
          </p>
        )}

        {rows.length < total && (
          <button
            className="btn btn-ghost"
            disabled={loading}
            onClick={() => void fetchPage(debouncedQ, page + 1, true)}
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        )}
      </div>
    </div>
  )
}
