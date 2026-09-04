import { useEffect, useRef, useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { Column, Task } from '../types'
import { TaskCard } from './TaskCard'

interface Props {
  column: Column
  tasks: Task[]
  hiddenCount: number
  selectedId: number | null
  onOpen: (task: Task) => void
  onAdd: (columnId: number, title: string) => Promise<void>
  /** Cards shown before the "N more…" toggle. */
  limit?: number
  /** Done/Cancelled lanes only: tasks hidden by the 7-day rule. */
  olderCount?: number
  onShowOlder?: () => void
  showingOlder?: boolean
}

export function Lane({
  column,
  tasks,
  hiddenCount,
  selectedId,
  onOpen,
  onAdd,
  limit = 10,
  olderCount = 0,
  onShowOlder,
  showingOlder = false,
}: Props) {
  const { setNodeRef, isOver } = useDroppable({
    id: `col:${column.id}`,
    data: { type: 'column', column },
  })

  const closed: 'done' | 'cancelled' | null = column.is_done ? 'done' : column.is_cancelled ? 'cancelled' : null

  const [composing, setComposing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const shown = tasks.slice(0, expanded ? undefined : limit)

  useEffect(() => {
    if (composing) inputRef.current?.focus()
  }, [composing])

  async function submit() {
    const title = draft.trim()
    if (!title || saving) return

    setSaving(true)
    try {
      await onAdd(column.id, title)
      setDraft('')
      inputRef.current?.focus()
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="lane" aria-label={column.name}>
      <header className="lane__head">
        <h2 className="lane__name">{column.name}</h2>
        <span className="lane__count">{tasks.length}</span>
        <span className="lane__spacer" />
        <button
          className="btn btn-ghost"
          onClick={() => setComposing(true)}
          aria-label={`Add a task to ${column.name}`}
          style={{ padding: '0 7px', minHeight: 20, fontSize: 13, lineHeight: 1 }}
        >
          +
        </button>
      </header>

      <div ref={setNodeRef} className={'lane__drop' + (isOver ? ' lane__drop--over' : '')}>
        {composing && (
          <div className="composer">
            <textarea
              ref={inputRef}
              className="input"
              placeholder="What needs doing?"
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void submit()
                }
                if (e.key === 'Escape') {
                  setComposing(false)
                  setDraft('')
                }
              }}
              style={{ fontSize: '12.5px', resize: 'none', fontFamily: 'var(--font-body)' }}
            />
            <div className="composer__row">
              <button
                className="btn btn-primary"
                onClick={() => void submit()}
                disabled={!draft.trim() || saving}
                style={{ fontSize: 11, minHeight: 24, padding: '0 8px' }}
              >
                Add
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setComposing(false)
                  setDraft('')
                }}
                style={{ fontSize: 11, minHeight: 24, padding: '0 8px' }}
              >
                Cancel
              </button>
              <span className="composer__hint">⏎ add · esc cancel</span>
            </div>
          </div>
        )}

        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {shown.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              closed={closed}
              selected={selectedId === task.id}
              onOpen={onOpen}
            />
          ))}
        </SortableContext>

        {tasks.length > limit && (
          <button className="btn btn-ghost lane__more" onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Show less' : `${tasks.length - limit} more…`}
          </button>
        )}

        {olderCount > 0 && (
          <button className="btn btn-ghost lane__more" onClick={onShowOlder}>
            {showingOlder ? 'Hide older' : `Show ${olderCount} older`}
          </button>
        )}

        {tasks.length === 0 && !composing && (
          <p className="lane__empty">
            {hiddenCount > 0 ? (
              <>
                {hiddenCount} hidden
                <br />
                by the search or filters.
              </>
            ) : (
              <>
                Nothing here.
                <br />
                Drag or add.
              </>
            )}
          </p>
        )}
      </div>
    </section>
  )
}
