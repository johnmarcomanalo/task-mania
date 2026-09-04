import { useEffect, useRef, useState } from 'react'
import type { Board, Priority, Task, TaskFile } from '../types'
import { PRIORITIES, PRIORITY_LABEL, pickable } from '../types'
import type { TaskInput } from '../api'
import { formatSize, formatWhen } from '../lib/dates'
import { RepeatEditor } from './RepeatEditor'

interface Props {
  task: Task
  board: Board
  saving: boolean
  savedAt: number | null
  /** True while the enlarged image is open: Escape belongs to it, not to us. */
  lightboxOpen: boolean
  onClose: () => void
  onPatch: (id: number, body: TaskInput) => void
  onDelete: (task: Task) => void
  onAttach: (task: Task, files: File[]) => void
  onDetach: (task: Task, file: TaskFile) => void
  onView: (file: { name: string; url: string; meta: string }) => void
  onManageSources: () => void
}

export function DetailPanel({
  task, board, saving, savedAt, lightboxOpen, onClose, onPatch, onDelete, onAttach, onDetach, onView,
  onManageSources,
}: Props) {
  const [title, setTitle] = useState(task.title)
  const [quote, setQuote] = useState(task.quote)
  const [sender, setSender] = useState(task.sender ?? '')
  const [tagText, setTagText] = useState(task.tags.join(', '))
  const [zoneOver, setZoneOver] = useState(false)
  /** First press arms the delete; the second one carries it out. */
  const [armed, setArmed] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)
  const timers = useRef<Record<string, number>>({})
  const disarm = useRef<number | undefined>(undefined)

  // Reload the form when a different card is opened.
  useEffect(() => {
    setTitle(task.title)
    setQuote(task.quote)
    setSender(task.sender ?? '')
    setTagText(task.tags.join(', '))
    setArmed(false)
  }, [task.id])

  // An armed delete goes cold on its own, so a stray click never lands on a
  // button that is still one press from destroying something.
  useEffect(() => {
    if (!armed) return
    disarm.current = window.setTimeout(() => setArmed(false), 3000)
    return () => window.clearTimeout(disarm.current)
  }, [armed])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !lightboxOpen) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, lightboxOpen])

  /** Debounce text edits so typing doesn't fire a request per keystroke. */
  function debounced(field: string, body: TaskInput, ms = 500) {
    window.clearTimeout(timers.current[field])
    timers.current[field] = window.setTimeout(() => onPatch(task.id, body), ms)
  }

  const column = board.columns.find((c) => c.id === task.column_id)

  return (
    <aside className="detail" aria-label={`Task detail: ${task.title}`}>
      <header className="detail__head">
        <span className="detail__sub">Task detail</span>
        <span style={{ flex: 1 }} />
        <button
          className="btn btn-ghost"
          onClick={onClose}
          aria-label="Close detail panel"
          style={{ minHeight: 22, padding: '0 8px', fontSize: 14, lineHeight: 1 }}
        >
          ×
        </button>
      </header>

      <div className="detail__body">
        <textarea
          className="input detail__title"
          value={title}
          rows={2}
          aria-label="Task title"
          onChange={(e) => {
            setTitle(e.target.value)
            if (e.target.value.trim()) debounced('title', { title: e.target.value.trim() })
          }}
        />

        <div className="detail__grid">
          <span className="detail__key">Status</span>
          <select
            className="input mini"
            value={task.column_id}
            aria-label="Status"
            onChange={(e) => onPatch(task.id, { column_id: Number(e.target.value) })}
          >
            {board.columns.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>

          <span className="detail__key">Source</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <select
              className="input mini"
              style={{ flex: 1, minWidth: 0 }}
              value={task.source}
              aria-label="Source"
              onChange={(e) => onPatch(task.id, { source: e.target.value })}
            >
              {/* An archived source stays listed while the task still carries it. */}
              {pickable(board.sources, task.source).map((s) => (
                <option key={s.id} value={s.name}>{s.name}</option>
              ))}
            </select>
            <button
              className="btn btn-ghost"
              style={{ fontSize: 10.5, minHeight: 24 }}
              onClick={onManageSources}
            >
              Manage
            </button>
          </div>

          <span className="detail__key">Sender</span>
          <input
            className="input mini"
            type="text"
            placeholder="—"
            value={sender}
            aria-label="Sender"
            onChange={(e) => {
              setSender(e.target.value)
              debounced('sender', { sender: e.target.value || null })
            }}
          />

          <span className="detail__key">Due</span>
          <input
            className="input mini"
            type="date"
            value={task.due}
            aria-label="Due date"
            onChange={(e) => onPatch(task.id, { due: e.target.value || null })}
          />

          {board.features?.repeat && (
            <>
              <span className="detail__key">Repeat</span>
              <RepeatEditor
                value={task.repeat}
                due={task.due}
                onChange={(rule) => onPatch(task.id, { repeat: rule })}
              />
            </>
          )}

          <span className="detail__key">Priority</span>
          <select
            className="input mini"
            value={task.priority}
            aria-label="Priority"
            onChange={(e) => onPatch(task.id, { priority: e.target.value as Priority })}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
            ))}
          </select>

          <span className="detail__key">Tags</span>
          <input
            className="input mini"
            type="text"
            placeholder="client, finance"
            value={tagText}
            aria-label="Tags, comma separated"
            onChange={(e) => {
              setTagText(e.target.value)
              debounced('tags', {
                tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 6),
              }, 700)
            }}
          />

          <span className="detail__key">Captured</span>
          <span className="detail__key">{task.captured ?? '—'}</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <span className="detail__sub">{task.shot ? 'Quoted from the message' : 'Notes'}</span>
          <textarea
            className="input"
            rows={3}
            value={quote}
            placeholder="Add notes or the original message"
            aria-label="Notes"
            onChange={(e) => {
              setQuote(e.target.value)
              debounced('quote', { quote: e.target.value || null })
            }}
            style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--color-neutral-300)' }}
          />
        </div>

        {(saving || savedAt) && (
          <div className="detail__saved">{saving ? 'Saving…' : 'Saved'}</div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <span className="detail__sub">Source file</span>
          {task.shot ? (
            <button
              className="detail__shot"
              onClick={() => onView({ name: 'Source screenshot', url: task.shot!, meta: '' })}
              style={{ border: 0, padding: 0, cursor: 'zoom-in', background: 'transparent' }}
            >
              <img src={task.shot} alt="Source screenshot" />
            </button>
          ) : (
            <p className="detail__note">Added manually — no screenshot.</p>
          )}
        </div>

        <div className="detail__section">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)' }}>
            <span className="detail__sub">Attachment</span>
            <span style={{ fontSize: '9.5px', color: 'var(--color-neutral-500)' }}>
              {task.files.length || ''}
            </span>
            <span style={{ flex: 1 }} />
            <button
              className="btn btn-ghost"
              onClick={() => fileRef.current?.click()}
              style={{ fontSize: '10.5px', minHeight: 22, padding: '0 8px' }}
            >
              + File
            </button>
          </div>

          {task.attachments && (
            <p className="detail__note">Mentioned in message: {task.attachments}</p>
          )}

          {task.files.map((f) => (
            <div className="filerow" key={f.id}>
              <button
                className="filerow__thumb"
                onClick={() => onView({ name: f.name, url: f.url, meta: formatSize(f.size) })}
                title={`Open ${f.name}`}
              >
                {f.is_image ? <img src={f.url} alt="" /> : (f.name.split('.').pop() ?? 'file')}
              </button>
              <button
                className="filerow__name"
                onClick={() => onView({ name: f.name, url: f.url, meta: formatSize(f.size) })}
              >
                <span className="filerow__n">{f.name}</span>
                <span className="filerow__m">{formatSize(f.size)}</span>
              </button>
              <a
                className="btn btn-ghost"
                href={f.url}
                download={f.name}
                title="Download"
                style={{ fontSize: '9.5px', minHeight: 20, padding: '0 7px' }}
              >
                Save
              </a>
              <button
                onClick={() => onDetach(task, f)}
                title="Remove"
                aria-label={`Remove ${f.name}`}
                style={{
                  flex: 'none', fontSize: 13, lineHeight: 1, padding: '2px 6px', border: 0,
                  borderRadius: 'var(--radius-sm)', background: 'transparent',
                  color: 'var(--color-neutral-500)', cursor: 'pointer',
                }}
              >
                ×
              </button>
            </div>
          ))}

          <button
            className={'dropzone' + (zoneOver ? ' dropzone--over' : '')}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setZoneOver(true) }}
            onDragLeave={() => setZoneOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setZoneOver(false)
              const files = Array.from(e.dataTransfer.files)
              if (files.length) onAttach(task, files)
            }}
          >
            {zoneOver ? 'Drop to attach' : 'Drop, paste, or click to choose'}
          </button>

          <input
            ref={fileRef}
            type="file"
            multiple
            className="vh"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? [])
              if (files.length) onAttach(task, files)
              e.target.value = ''
            }}
          />
        </div>

        <div className="detail__section">
          <span className="detail__sub">Move to</span>
          <div className="chips">
            {board.columns.filter((c) => c.id !== task.column_id).map((c) => (
              <button
                key={c.id}
                className="chip"
                onClick={() => onPatch(task.id, { column_id: c.id })}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>

        <div className="detail__section">
          <span className="detail__sub">History</span>
          {!task.history?.length && (
            <span style={{ fontSize: '10.5px', color: 'var(--color-neutral-500)' }}>
              No changes recorded yet.
            </span>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {task.history?.map((h) => (
              <div className="hist" key={h.id}>
                <span className="hist__when">{formatWhen(h.at)}</span>
                <span className="hist__text">{h.text}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="detail__danger">
          <button
            className={`btn btn-danger${armed ? ' btn-danger--armed' : ''}`}
            onClick={() => (armed ? onDelete(task) : setArmed(true))}
            onBlur={() => setArmed(false)}
          >
            {armed ? 'Delete for good' : 'Delete task'}
          </button>
          <span
            className={`detail__danger-hint${armed ? ' detail__danger-hint--on' : ''}`}
            aria-live="polite"
          >
            {armed ? 'This cannot be undone.' : ''}
          </span>
        </div>

        <span className="vh">{column?.name}</span>
      </div>
    </aside>
  )
}
