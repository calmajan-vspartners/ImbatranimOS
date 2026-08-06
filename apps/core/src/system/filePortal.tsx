import { create } from 'zustand'
import { Dialog } from '@imbatranim/ui'
import type { FileChoice } from '@imbatranim/ui'
import { FilePicker } from '../shared/components/files/FilePicker'

/**
 * The OS file portal (brief 48) — the xdg-desktop-portal analogue.
 *
 * `system.fs.pickOpen/pickSave/pickDirectory` resolve through here: the app
 * awaits pure data while the OS renders its one Open/Save dialog. The old
 * `useFileDialog` returned a node each app had to remember to place in its
 * tree; seventeen apps carried that line, and any of them forgetting it had a
 * dialog that silently never appeared. The portal owns rendering, so the
 * failure mode is gone and the dialog cannot drift per app.
 *
 * Requests queue: two apps asking at once get the dialog one at a time, which
 * is also what a real portal does.
 */

type PickRequest = {
  id: number
  mode: 'open' | 'save' | 'directory'
  title: string
  extensions?: string[]
  suggestedName?: string
  resolve: (choice: FileChoice | null) => void
}

type PortalStore = {
  queue: PickRequest[]
  push: (req: PickRequest) => void
  /** Resolve the front request and show the next one. */
  settle: (choice: FileChoice | null) => void
}

const usePortalStore = create<PortalStore>((set, get) => ({
  queue: [],
  push: (req) => set((s) => ({ queue: [...s.queue, req] })),
  settle: (choice) => {
    const [head, ...rest] = get().queue
    set({ queue: rest })
    head?.resolve(choice)
  },
}))

let nextId = 1

// The portal's imperative entry lives beside its host by design: one file is
// the whole portal. The fast-refresh rule objects to the mix; accepted.
// eslint-disable-next-line react-refresh/only-export-components
export function requestPick(req: Omit<PickRequest, 'id' | 'resolve'>): Promise<FileChoice | null> {
  return new Promise<FileChoice | null>((resolve) => {
    usePortalStore.getState().push({ ...req, id: nextId++, resolve })
  })
}

/** Mounted once at the desktop root; renders the front of the queue. */
export function FilePortalHost() {
  const head = usePortalStore((s) => s.queue[0])
  const settle = usePortalStore((s) => s.settle)
  if (!head) return null
  return (
    <Dialog
      // Keyed so a queued second request gets a fresh picker, not the first
      // one's browsing state.
      key={head.id}
      open
      onOpenChange={(open) => {
        // Escape or the backdrop resolves null — a cancel, not a hang.
        if (!open) settle(null)
      }}
      title={head.title}
    >
      <FilePicker
        mode={head.mode}
        extensions={head.extensions}
        suggestedName={head.suggestedName}
        onPick={(choice) => settle(choice)}
      />
    </Dialog>
  )
}
