import { useCallback, useEffect, useRef, useState } from 'react'
import dayjs from 'dayjs'
import { ArrowLeft, Monitor, Palette, Plus, Search, Trash2, X } from 'lucide-react'
import { Button, ScrollArea, cn, useConfirm } from '@imbatranim/core'
import {
  useCreateStickyNoteMutation,
  useDeleteStickyNoteMutation,
  useStickyNotesQuery,
  useUpdateStickyNoteMutation,
} from './queries/stickyNotesQueries'
import { useStickyNoteEditorStore } from './stickyNoteEditorStore'
import { COLOR_OPTIONS, COLOR_SWATCH, notePreview } from './noteStyle'
import type { NoteColor, StickyNote } from './types'

// Debounce before persisting an edit, and how long the "Saved" flash lingers.
const SAVE_DEBOUNCE_MS = 800
const SAVED_FLASH_MS = 1500

/**
 * The manager window.
 *
 * Brief 74 made this the *manager*, not the only surface: notes live on the desktop
 * (see `DesktopNotes.tsx`), and this is where you search them, place them, and edit
 * the ones you have not placed.
 *
 * It also pays the style debt `ui-conventions.md` §45 recorded — this file was named
 * there as "NOT a template" — so it is worth listing what changed: rows are real
 * `<button>`s (they were `<div onClick>`, unreachable from a keyboard), the row
 * controls are ghost `Button`s from the kit, `ScrollArea` replaced a raw
 * `overflow-y-auto`, and every failure path notifies instead of calling
 * `console.error`.
 *
 * One thing the brief suspected and the code did not have: clicking delete did
 * **not** also open the note — `stopPropagation` was already there. Verified, and
 * now moot anyway, because the controls are siblings of the row button rather than
 * nested inside it.
 */

// ---------------------------------------------------------------------------
// Editor view
// ---------------------------------------------------------------------------
function NoteEditor({ noteId, windowId }: { noteId: number; windowId: string }) {
  const { data: notes } = useStickyNotesQuery()
  const note = notes?.find((n) => n.id === noteId)
  const update = useUpdateStickyNoteMutation()
  const clearEditor = useStickyNoteEditorStore((s) => s.clearEditor)

  const [content, setContent] = useState(note?.content ?? '')
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync content when the note (re)loads from the query — state adjustment
  // during render instead of an effect (react.dev/you-might-not-need-an-effect)
  const [prevNoteId, setPrevNoteId] = useState(note?.id)
  if (note && note.id !== prevNoteId) {
    setPrevNoteId(note.id)
    setContent(note.content)
  }

  const handleChange = useCallback(
    (value: string) => {
      setContent(value)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        update.mutate(
          { id: noteId, patch: { content: value } },
          {
            onSuccess: () => {
              setSavedAt(Date.now())
              setTimeout(() => setSavedAt(null), SAVED_FLASH_MS)
            },
          }
        )
      }, SAVE_DEBOUNCE_MS)
    },
    [noteId, update]
  )

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const showSaved = savedAt !== null

  return (
    <div className="bg-surface-container-lowest flex h-full flex-col">
      <div className="border-outline-variant flex shrink-0 flex-wrap items-center justify-between gap-1 border-b px-2 py-1">
        <Button variant="ghost" size="sm" className="gap-1" onClick={() => clearEditor(windowId)}>
          <ArrowLeft size={12} strokeWidth={2} />
          <span>Back</span>
        </Button>
        <div className="flex items-center gap-1">
          <span
            className={cn(
              'font-ui text-on-surface-variant text-[11px] transition-opacity duration-300',
              showSaved ? 'opacity-100' : 'opacity-0'
            )}
          >
            Saved
          </span>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Change colour"
            aria-pressed={paletteOpen}
            title="Change colour"
            onClick={() => setPaletteOpen((open) => !open)}
          >
            <Palette size={12} strokeWidth={2} />
          </Button>
          {note && (
            <Button
              variant={note.onDesktop ? 'default' : 'ghost'}
              size="sm"
              className="gap-1"
              title={note.onDesktop ? 'Take off the desktop' : 'Put this note on the desktop'}
              onClick={() => update.mutate({ id: note.id, patch: { onDesktop: !note.onDesktop } })}
            >
              <Monitor size={12} strokeWidth={2} />
              {note.onDesktop ? 'On desktop' : 'To desktop'}
            </Button>
          )}
        </div>
      </div>

      {paletteOpen && note && (
        <ColorRow
          value={note.color}
          onPick={(color) => {
            update.mutate({ id: note.id, patch: { color } })
            setPaletteOpen(false)
          }}
        />
      )}

      <textarea
        className="font-content text-on-surface placeholder:text-on-surface-variant flex-1 resize-none bg-transparent p-3 text-[14px] outline-none"
        value={content}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Start typing…"
        spellCheck={false}
      />
    </div>
  )
}

function ColorRow({
  value,
  onPick,
}: {
  value: NoteColor | null
  onPick: (color: NoteColor | null) => void
}) {
  return (
    <div className="border-outline-variant flex shrink-0 items-center gap-1.5 border-b px-2 py-1.5">
      <span className="font-ui text-on-surface-variant text-[10px] tracking-wider uppercase">
        Colour
      </span>
      <button
        type="button"
        onClick={() => onPick(null)}
        aria-label="Default colour"
        className={cn(
          'bg-surface-container h-4 w-4 border',
          value === null ? 'border-on-surface' : 'border-outline-variant'
        )}
      />
      {COLOR_OPTIONS.map((color) => (
        <button
          key={color}
          type="button"
          onClick={() => onPick(color)}
          aria-label={color}
          className={cn(
            'h-4 w-4 border',
            COLOR_SWATCH[color],
            value === color ? 'border-on-surface' : 'border-outline-variant'
          )}
        />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// List / manager view
// ---------------------------------------------------------------------------
function NoteList({ windowId }: { windowId: string }) {
  const { data: notes, isPending } = useStickyNotesQuery()
  const create = useCreateStickyNoteMutation()
  const update = useUpdateStickyNoteMutation()
  const remove = useDeleteStickyNoteMutation()
  const setEditor = useStickyNoteEditorStore((s) => s.setEditor)
  const { confirm, confirmDialog } = useConfirm()
  const [query, setQuery] = useState('')

  async function handleDelete(note: StickyNote) {
    const ok = await confirm({
      title: 'Delete note',
      message: `Delete “${notePreview(note.content)}”? This cannot be undone.`,
      destructive: true,
    })
    if (ok) remove.mutate(note.id)
  }

  function handleNewNote() {
    // Failures surface through the mutation's notify, not a console.error nobody
    // reads — that was this app's only failure signal before brief 74.
    create.mutate({}, { onSuccess: (note) => setEditor(windowId, note.id) })
  }

  const all = notes ?? []
  const needle = query.trim().toLowerCase()
  const visible = needle === '' ? all : all.filter((n) => n.content.toLowerCase().includes(needle))
  const placedCount = all.filter((n) => n.onDesktop).length

  return (
    <div className="bg-surface-container-lowest flex h-full flex-col">
      <div className="border-outline-variant flex shrink-0 flex-wrap items-center gap-1.5 border-b px-2 py-1.5">
        <Button variant="primary" size="sm" className="gap-1" onClick={handleNewNote}>
          <Plus size={12} strokeWidth={2} />
          New note
        </Button>
        <div className="border-outline-variant bg-surface-container-lowest flex min-w-0 flex-1 items-center gap-1 border px-1.5">
          <Search size={11} className="text-on-surface-variant shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('')
            }}
            placeholder="Search notes…"
            aria-label="Search notes"
            className="font-content text-on-surface placeholder:text-on-surface-variant min-w-0 flex-1 bg-transparent py-1 text-[12px] outline-none"
          />
          {query !== '' && (
            <Button
              variant="ghost"
              size="sm"
              aria-label="Clear search"
              onClick={() => setQuery('')}
            >
              <X size={11} />
            </Button>
          )}
        </div>
      </div>

      {isPending ? (
        <div className="font-ui text-on-surface-variant flex flex-1 items-center justify-center text-[12px]">
          Loading…
        </div>
      ) : visible.length === 0 ? (
        <div className="font-ui text-on-surface-variant flex flex-1 items-center justify-center px-6 text-center text-[12px]">
          {needle === '' ? 'No sticky notes yet' : `Nothing matches “${query.trim()}”`}
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          {visible.map((note) => (
            <NoteRow
              key={note.id}
              note={note}
              onOpen={() => setEditor(windowId, note.id)}
              onToggleDesktop={() =>
                update.mutate({ id: note.id, patch: { onDesktop: !note.onDesktop } })
              }
              onDelete={() => void handleDelete(note)}
            />
          ))}
        </ScrollArea>
      )}

      <div className="border-outline-variant bg-surface-container-low text-on-surface-variant flex h-5 shrink-0 items-center gap-1 border-t px-2 text-[10px]">
        {all.length} note{all.length === 1 ? '' : 's'} · {placedCount} on the desktop
      </div>
      {confirmDialog}
    </div>
  )
}

function NoteRow({
  note,
  onOpen,
  onToggleDesktop,
  onDelete,
}: {
  note: StickyNote
  onOpen: () => void
  onToggleDesktop: () => void
  onDelete: () => void
}) {
  const date = dayjs(note.createdAt).format('MMM D, YYYY')

  return (
    <div className="group border-outline-variant flex items-center gap-1 border-b pr-1">
      {/*
        A real button, not a `<div onClick>`: the old row could not be reached from
        the keyboard at all, which is the accessibility floor (§35). The controls are
        SIBLINGS of it rather than nested inside, so there is no propagation to stop
        and no way for Delete to also open the note.
      */}
      <button
        type="button"
        onClick={onOpen}
        className="hover:bg-surface-container-low focus-visible:ring-primary flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left focus-visible:ring-2 focus-visible:outline-none"
      >
        <span
          aria-hidden="true"
          className={cn(
            'h-6 w-1 shrink-0',
            note.color ? COLOR_SWATCH[note.color] : 'bg-outline-variant'
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="font-content text-on-surface block truncate text-[13px]">
            {notePreview(note.content)}
          </span>
          <span className="font-ui text-on-surface-variant mt-0.5 block text-[11px]">
            {date}
            {note.onDesktop && ' · on the desktop'}
          </span>
        </span>
      </button>

      <Button
        variant="ghost"
        size="sm"
        onClick={onToggleDesktop}
        aria-pressed={note.onDesktop}
        aria-label={note.onDesktop ? 'Take off the desktop' : 'Put on the desktop'}
        title={note.onDesktop ? 'Take off the desktop' : 'Put on the desktop'}
        className={cn(
          'shrink-0',
          note.onDesktop
            ? 'text-primary'
            : 'opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100'
        )}
      >
        <Monitor size={12} strokeWidth={2} />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={onDelete}
        aria-label={`Delete ${notePreview(note.content)}`}
        title="Delete note"
        className="hover:text-error shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
      >
        <Trash2 size={12} strokeWidth={2} />
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Root export
// ---------------------------------------------------------------------------
export function StickyNotes({ windowId }: { windowId: string }) {
  const noteId = useStickyNoteEditorStore((s) => s.editorMap[windowId])

  if (noteId !== undefined) {
    return <NoteEditor noteId={noteId} windowId={windowId} />
  }

  return <NoteList windowId={windowId} />
}
