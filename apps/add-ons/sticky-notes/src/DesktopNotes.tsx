import { useEffect, useRef, useState } from 'react'
import { useConfirm } from '@imbatranim/core'
import { DesktopNote } from './DesktopNote'
import {
  useDeleteStickyNoteMutation,
  useStickyNotesQuery,
  useUpdateStickyNoteMutation,
} from './queries/stickyNotesQueries'
import { notePreview } from './noteStyle'

/**
 * The desktop layer — the reason this app exists next to Notepad and Todo.
 *
 * Mounted by core for every enabled app that declares a `desktopLayer` (see the
 * add-on contract), which means it is running whether or not the Sticky Notes
 * window is open. That is the whole point: notes visible without opening an app.
 *
 * Two constraints from the contract, both load-bearing:
 *
 * - The wrapper core provides is `pointer-events-none`, so this component must not
 *   place anything full-bleed and interactive. It renders one absolutely positioned
 *   note per placed note and nothing else — no backdrop, no catcher div — so every
 *   click that is not on a note still reaches the wallpaper or an icon.
 * - Notes stay **below windows** (core renders the layer before `WindowContainer`),
 *   which the brief requires: always-on-top scraps would fight the compositor for
 *   z-order, and the window manager owns that.
 */
export function DesktopNotes() {
  const { data: notes } = useStickyNotesQuery()
  const update = useUpdateStickyNoteMutation()
  const remove = useDeleteStickyNoteMutation()
  const { confirm, confirmDialog } = useConfirm()
  const ref = useRef<HTMLDivElement>(null)
  const [bounds, setBounds] = useState({ width: 0, height: 0 })

  // The layer's own size, for clamping a drag. Measured rather than assumed from
  // the viewport, because the desktop stops above the taskbar.
  useEffect(() => {
    const measure = () => {
      const el = ref.current
      if (el) setBounds({ width: el.clientWidth, height: el.clientHeight })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const placed = (notes ?? []).filter((note) => note.onDesktop)

  return (
    <div ref={ref} className="absolute inset-0">
      {bounds.width > 0 &&
        placed.map((note) => (
          <DesktopNote
            key={note.id}
            note={note}
            bounds={bounds}
            onPatch={(id, patch) => update.mutate({ id, patch })}
            onDelete={async (target) => {
              const ok = await confirm({
                title: 'Delete note',
                message: `Delete “${notePreview(target.content)}”? This cannot be undone.`,
                destructive: true,
              })
              if (ok) remove.mutate(target.id)
            }}
          />
        ))}
      {/* The confirm dialog is a modal, so it needs pointer events back. */}
      <div className="pointer-events-auto">{confirmDialog}</div>
    </div>
  )
}
