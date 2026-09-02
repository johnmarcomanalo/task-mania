import { useEffect, useState } from 'react'
import type { Board, Priority, ScanResult, ScanRow } from '../types'
import { PRIORITIES, PRIORITY_LABEL, pickable } from '../types'

interface Props {
  board: Board
  previewUrl: string
  result: ScanResult | null
  busy: boolean
  submitting: boolean
  /** True while the enlarged image is open: Escape belongs to it, not to us. */
  lightboxOpen: boolean
  onCancel: () => void
  onConfirm: (source: string, rows: ScanRow[]) => void
  onView: (file: { name: string; url: string; meta: string }) => void
}

let seq = 0
const nextKey = () => `r${++seq}`

function blankRow(columnKey: string): ScanRow {
  return {
    key: nextKey(),
    include: true,
    title: '',
    sender: '',
    due: '',
    priority: 'normal',
    column_key: columnKey,
    quote: '',
    attachments: '',
    tags: [],
    confidence: 'manual',
  }
}

export function ScanReview({
  board, previewUrl, result, busy, submitting, lightboxOpen, onCancel, onConfirm, onView,
}: Props) {
  const firstColumn = board.columns[0]?.key ?? 'inbox'
  const [rows, setRows] = useState<ScanRow[]>([])
  const [source, setSource] = useState('Viber')

  useEffect(() => {
    if (!result) return
    setSource(result.source)
    const mapped = result.rows.map((r) => ({ ...r, key: nextKey(), include: true }))
    setRows(mapped.length ? mapped : [blankRow(firstColumn)])
  }, [result])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // While the enlarged image is open it owns Escape, so one press closes
      // the image rather than the whole panel of typing.
      if (e.key === 'Escape' && !submitting && !lightboxOpen) onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel, submitting, lightboxOpen])

  function patch(key: string, next: Partial<ScanRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...next } : r)))
  }

  const picked = rows.filter((r) => r.include && r.title.trim())

  const manual = result?.manual === true

  const status = busy
    ? (board.scan_enabled ? 'Reading…' : 'Saving…')
    : manual
      ? 'Screenshot saved — add the details'
      : result?.error
        ? 'Could not read the image'
        : `${rows.length} ${rows.length === 1 ? 'task' : 'tasks'} found`

  return (
    <div className="review" role="dialog" aria-modal="true" aria-label="Screenshot review">
      <div className="dialog review__panel">
        <header className="review__head">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 500, fontSize: 14 }}>
              {manual ? 'New task from screenshot' : 'Screenshot review'}
            </span>
            <span style={{ fontSize: '10.5px', color: 'var(--color-neutral-500)' }}>{status}</span>
          </div>
          <span style={{ flex: 1 }} />
          <button
            className="btn btn-ghost"
            onClick={onCancel}
            aria-label="Close review"
            style={{ minHeight: 24, padding: '0 9px', fontSize: 14, lineHeight: 1 }}
          >
            ×
          </button>
        </header>

        <div className="review__split">
          <div className="review__aside">
            <button
              type="button"
              className="review__img"
              onClick={() => onView({ name: 'Screenshot', url: previewUrl, meta: 'Click outside or press Escape to close' })}
              title="Click to enlarge"
              aria-label="Enlarge the screenshot"
            >
              <img src={previewUrl} alt="The screenshot this task came from" />
              <span className="review__zoom">Click to enlarge</span>
            </button>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <span className="detail__sub">{manual ? 'Source' : 'Detected source'}</span>
              <div className="chips">
                {/* Archived sources drop out here: a new task never starts on one. */}
                {pickable(board.sources).map((s) => (
                  <button
                    key={s.id}
                    className="chip"
                    aria-pressed={source === s.name}
                    onClick={() => setSource(s.name)}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="review__rows">
            {busy && (
              <div className="review__busy">
                <div className="review__busy-text">
                  {board.scan_enabled ? 'Reading the screenshot…' : 'Saving the screenshot…'}
                </div>
                <div className="review__scanline" />
                <p className="review__hint">
                  {board.scan_enabled
                    ? 'Looking for: task, sender, deadline, urgency, quote, attachments, and the right column.'
                    : 'It will stay attached to every task you make from it.'}
                </p>
              </div>
            )}

            {result?.error && <p className="review__error">{result.error}</p>}

            {rows.map((r, i) => (
              <div className={'review__row' + (r.include ? '' : ' review__row--off')} key={r.key}>
                <div className="review__rowhead">
                  <input
                    type="checkbox"
                    className="review__check"
                    checked={r.include}
                    aria-label={`Include task ${i + 1}`}
                    onChange={(e) => patch(r.key, { include: e.target.checked })}
                  />
                  <span className="detail__sub">Task {i + 1}</span>
                  <span style={{ flex: 1 }} />
                  <span className={'review__conf' + (r.confidence === 'high' ? ' review__conf--high' : '')}>
                    {r.confidence}
                  </span>
                </div>

                <input
                  className="input"
                  type="text"
                  value={r.title}
                  placeholder="Task title"
                  aria-label={`Title for task ${i + 1}`}
                  onChange={(e) => patch(r.key, { title: e.target.value })}
                  style={{ fontSize: '12.5px', minHeight: 30 }}
                />

                <div className="review__grid">
                  <label className="field" style={{ gap: 3 }}>
                    <span className="detail__sub">Sender</span>
                    <input
                      className="input"
                      type="text"
                      value={r.sender}
                      onChange={(e) => patch(r.key, { sender: e.target.value })}
                      style={{ fontSize: 12, minHeight: 28 }}
                    />
                  </label>

                  <label className="field" style={{ gap: 3 }}>
                    <span className="detail__sub">Due</span>
                    <input
                      className="input"
                      type="date"
                      value={r.due}
                      onChange={(e) => patch(r.key, { due: e.target.value })}
                      style={{ fontSize: 12, minHeight: 28 }}
                    />
                  </label>

                  <label className="field" style={{ gap: 3 }}>
                    <span className="detail__sub">Priority</span>
                    <select
                      className="input"
                      value={r.priority}
                      onChange={(e) => patch(r.key, { priority: e.target.value as Priority })}
                      style={{ fontSize: 12, minHeight: 28 }}
                    >
                      {PRIORITIES.map((p) => (
                        <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
                      ))}
                    </select>
                  </label>

                  <label className="field" style={{ gap: 3 }}>
                    <span className="detail__sub">Column</span>
                    <select
                      className="input"
                      value={r.column_key}
                      onChange={(e) => patch(r.key, { column_key: e.target.value })}
                      style={{ fontSize: 12, minHeight: 28 }}
                    >
                      {board.columns.map((c) => (
                        <option key={c.key} value={c.key}>{c.name}</option>
                      ))}
                    </select>
                  </label>
                </div>

                {r.quote && <p className="review__quote">{r.quote}</p>}
                {r.attachments && (
                  <p style={{ fontSize: '10.5px', color: 'var(--color-neutral-500)' }}>
                    Attachment: {r.attachments}
                  </p>
                )}
              </div>
            ))}

            {!busy && rows.length === 0 && (
              <p className="review__hint">
                No tasks found in this screenshot. You can add one manually below.
              </p>
            )}

            {!busy && (
              <button
                className="btn btn-ghost"
                onClick={() => setRows((rs) => [...rs, blankRow(firstColumn)])}
                style={{ fontSize: 11, minHeight: 26, alignSelf: 'flex-start' }}
              >
                + Another task from this screenshot
              </button>
            )}
          </div>
        </div>

        <footer className="review__foot">
          <span style={{ fontSize: '10.5px', color: 'var(--color-neutral-500)' }}>
            The screenshot is kept with every task made from it.
          </span>
          <span style={{ flex: 1 }} />
          <button
            className="btn btn-ghost"
            onClick={onCancel}
            disabled={submitting}
            style={{ fontSize: 12, minHeight: 28 }}
          >
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => onConfirm(source, picked)}
            disabled={busy || submitting || picked.length === 0}
            style={{ fontSize: 12, minHeight: 28 }}
          >
            {submitting
              ? 'Adding…'
              : picked.length
                ? `Add ${picked.length} ${picked.length === 1 ? 'task' : 'tasks'}`
                : 'Add tasks'}
          </button>
        </footer>
      </div>
    </div>
  )
}
