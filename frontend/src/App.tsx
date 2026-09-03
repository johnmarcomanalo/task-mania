import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'

import { ApiError, api, type BulkRow, type Me, type TaskInput } from './api'
import type { Board, ScanResult, ScanRow, Task, TaskFile, View } from './types'
import { dueMeta, formatWhen, streakInfo } from './lib/dates'
import { Lane } from './components/Lane'
import { TaskCardBody } from './components/TaskCard'
import { DetailPanel } from './components/DetailPanel'
import { ScanReview } from './components/ScanReview'
import { SourceManager } from './components/SourceManager'

import './styles/nocturne.css'
import './styles/app.css'

const VIEWS: { id: View; label: string }[] = [
  { id: 'board', label: 'Board' },
  { id: 'due', label: 'Deadline' },
  { id: 'log', label: 'Log' },
]

/* ---------------- pure board helpers ---------------- */

function locate(tasks: Task[], id: number) {
  const i = tasks.findIndex((t) => t.id === id)
  return i === -1 ? null : { task: tasks[i], index: i }
}

/**
 * Every image off the clipboard arrives called "image.png", so a task with
 * three pasted shots would list the same name three times. Stamp it instead.
 */
function namePaste(file: File): File {
  const ext = (file.type.split('/')[1] ?? 'png').replace('jpeg', 'jpg')
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    + `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`

  return new File([file], `pasted-${stamp}.${ext}`, { type: file.type })
}

function inColumn(tasks: Task[], columnId: number) {
  return tasks.filter((t) => t.column_id === columnId).sort((a, b) => a.position - b.position)
}

/** Move a task into `columnId` at `index`, renumbering both lists densely. */
function withMoved(tasks: Task[], taskId: number, columnId: number, index: number): Task[] {
  const found = locate(tasks, taskId)
  if (!found) return tasks

  const from = found.task.column_id
  const target = inColumn(tasks, columnId).filter((t) => t.id !== taskId)
  target.splice(Math.max(0, Math.min(index, target.length)), 0, { ...found.task, column_id: columnId })

  const source = from === columnId ? [] : inColumn(tasks, from).filter((t) => t.id !== taskId)

  const positions = new Map<number, { column_id: number; position: number }>()
  target.forEach((t, i) => positions.set(t.id, { column_id: columnId, position: i }))
  source.forEach((t, i) => positions.set(t.id, { column_id: from, position: i }))

  return tasks.map((t) => (positions.has(t.id) ? { ...t, ...positions.get(t.id)! } : t))
}

interface Toast {
  id: number
  text: string
  tone: 'info' | 'error'
}

interface Lightbox {
  name: string
  url: string
  meta: string
}

/* ---------------- app ---------------- */

export default function App() {
  const [board, setBoard] = useState<Board | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  // The board slug comes from /me; a ref keeps the callbacks below free of it.
  const slugRef = useRef('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [view, setView] = useState<View>('board')
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<number | null>(null)
  const [draggingId, setDraggingId] = useState<number | null>(null)

  const [toasts, setToasts] = useState<Toast[]>([])
  const [lightbox, setLightbox] = useState<Lightbox | null>(null)
  const [sourcesOpen, setSourcesOpen] = useState(false)

  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  // Screenshot ingestion
  const [fileOver, setFileOver] = useState(false)
  const [scanPreview, setScanPreview] = useState<string | null>(null)
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [scanBusy, setScanBusy] = useState(false)
  const [scanSubmitting, setScanSubmitting] = useState(false)

  const shotRef = useRef<HTMLInputElement>(null)
  const snapshot = useRef<Task[] | null>(null)
  const toastSeq = useRef(0)

  const notify = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    const id = ++toastSeq.current
    setToasts((t) => [...t, { id, text, tone }])
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 6000 : 3000)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const who = await api.me()
      slugRef.current = who.board_slug
      setMe(who)
      setBoard(await api.getBoard(who.board_slug))
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : 'Could not load the board.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /* ---------- screenshot ingestion ---------- */

  const ingest = useCallback(async (file: File) => {
    const url = URL.createObjectURL(file)
    setScanPreview(url)
    setScanResult(null)
    setScanBusy(true)

    try {
      setScanResult(await api.scan(slugRef.current, file))
    } catch (e) {
      setScanResult({
        screenshot: { path: '', url },
        source: 'Manual',
        rows: [],
        error: e instanceof ApiError ? e.message : 'The image could not be scanned.',
      })
    } finally {
      setScanBusy(false)
    }
  }, [])

  // The enlarged image is the topmost layer, so Escape closes it first — the
  // panels underneath stand down while it is open.
  useEffect(() => {
    if (!lightbox) return

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setLightbox(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [lightbox])

  // Paste an image: onto an open task it becomes an attachment, otherwise it
  // starts a scan. With a task open, "Add from screenshot" is still the way to
  // read a new one, so nothing is out of reach.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      // A paste while the review is open would restart the scan and throw away
      // whatever has been typed into it.
      if (scanPreview) return

      for (const item of Array.from(e.clipboardData?.items ?? [])) {
        if (item.type.startsWith('image')) {
          const f = item.getAsFile()
          if (f) {
            e.preventDefault()
            // Read the open task off the board rather than the memo below it,
            // which this effect runs above.
            const open = board?.tasks.find((t) => t.id === openId) ?? null
            if (open) void attach(open, [namePaste(f)])
            else void ingest(f)
          }
          return
        }
      }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [ingest, board, openId, scanPreview])

  // Drag an image onto the window to scan it.
  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')

    function enter(e: DragEvent) {
      if (!hasFiles(e)) return
      depth++
      setFileOver(true)
    }
    function leave(e: DragEvent) {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setFileOver(false)
    }
    function over(e: DragEvent) {
      if (hasFiles(e)) e.preventDefault()
    }
    function drop(e: DragEvent) {
      if (!hasFiles(e)) return
      depth = 0
      setFileOver(false)
      // The detail panel's own dropzone handles attachment drops.
      if ((e.target as HTMLElement)?.closest?.('.dropzone')) return
      e.preventDefault()
      const image = Array.from(e.dataTransfer?.files ?? []).find((f) => f.type.startsWith('image'))
      if (image) void ingest(image)
    }

    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [ingest])

  async function confirmScan(source: string, rows: ScanRow[]) {
    if (!board) return
    setScanSubmitting(true)

    const byKey = new Map(board.columns.map((c) => [c.key, c.id]))
    const payload: BulkRow[] = rows.map((r) => ({
      column_id: byKey.get(r.column_key) ?? board.columns[0].id,
      title: r.title.trim(),
      sender: r.sender || null,
      due: r.due || null,
      priority: r.priority,
      quote: r.quote || null,
      attachments: r.attachments || null,
      tags: r.tags,
    }))

    try {
      await api.bulkCreate(slugRef.current, {
        screenshot_path: scanResult?.screenshot.path || null,
        source,
        tasks: payload,
      })
      closeScan()
      notify(`Added ${payload.length} ${payload.length === 1 ? 'task' : 'tasks'} from the screenshot.`)
      await load()
    } catch (e) {
      notify(e instanceof ApiError ? e.message : 'Could not add those tasks.', 'error')
    } finally {
      setScanSubmitting(false)
    }
  }

  function closeScan() {
    if (scanPreview) URL.revokeObjectURL(scanPreview)
    setScanPreview(null)
    setScanResult(null)
    setScanBusy(false)
  }

  /* ---------- derived ---------- */

  const tasks = board?.tasks ?? []

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return tasks
    return tasks.filter((t) =>
      [t.title, t.sender ?? '', t.source, t.quote, t.tags.join(' ')]
        .join(' ')
        .toLowerCase()
        .includes(q),
    )
  }, [tasks, query])

  const streak = useMemo(() => streakInfo(tasks), [tasks])
  const openTask = useMemo(() => tasks.find((t) => t.id === openId) ?? null, [tasks, openId])
  const activeTask = useMemo(() => tasks.find((t) => t.id === draggingId) ?? null, [tasks, draggingId])

  const openCount = tasks.filter((t) => !t.done_on).length
  const maxWeek = Math.max(1, ...streak.week.map((w) => w.count))

  const dueRows = useMemo(
    () =>
      visible
        .filter((t) => t.due && !t.done_on)
        .sort((a, b) => a.due.localeCompare(b.due)),
    [visible],
  )

  /* ---------- drag and drop ---------- */

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] },
    }),
  )

  function columnIdFromOver(overId: string | number): number | null {
    if (typeof overId === 'string') {
      return overId.startsWith('col:') ? Number(overId.slice(4)) : null
    }
    return tasks.find((t) => t.id === overId)?.column_id ?? null
  }

  function onDragStart(e: DragStartEvent) {
    snapshot.current = tasks
    setDraggingId(e.active.id as number)
  }

  function onDragOver(e: DragOverEvent) {
    const { active, over } = e
    if (!over || !board) return

    const id = active.id as number
    const dest = columnIdFromOver(over.id)
    const current = tasks.find((t) => t.id === id)
    if (dest == null || !current || current.column_id === dest) return

    const list = inColumn(tasks, dest)
    const index = typeof over.id === 'number'
      ? Math.max(0, list.findIndex((t) => t.id === over.id))
      : list.length

    setBoard({ ...board, tasks: withMoved(tasks, id, dest, index) })
  }

  async function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    setDraggingId(null)
    if (!board) return

    const restore = () => {
      if (snapshot.current) setBoard((b) => (b ? { ...b, tasks: snapshot.current! } : b))
    }

    if (!over) {
      restore()
      return
    }

    const id = active.id as number
    const current = tasks.find((t) => t.id === id)
    if (!current) return

    const columnId = current.column_id
    let next = tasks
    let index = inColumn(tasks, columnId).findIndex((t) => t.id === id)

    if (typeof over.id === 'number' && over.id !== id) {
      const overTask = tasks.find((t) => t.id === over.id)
      if (overTask && overTask.column_id === columnId) {
        index = inColumn(tasks, columnId).filter((t) => t.id !== id).findIndex((t) => t.id === over.id)
        if (index < 0) index = 0
        next = withMoved(tasks, id, columnId, index)
      }
    }

    setBoard({ ...board, tasks: next })

    try {
      await api.moveTask(id, { column_id: columnId, position: Math.max(0, index) })
      await refreshQuiet()
    } catch (err) {
      restore()
      notify(err instanceof ApiError ? err.message : 'Could not move that task.', 'error')
    }
  }

  /** Re-read the board without the loading state, to pick up server-side notes. */
  const refreshQuiet = useCallback(async () => {
    try {
      setBoard(await api.getBoard(slugRef.current))
    } catch {
      /* a failed background refresh is not worth interrupting the user */
    }
  }, [])

  /* ---------- mutations ---------- */

  async function addTask(columnId: number, title: string) {
    try {
      await api.createTask(slugRef.current, { column_id: columnId, title })
      await refreshQuiet()
    } catch (e) {
      notify(e instanceof ApiError ? e.message : 'Could not add that task.', 'error')
      throw e
    }
  }

  async function quickAdd() {
    if (!board) return
    try {
      const task = await api.createTask(slugRef.current, {
        column_id: board.columns[0].id,
        title: 'New task',
        source: 'Manual',
      })
      await refreshQuiet()
      setView('board')
      setOpenId(task.id)
    } catch (e) {
      notify(e instanceof ApiError ? e.message : 'Could not add that task.', 'error')
    }
  }

  async function patchTask(id: number, body: TaskInput) {
    setSaving(true)
    // Show the change immediately; the refresh below reconciles.
    setBoard((b) =>
      b ? { ...b, tasks: b.tasks.map((t) => (t.id === id ? { ...t, ...normalize(body, t) } : t)) } : b,
    )

    try {
      await api.updateTask(id, body)
      await refreshQuiet()
      setSavedAt(Date.now())
    } catch (e) {
      await refreshQuiet()
      notify(e instanceof ApiError ? e.message : 'Could not save that change.', 'error')
    } finally {
      setSaving(false)
    }
  }

  /** Map an API patch onto the local task shape for the optimistic update. */
  function normalize(body: TaskInput, task: Task): Partial<Task> {
    const out: Partial<Task> = {}
    if (body.title !== undefined) out.title = body.title
    if (body.source !== undefined) out.source = body.source
    if (body.sender !== undefined) out.sender = body.sender
    if (body.due !== undefined) out.due = body.due ?? ''
    if (body.priority !== undefined) out.priority = body.priority
    if (body.quote !== undefined) out.quote = body.quote ?? ''
    if (body.attachments !== undefined) out.attachments = body.attachments ?? ''
    if (body.tags !== undefined) out.tags = body.tags
    if (body.column_id !== undefined) {
      out.column_id = body.column_id
      out.column_key = board?.columns.find((c) => c.id === body.column_id)?.key ?? task.column_key
    }
    return out
  }

  async function deleteTask(task: Task) {
    setOpenId(null)
    try {
      await api.deleteTask(task.id)
      await refreshQuiet()
      notify('Task deleted.')
    } catch (e) {
      notify(e instanceof ApiError ? e.message : 'Could not delete that task.', 'error')
    }
  }

  async function attach(task: Task, files: File[]) {
    try {
      await api.attach(task.id, files)
      await refreshQuiet()
      notify(`Attached ${files.length} file${files.length === 1 ? '' : 's'}.`)
    } catch (e) {
      notify(e instanceof ApiError ? e.message : 'Could not attach those files.', 'error')
    }
  }

  async function detach(_task: Task, file: TaskFile) {
    try {
      await api.detach(file.id)
      await refreshQuiet()
    } catch (e) {
      notify(e instanceof ApiError ? e.message : 'Could not remove that file.', 'error')
    }
  }

  /* ---------- render ---------- */

  if (loading) return <Skeleton />

  if (loadError || !board) {
    return (
      <div className="app">
        <div style={{ margin: 'auto', textAlign: 'center', padding: 'var(--space-8)' }}>
          <h1 style={{ fontSize: 20 }}>The board did not load</h1>
          <p style={{ color: 'var(--color-neutral-500)', fontSize: 13 }}>{loadError}</p>
          <button className="btn btn-primary" onClick={() => void load()}>Try again</button>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="hdr">
        <div className="hdr__brand">
          <div className="hdr__name">{board.name}</div>
          <div className="hdr__tally">{openCount} open · {tasks.length} total</div>
        </div>

        <div className="streak">
          <div className="streak__stat">
            <span className="streak__n streak__n--accent">{streak.streak}</span>
            <span className="streak__label">day streak</span>
          </div>
          <div className="streak__rule" />
          <div className="streak__stat">
            <span className="streak__n">{streak.doneToday}</span>
            <span className="streak__label">done today</span>
          </div>
          <div className="streak__week">
            {streak.week.map((d) => (
              <div
                key={d.label}
                className={'streak__bar' + (d.count ? '' : ' streak__bar--empty')}
                title={`${d.label}: ${d.count} done`}
                style={{ height: `${Math.max(4, (d.count / maxWeek) * 26)}px` }}
              />
            ))}
          </div>
        </div>

        <div className="views" role="group" aria-label="View">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              className="views__opt"
              aria-pressed={view === v.id}
              onClick={() => setView(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>

        <div className="hdr__search">
          <input
            className="input"
            type="text"
            placeholder="Search tasks, senders, sources…"
            value={query}
            aria-label="Search tasks"
            onChange={(e) => setQuery(e.target.value)}
            style={{ fontSize: 12, minHeight: 30 }}
          />
        </div>

        <div className="hdr__actions">
          {query && <span className="hdr__count">{visible.length} match{visible.length === 1 ? '' : 'es'}</span>}
          <button
            className="btn btn-ghost"
            onClick={() => void quickAdd()}
            style={{ fontSize: 12, minHeight: 30, whiteSpace: 'nowrap' }}
          >
            + Task
          </button>
          <button
            className="btn btn-primary"
            onClick={() => shotRef.current?.click()}
            style={{ fontSize: 12, minHeight: 30, whiteSpace: 'nowrap' }}
          >
            {board.scan_enabled ? "Scan screenshot" : "Add from screenshot"}
          </button>
          <input
            ref={shotRef}
            type="file"
            accept="image/*"
            className="vh"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void ingest(f)
              e.target.value = ''
            }}
          />
          {me?.email && (
            <div className="hdr__user">
              <span className="hdr__user-email" title={me.email}>{me.email}</span>
              <a className="btn btn-ghost" href="/cdn-cgi/access/logout" style={{ fontSize: 12, minHeight: 30 }}>
                Log out
              </a>
            </div>
          )}
        </div>
      </header>

      <div className="main">
        {view === 'board' && (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={(e) => void onDragEnd(e)}
            onDragCancel={() => {
              setDraggingId(null)
              if (snapshot.current) setBoard((b) => (b ? { ...b, tasks: snapshot.current! } : b))
            }}
          >
            <main className="board">
              {board.columns.map((column) => {
                const shown = inColumn(visible, column.id)
                const total = inColumn(tasks, column.id).length
                return (
                  <Lane
                    key={column.id}
                    column={column}
                    tasks={shown}
                    hiddenCount={total - shown.length}
                    selectedId={openId}
                    onOpen={(t) => setOpenId(t.id)}
                    onAdd={addTask}
                  />
                )
              })}
            </main>

            <DragOverlay dropAnimation={{ duration: 160, easing: 'cubic-bezier(0.25, 1, 0.5, 1)' }}>
              {activeTask && (
                <div className="tcard tcard--overlay">
                  <TaskCardBody
                    task={activeTask}
                    done={!!board.columns.find((c) => c.id === activeTask.column_id)?.is_done}
                  />
                </div>
              )}
            </DragOverlay>
          </DndContext>
        )}

        {view === 'due' && (
          <div className="listview">
            <div className="listview__inner" style={{ maxWidth: 720 }}>
              <h1 className="listview__title">By deadline</h1>
              {dueRows.map((t) => {
                const meta = dueMeta(t.due)
                return (
                  <button key={t.id} className="duerow" onClick={() => { setView('board'); setOpenId(t.id) }}>
                    <span className={`duerow__badge duerow__badge--${meta?.tone ?? 'later'}`}>
                      {meta?.badge}
                    </span>
                    <span className="duerow__title">{t.title}</span>
                    <span className="duerow__meta">{t.sender ?? t.source}</span>
                    <span className="duerow__col">
                      {board.columns.find((c) => c.id === t.column_id)?.name}
                    </span>
                  </button>
                )
              })}
              {dueRows.length === 0 && (
                <p style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>
                  No open tasks have a deadline.
                </p>
              )}
            </div>
          </div>
        )}

        {view === 'log' && (
          <div className="listview">
            <div className="listview__inner" style={{ maxWidth: 640 }}>
              <h1 className="listview__title">Activity log</h1>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {board.activity.map((a) => (
                  <div className="logrow" key={a.id}>
                    <span className="logrow__when">{formatWhen(a.at)}</span>
                    <span className="logrow__text">{a.text}</span>
                  </div>
                ))}
              </div>
              {board.activity.length === 0 && (
                <p style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>Nothing recorded yet.</p>
              )}
            </div>
          </div>
        )}

        {openTask && (
          <DetailPanel
            task={openTask}
            board={board}
            saving={saving}
            savedAt={savedAt}
            lightboxOpen={lightbox !== null}
            onClose={() => setOpenId(null)}
            onPatch={(id, body) => void patchTask(id, body)}
            onDelete={(t) => void deleteTask(t)}
            onAttach={(t, files) => void attach(t, files)}
            onDetach={(t, f) => void detach(t, f)}
            onView={setLightbox}
            onManageSources={() => setSourcesOpen(true)}
          />
        )}
      </div>

      {sourcesOpen && (
        <SourceManager
          board={board}
          onClose={() => setSourcesOpen(false)}
          onChanged={() => void refreshQuiet()}
        />
      )}

      {fileOver && (
        <div className="dropveil">
          <div className="dropveil__box">
            <span className="dropveil__title">Drop screenshot</span>
            <span className="dropveil__sub">
              It will be read and turned into tasks — the image stays as the source.
            </span>
          </div>
        </div>
      )}

      {scanPreview && (
        <ScanReview
          board={board}
          previewUrl={scanResult?.screenshot.url ?? scanPreview}
          result={scanResult}
          busy={scanBusy}
          submitting={scanSubmitting}
          lightboxOpen={lightbox !== null}
          onCancel={closeScan}
          onConfirm={(source, rows) => void confirmScan(source, rows)}
          onView={setLightbox}
        />
      )}

      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <div className="lightbox__bar" onClick={(e) => e.stopPropagation()}>
            <span className="lightbox__name">{lightbox.name}</span>
            <span className="lightbox__meta">{lightbox.meta}</span>
            <span style={{ flex: 1 }} />
            <a
              className="btn btn-ghost"
              href={lightbox.url}
              download={lightbox.name}
              style={{ fontSize: '11.5px', minHeight: 26 }}
            >
              Download
            </a>
            <button
              className="btn btn-ghost"
              onClick={() => setLightbox(null)}
              aria-label="Close preview"
              style={{ fontSize: 14, lineHeight: 1, minHeight: 26, padding: '0 9px' }}
            >
              ×
            </button>
          </div>
          <div className="lightbox__img" onClick={(e) => e.stopPropagation()}>
            <img src={lightbox.url} alt={lightbox.name} />
          </div>
        </div>
      )}

      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={'toast' + (t.tone === 'error' ? ' toast--error' : '')}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="app" aria-busy="true" aria-label="Loading board">
      <header className="hdr">
        <div className="skel" style={{ width: 130, height: 16 }} />
        <div className="skel" style={{ width: 210, height: 34, borderRadius: 8 }} />
      </header>
      <main className="board">
        {[3, 2, 2, 1, 1, 3].map((n, i) => (
          <section className="lane" key={i}>
            <div className="lane__head">
              <div className="skel" style={{ width: 74, height: 10 }} />
            </div>
            <div className="lane__drop">
              {Array.from({ length: n }).map((_, j) => (
                <div className="skel" key={j} style={{ height: 74, borderRadius: 8 }} />
              ))}
            </div>
          </section>
        ))}
      </main>
    </div>
  )
}
