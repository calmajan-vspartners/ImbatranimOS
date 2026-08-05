import { useCallback, useEffect, useRef, useState } from 'react'
import { GripHorizontal, Palette, Trash2, X } from 'lucide-react'
import { cn } from '@imbatranim/core'
import { COLOR_OPTIONS, COLOR_SWATCH, noteColorClass } from './noteStyle'
import { clampNote } from './noteGeometry'
import { usePointerDrag } from './usePointerDrag'
import type { NoteColor, StickyNote, StickyNotePatch } from './types'

/** Debounce before persisting typing, and how long "Saved" lingers. */
const SAVE_DEBOUNCE_MS = 800

type DesktopNoteProps = {
  note: StickyNote
  /** The desktop layer's size, for clamping. */
  bounds: { width: number; height: number }
  onPatch: (id: number, patch: StickyNotePatch) => void
  onDelete: (note: StickyNote) => void
}

/**
 * One note on the desktop.
 *
 * `pointer-events-auto` here is what the layer's `pointer-events-none` wrapper is
 * waiting for: the note takes clicks where it actually is, and everywhere else the
 * wallpaper and the icons still get theirs.
 *
 * Position and size are previewed locally during a gesture and persisted **once on
 * release** — a PATCH per pointer move would be dozens of writes for one drag.
 */
export function DesktopNote({ note, bounds, onPatch, onDelete }: DesktopNoteProps) {
  const [preview, setPreview] = useState<{ x: number; y: number; w: number; h: number } | null>(
    null
  )
  const [content, setContent] = useState(note.content)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Resync when the note changes underneath us (another window edited it) —
  // state adjustment during render rather than an effect, the house idiom.
  const [prevContent, setPrevContent] = useState(note.content)
  if (note.content !== prevContent) {
    setPrevContent(note.content)
    setContent(note.content)
  }

  // Kept inside the desktop: a note dragged past the edge would otherwise be
  // unreachable after a reload, with no way to get it back. See `noteGeometry.ts`.
  const clamp = useCallback(
    (x: number, y: number, w: number, h: number) => clampNote({ x, y, w, h }, bounds),
    [bounds]
  )

  const move = usePointerDrag({
    onMove: ({ dx, dy }) => setPreview(clamp(note.x + dx, note.y + dy, note.width, note.height)),
    onCommit: ({ dx, dy }) => {
      const next = clamp(note.x + dx, note.y + dy, note.width, note.height)
      setPreview(null)
      if (next.x !== note.x || next.y !== note.y) onPatch(note.id, { x: next.x, y: next.y })
    },
  })

  const resize = usePointerDrag({
    onMove: ({ dx, dy }) => setPreview(clamp(note.x, note.y, note.width + dx, note.height + dy)),
    onCommit: ({ dx, dy }) => {
      const next = clamp(note.x, note.y, note.width + dx, note.height + dy)
      setPreview(null)
      if (next.w !== note.width || next.h !== note.height) {
        onPatch(note.id, { width: next.w, height: next.h })
      }
    },
  })

  const handleContent = useCallback(
    (value: string) => {
      setContent(value)
      if (debounce.current) clearTimeout(debounce.current)
      debounce.current = setTimeout(() => {
        onPatch(note.id, { content: value })
      }, SAVE_DEBOUNCE_MS)
    },
    [note.id, onPatch]
  )

  useEffect(
    () => () => {
      if (debounce.current) clearTimeout(debounce.current)
    },
    []
  )

  const box = preview ?? { x: note.x, y: note.y, w: note.width, h: note.height }
  const busy = move.dragging || resize.dragging

  return (
    <div
      className={cn(
        'pointer-events-auto absolute flex flex-col border shadow-sm',
        noteColorClass(note.color),
        busy && 'opacity-90'
      )}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
    >
      {/* Header: the drag handle, and the note's own controls. */}
      <div
        {...move.handlers}
        className={cn(
          'border-outline-variant/50 flex h-6 shrink-0 items-center gap-1 border-b px-1',
          move.dragging ? 'cursor-grabbing' : 'cursor-grab'
        )}
      >
        <GripHorizontal size={12} className="text-on-surface-variant shrink-0" />
        <span className="min-w-0 flex-1" />
        <button
          type="button"
          // The controls sit inside the drag handle, so each one stops the pointer
          // from starting a drag — otherwise clicking Delete would drag the note.
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setPaletteOpen((open) => !open)}
          aria-label="Change colour"
          aria-pressed={paletteOpen}
          title="Change colour"
          className="text-on-surface-variant hover:text-on-surface shrink-0 p-0.5"
        >
          <Palette size={11} />
        </button>
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onPatch(note.id, { onDesktop: false })}
          aria-label="Take off the desktop"
          title="Take off the desktop (the note is kept)"
          className="text-on-surface-variant hover:text-on-surface shrink-0 p-0.5"
        >
          <X size={11} />
        </button>
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onDelete(note)}
          aria-label="Delete note"
          title="Delete note"
          className="text-on-surface-variant hover:text-error shrink-0 p-0.5"
        >
          <Trash2 size={11} />
        </button>
      </div>

      {paletteOpen && (
        <div className="border-outline-variant/50 flex shrink-0 flex-wrap items-center gap-1 border-b px-1 py-1">
          <button
            type="button"
            onClick={() => {
              onPatch(note.id, { color: null })
              setPaletteOpen(false)
            }}
            aria-label="Default colour"
            className={cn(
              'bg-surface-container h-4 w-4 border',
              note.color === null ? 'border-on-surface' : 'border-outline-variant'
            )}
          />
          {COLOR_OPTIONS.map((color: NoteColor) => (
            <button
              key={color}
              type="button"
              onClick={() => {
                onPatch(note.id, { color })
                setPaletteOpen(false)
              }}
              aria-label={color}
              className={cn(
                'h-4 w-4 border',
                COLOR_SWATCH[color],
                note.color === color ? 'border-on-surface' : 'border-outline-variant'
              )}
            />
          ))}
        </div>
      )}

      <textarea
        value={content}
        onChange={(e) => handleContent(e.target.value)}
        placeholder="Write something…"
        spellCheck={false}
        aria-label="Note text"
        className="font-content text-on-surface placeholder:text-on-surface-variant min-h-0 flex-1 resize-none bg-transparent p-1.5 text-[12px] outline-none"
      />

      {/* Resize handle. A corner grip rather than CSS resize, so the new size can
          be clamped and persisted on release. */}
      <div
        {...resize.handlers}
        aria-hidden="true"
        className="absolute right-0 bottom-0 h-3 w-3 cursor-nwse-resize"
        style={{
          ...resize.handlers.style,
          background: 'linear-gradient(135deg, transparent 50%, var(--k-outline-variant) 50%)',
        }}
      />
    </div>
  )
}
