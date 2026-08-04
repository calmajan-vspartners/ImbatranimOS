import { create } from 'zustand'
import type { NotepadRoot } from '../lib/notepadRoot'

/** What a Notepad window has open: a root AND a path, never a bare path. */
export type OpenDoc = { root: NotepadRoot; path: string }

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
