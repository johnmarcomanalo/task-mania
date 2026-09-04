import { useCallback, useEffect, useState } from 'react'
import { ApiError, api } from '../api'
import type { Column, Task } from '../types'
import { formatWhen } from '../lib/dates'

interface Props {
  slug: string
  columns: Column[]
  todoColumnId: number
  onRestored: () => void
  notify: (text: string, tone?: 'info' | 'error') => void
}

export function ArchiveView({ slug, todoColumnId, onRestored, notify }: Props) {
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<Task[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)

  const fetchPage = useCallback(async (query: string, pageNum: number, append: boolean) => {
    setLoading(true)
    try {
      const data = await api.archive(slug, query, pageNum)
      setRows((prev) => (append ? [...prev, ...data.tasks] : data.tasks))
      setTotal(data.total)
      setPage(data.page)
    } catch (e) {
      notify(e instanceof ApiError ? e.message : 'Could not load the archive.', 'error')
    } finally {
      setLoading(false)
    }
  }, [slug, notify])

  // Page 1 on mount, and again whenever the search box settles.
  useEffect(() => {
    const timer = window.setTimeout(() => void fetchPage(q, 1, false), 300)
    return () => window.clearTimeout(timer)
  }, [q, fetchPage])

  async function restore(task: Task) {
    try {
      await api.moveTask(task.id, { column_id: todoColumnId, position: 0 })
      setRows((prev) => prev.filter((t) => t.id !== task.id))
      setTotal((t) => t - 1)
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
              <span className="archrow__when">{t.done_on ? formatWhen(t.done_on) : ''}</span>
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

        {rows.length === 0 && !loading && (
          <p style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>
            Nothing archived yet — tasks move here 30 days after they are done.
          </p>
        )}

        {rows.length < total && (
          <button
            className="btn btn-ghost"
            disabled={loading}
            onClick={() => void fetchPage(q, page + 1, true)}
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        )}
      </div>
    </div>
  )
}
