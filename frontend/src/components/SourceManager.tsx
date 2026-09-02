import { useEffect, useRef, useState } from 'react'
import { ApiError, api } from '../api'
import type { Board, Source } from '../types'

interface Props {
  board: Board
  onClose: () => void
  /** Sources changed: the board needs reloading so tasks show the new names. */
  onChanged: () => void
}

/**
 * Add, rename, archive and delete the channels a board captures from.
 *
 * Tasks store the source name rather than an id, so renaming here rewrites
 * the tasks that carried the old name, and a name still in use is archived
 * instead of deleted: it leaves the picker but stays readable on old tasks.
 */
export function SourceManager({ board, onClose, onChanged }: Props) {
  const [rows, setRows] = useState<Source[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [msg, setMsg] = useState<{ text: string; warn?: boolean } | null>(null)

  const addRef = useRef<HTMLInputElement>(null)

  async function refresh() {
    setRows(await api.listSources(board.slug))
    setLoaded(true)
  }

  useEffect(() => {
    void refresh().catch((e) => say(e, true))
    addRef.current?.focus()
  }, [board.slug])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  function say(e: unknown, warn = false) {
    const text = e instanceof ApiError
      ? Object.values(e.errors)[0]?.[0] ?? e.message
      : e instanceof Error ? e.message : String(e)
    setMsg({ text, warn })
  }

  /** Every mutation refreshes this list and the board behind it. */
  async function run(work: () => Promise<string | null>) {
    setBusy(true)
    setMsg(null)
    try {
      const note = await work()
      await refresh()
      onChanged()
      if (note) setMsg({ text: note })
    } catch (e) {
      say(e, true)
    } finally {
      setBusy(false)
    }
  }

  function add() {
    const name = draft.trim()
    if (!name) return
    void run(async () => {
      await api.createSource(board.slug, name)
      setDraft('')
      return `Added ${name}.`
    })
  }

  function rename(row: Source, name: string) {
    const next = name.trim()
    if (!next || next === row.name) return
    void run(async () => {
      await api.updateSource(row.id, { name: next })
      return row.task_count
        ? `Renamed to ${next}, and on ${row.task_count} ${row.task_count === 1 ? 'task' : 'tasks'}.`
        : `Renamed to ${next}.`
    })
  }

  function setArchived(row: Source, is_archived: boolean) {
    void run(async () => {
      await api.updateSource(row.id, { is_archived })
      return is_archived ? `${row.name} left the picker.` : `${row.name} is back in the picker.`
    })
  }

  function remove(row: Source) {
    void run(async () => {
      const res = await api.deleteSource(row.id)
      return res.archived
        ? `${row.name} is still on ${res.tasks_using} ${res.tasks_using === 1 ? 'task' : 'tasks'}, so it was archived instead of deleted.`
        : `Deleted ${row.name}.`
    })
  }

  return (
    <div
      className="srcman"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="dialog srcman__panel" role="dialog" aria-modal="true" aria-labelledby="srcman-title">
        <header className="srcman__head">
          <h2 className="dialog-title" id="srcman-title">Sources</h2>
          <p className="srcman__note">
            Renaming one updates every task that carries it. Deleting a source that tasks
            still use archives it instead: it leaves the picker, the old tasks keep it.
          </p>
        </header>

        <div className="srcman__add">
          <input
            ref={addRef}
            className="input"
            type="text"
            maxLength={24}
            placeholder="Add a source"
            aria-label="New source name"
            value={draft}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add() }}
          />
          <button className="btn btn-primary" onClick={add} disabled={busy || !draft.trim()}>
            Add
          </button>
        </div>

        <div className="srcman__list">
          {loaded && !rows.length && (
            <p className="srcman__note">No sources yet. Add the first one above.</p>
          )}

          {rows.map((row) => (
            <div
              key={row.id}
              className={`srcman__row${row.is_archived ? ' srcman__row--archived' : ''}`}
            >
              <input
                className="input mini srcman__name"
                type="text"
                maxLength={24}
                defaultValue={row.name}
                key={`${row.id}-${row.name}`}
                aria-label={`Rename ${row.name}`}
                disabled={busy}
                onBlur={(e) => rename(row, e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
              />

              {row.is_archived && <span className="srcman__tag">Archived</span>}

              <span className="srcman__count">
                {row.task_count ?? 0} {row.task_count === 1 ? 'task' : 'tasks'}
              </span>

              <div className="srcman__acts">
                <button
                  className="btn btn-ghost"
                  disabled={busy}
                  onClick={() => setArchived(row, !row.is_archived)}
                >
                  {row.is_archived ? 'Restore' : 'Archive'}
                </button>
                <button
                  className="btn btn-ghost srcman__kill"
                  disabled={busy}
                  onClick={() => remove(row)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>

        <footer className="srcman__foot">
          <span className={`srcman__msg${msg?.warn ? ' srcman__msg--warn' : ''}`}>
            {msg?.text ?? ''}
          </span>
          <button className="btn btn-secondary" onClick={onClose}>Done</button>
        </footer>
      </div>
    </div>
  )
}
