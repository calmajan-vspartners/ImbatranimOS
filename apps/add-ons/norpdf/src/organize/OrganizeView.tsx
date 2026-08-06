/**
 * Organize view — the page-grid mode (mounted in NorPdf's `organize` branch).
 * Rotate / delete / reorder (drag) / insert / extract pages (Pages), and
 * merge / split whole documents (Assemble). Every structural edit runs through
 * the editor's `syncRaster` (`doc.save()` + `reloadDocument()`) so the grid, the
 * reader and the thumbnails all reflect the new page order.
 *
 * Split/extract produce NEW documents (downloaded); merge/insert/rotate/delete/
 * reorder mutate the working document in place.
 *
 * KNOWN edge (worked around): pending overlay-only annotations resolve their
 * target page at commit time, so they are flushed to real page objects
 * (`flushPending`) BEFORE any structural op — otherwise a reorder would strand
 * them on the wrong page.
 *
 * Rebuilt in the OS design language: `Button` + lucide icons + Tailwind tokens.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { PdfDoc } from '@pdfcore/engine'
import { Button, Separator, useSystem } from '@imbatranim/ui'
import {
  Plus,
  Combine,
  FileOutput,
  Trash2,
  Scissors,
  RotateCw,
  RotateCcw,
  GripVertical,
} from 'lucide-react'
import { useReader } from '../app/context'
import { useEditor } from '../editor/context'

const CARD_W = 150

const msgOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

function download(bytes: Uint8Array, filename: string): void {
  const buf = bytes.slice().buffer
  const blob = new Blob([buf], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export function OrganizeView(): JSX.Element {
  const system = useSystem()
  const ctrl = useReader()
  const { doc, docName, pageCount, pageDims, renderEpoch, setMode } = ctrl
  const { syncRaster, addedIds, busy } = useEditor()

  const [selected, setSelected] = useState<Set<number>>(new Set()) // 0-based
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  const [everyN, setEveryN] = useState('1')

  const base = (docName || 'document').replace(/\.pdf$/i, '')

  // Drop selections that no longer exist after a structural change — the
  // "adjust state on prop change during render" pattern (not an effect), so the
  // OS lint's set-state-in-effect rule stays satisfied.
  const [lastCount, setLastCount] = useState(pageCount)
  if (pageCount !== lastCount) {
    setLastCount(pageCount)
    setSelected((prev) => {
      const next = new Set([...prev].filter((i) => i < pageCount))
      return next.size === prev.size ? prev : next
    })
  }

  const toggle = useCallback((i: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }, [])

  if (!doc) return <div className="text-on-surface-variant p-4 text-[12px]">No document.</div>

  const selectedPages1 = [...selected].sort((a, b) => a - b).map((i) => i + 1)

  // Bake any pending (overlay-only) annotations into real page objects first, so
  // a structural op moves them with their page (and extract/split include them).
  const flushPending = async () => {
    if (addedIds.size) await syncRaster()
  }

  // Every structural op goes through here. It catches — `syncRaster`/the op can
  // reject (a save or reload failure), and an un-awaited rejection would show
  // nothing at all: the grid would just not change and the user would not know
  // why (M6).
  const run = async (op: () => void | Promise<void>) => {
    try {
      await flushPending()
      await op()
      await syncRaster()
    } catch (err) {
      system.notify({ level: 'error', title: 'Edit failed', body: msgOf(err) })
    }
  }

  const rotate = (index0: number, deg: 90 | -90) =>
    void run(() => doc.pages.rotate(index0 + 1, deg))

  const del = (pages1: number[]) => {
    if (!pages1.length || pages1.length >= pageCount) return
    void run(() => doc.pages.delete(pages1))
  }

  const insertBlank = () => {
    const at = selected.size ? Math.max(...selected) + 1 : pageCount
    void run(() => doc.pages.insert(at, { kind: 'blank' }))
  }

  const onDrop = (target: number) => {
    setDragOver(null)
    const from = dragFrom
    setDragFrom(null)
    if (from == null || from === target) return
    void run(() => doc.pages.reorder(from, target))
  }

  // Merge another PDF's pages. Reads through the OS filesystem (the OS pick
  // portal + fs.read), NOT a native `<input type=file>` — that browses the
  // HOST machine, the exact pattern brief 65 removed from Open. The raw
  // `pickOpen` on purpose (not the SDK `useFileDialog`): this picks a SECOND
  // PDF to merge into the open one, and `useFileDialog` latches every choice
  // into the open-intent store, which would REPLACE the current document
  // instead of merging into it.
  const mergeFromOs = async () => {
    const choice = await system.fs.pickOpen({ title: 'Merge a PDF', extensions: ['pdf'] })
    if (!choice) return
    let bytes: Uint8Array
    try {
      const buf = await system.fs.read(choice.root, choice.path)
      bytes = new Uint8Array(buf)
    } catch (err) {
      system.notify({ level: 'error', title: 'Could not read PDF', body: msgOf(err) })
      return
    }
    await run(() => doc.assemble.merge(bytes))
  }

  const extractSelected = async () => {
    if (!selectedPages1.length) return
    try {
      await flushPending()
      const bytes = await doc.pages.extract(selectedPages1)
      download(bytes, `${base}-extract.pdf`)
    } catch (err) {
      system.notify({ level: 'error', title: 'Extract failed', body: msgOf(err) })
    }
  }

  const splitEvery = async () => {
    const n = parseInt(everyN, 10)
    if (!Number.isInteger(n) || n < 1) return
    try {
      await flushPending()
      const parts = await doc.assemble.split({ every: n })
      parts.forEach((p, i) => download(p, `${base}-part-${i + 1}.pdf`))
    } catch (err) {
      system.notify({ level: 'error', title: 'Split failed', body: msgOf(err) })
    }
  }

  return (
    <div className="bg-surface-container flex h-full min-h-0 flex-col">
      {/* Toolbar */}
      <div className="border-outline-variant bg-surface-container-low flex flex-wrap items-center gap-1.5 border-b px-2 py-1.5">
        <Button
          variant="default"
          size="sm"
          className="flex items-center gap-1"
          onClick={insertBlank}
          disabled={busy}
          title="Insert a blank page"
        >
          <Plus size={15} />
          Insert blank
        </Button>
        <Button
          variant="default"
          size="sm"
          className="flex items-center gap-1"
          onClick={() => void mergeFromOs()}
          disabled={busy}
          title="Append another PDF's pages"
        >
          <Combine size={15} />
          Merge PDF…
        </Button>

        <Separator orientation="vertical" className="mx-1 h-5" />

        <Button
          variant="default"
          size="sm"
          className="flex items-center gap-1"
          onClick={() => void extractSelected()}
          disabled={busy || !selected.size}
          title="Extract the selected pages to a new PDF"
        >
          <FileOutput size={15} />
          Extract {selected.size ? `(${selected.size})` : ''}
        </Button>
        <Button
          variant="destructive"
          size="sm"
          className="flex items-center gap-1"
          onClick={() => del(selectedPages1)}
          disabled={busy || !selected.size || selected.size >= pageCount}
          title="Delete the selected pages"
        >
          <Trash2 size={15} />
          Delete {selected.size ? `(${selected.size})` : ''}
        </Button>

        <Separator orientation="vertical" className="mx-1 h-5" />

        <div className="text-on-surface-variant font-ui flex items-center gap-1 text-[12px]">
          <Scissors size={15} />
          <span>Split every</span>
          <input
            className="border-outline-variant bg-surface-container-lowest text-on-surface focus:border-primary w-10 border px-1 py-0.5 text-center outline-none"
            value={everyN}
            inputMode="numeric"
            onChange={(e) => setEveryN(e.target.value.replace(/[^0-9]/g, ''))}
          />
          <span>page(s)</span>
          <Button variant="default" size="sm" onClick={() => void splitEvery()} disabled={busy}>
            Split
          </Button>
        </div>

        <div className="flex-1" />

        {busy && <span className="text-primary font-ui text-[11px]">Working…</span>}
        <Button variant="primary" size="sm" onClick={() => setMode('read')}>
          Done
        </Button>
      </div>

      {/* Grid */}
      <div
        className="organize__grid grid min-h-0 flex-1 content-start gap-4 overflow-auto p-4"
        style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${CARD_W}px, 1fr))` }}
      >
        {Array.from({ length: pageCount }, (_, i) => {
          const d = pageDims[i] ?? { w: 612, h: 792 }
          return (
            <PageCard
              key={`${i}-${renderEpoch}`}
              doc={doc}
              index0={i}
              aspect={d.h / d.w}
              epoch={renderEpoch}
              selected={selected.has(i)}
              isDragOver={dragOver === i && dragFrom !== i}
              disabled={busy}
              onToggle={() => toggle(i)}
              onRotateCw={() => rotate(i, 90)}
              onRotateCcw={() => rotate(i, -90)}
              onDelete={() => del([i + 1])}
              onDragStart={() => setDragFrom(i)}
              onDragEnter={() => setDragOver(i)}
              onDragEnd={() => {
                setDragFrom(null)
                setDragOver(null)
              }}
              onDropCard={() => onDrop(i)}
            />
          )
        })}
      </div>
    </div>
  )
}

interface PageCardProps {
  doc: PdfDoc
  index0: number
  aspect: number
  epoch: number
  selected: boolean
  isDragOver: boolean
  disabled: boolean
  onToggle: () => void
  onRotateCw: () => void
  onRotateCcw: () => void
  onDelete: () => void
  onDragStart: () => void
  onDragEnter: () => void
  onDragEnd: () => void
  onDropCard: () => void
}

function PageCard({
  doc,
  index0,
  aspect,
  epoch,
  selected,
  isDragOver,
  disabled,
  onToggle,
  onRotateCw,
  onRotateCcw,
  onDelete,
  onDragStart,
  onDragEnter,
  onDragEnd,
  onDropCard,
}: PageCardProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const [seen, setSeen] = useState(false)
  const height = Math.round(CARD_W * aspect)
  const pageNo = index0 + 1

  useEffect(() => {
    const el = hostRef.current
    if (!el || seen) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true)
          io.disconnect()
        }
      },
      { root: el.closest('.organize__grid'), rootMargin: '400px 0px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [seen])

  useEffect(() => {
    if (!seen) return
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false
    ;(async () => {
      try {
        const vp = await doc.render.viewport(pageNo, { scale: 1 })
        if (cancelled) return
        const scale = (CARD_W * (window.devicePixelRatio || 1)) / vp.width
        await doc.render.page(pageNo, canvas, { scale })
      } catch {
        /* leave blank */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [doc, pageNo, seen, epoch])

  return (
    <div
      ref={hostRef}
      className={
        'group flex flex-col border bg-transparent ' +
        (selected ? 'border-primary ' : 'border-transparent ') +
        (isDragOver ? 'ring-primary ring-2' : '')
      }
      draggable={!disabled}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', String(index0))
        onDragStart()
      }}
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        onDropCard()
      }}
      onDragEnd={onDragEnd}
    >
      <div
        className="ring-outline-variant relative mx-auto bg-white shadow-sm ring-1"
        style={{ width: CARD_W, height }}
      >
        {seen ? (
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
        ) : (
          <span className="bg-surface-container-high absolute inset-0 block animate-pulse" />
        )}
        <label
          className="bg-surface/80 absolute top-1 left-1 flex h-5 w-5 items-center justify-center border-none"
          title="Select page"
        >
          <input
            type="checkbox"
            className="accent-primary"
            checked={selected}
            onChange={onToggle}
          />
        </label>
        <span
          className="text-on-surface-variant bg-surface/80 absolute top-1 right-1 cursor-grab p-0.5 opacity-0 group-hover:opacity-100"
          title="Drag to reorder"
        >
          <GripVertical size={15} />
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between px-0.5">
        <span className="text-on-surface-variant text-[11px] tabular-nums">{pageNo}</span>
        <span className="flex items-center gap-0.5">
          <button
            type="button"
            className="text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface p-1 disabled:opacity-40"
            title="Rotate left"
            onClick={onRotateCcw}
            disabled={disabled}
          >
            <RotateCcw size={14} />
          </button>
          <button
            type="button"
            className="text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface p-1 disabled:opacity-40"
            title="Rotate right"
            onClick={onRotateCw}
            disabled={disabled}
          >
            <RotateCw size={14} />
          </button>
          <button
            type="button"
            className="text-on-surface-variant hover:bg-error hover:text-on-error p-1 disabled:opacity-40"
            title="Delete page"
            onClick={onDelete}
            disabled={disabled}
          >
            <Trash2 size={14} />
          </button>
        </span>
      </div>
    </div>
  )
}
