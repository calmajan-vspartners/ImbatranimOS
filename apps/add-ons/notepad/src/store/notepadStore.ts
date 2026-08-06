import { create } from 'zustand'
import type { NotepadRoot } from '../lib/notepadRoot'

/** What a Notepad window has open: a root AND a path, never a bare path. */
export type OpenDoc = {
  root: NotepadRoot
  path: string
  /**
   * A brand-new file that does not exist on disk yet ("start a new file"). The
   * editor treats a read miss on this path as an empty draft rather than a 404
   * error screen — the file is created when the user first saves.
   */
  isNew?: boolean
}

type NotepadState = {
  /** windowId -> the open document. */
  editorMap: Record<string, OpenDoc>
  setEditor: (windowId: string, doc: OpenDoc) => void
  clearEditor: (windowId: string) => void
}

/**
 * The map is keyed by windowId and holds `{ root, path }` rather than a bare path.
 *
 * A path alone was ambiguous the moment Notepad stopped being hardwired to the
 * `notes` root: `Documents/todo.txt` exists in both roots, and a window that
 * remembered only the path would read from one and save to the other.
 */
export const useNotepadStore = create<NotepadState>((set) => ({
  editorMap: {},
  setEditor: (windowId, doc) =>
    set((state) => ({
      editorMap: { ...state.editorMap, [windowId]: doc },
    })),
  clearEditor: (windowId) =>
    set((state) => {
      const { [windowId]: _, ...rest } = state.editorMap
      return { editorMap: rest }
    }),
}))
