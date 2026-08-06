/**
 * The editor context — carries the PART B {@link EditorController}. Kept in its
 * own module (like the reader's context.ts) so fast-refresh stays happy.
 */
import { createContext, useContext } from 'react'
import type { EditorController } from './types'

/** A no-op default so a stray consumer outside the provider never throws. */
const NOOP: EditorController = {
  tool: 'select',
  setTool: () => {},
  color: { r: 0.95, g: 0.72, b: 0.2 },
  setColor: () => {},
  opacity: 1,
  setOpacity: () => {},
  strokeWidth: 2,
  setStrokeWidth: () => {},
  signMark: null,
  setSignMark: () => {},
  signDialogOpen: false,
  openSignDialog: () => {},
  openSignDialogForField: () => {},
  closeSignDialog: () => {},
  applySignatureMark: () => {},
  selectedId: null,
  setSelectedId: () => {},
  addAnnotation: () => '',
  deleteAnnotation: async () => {},
  addedIds: new Set<string>(),
  syncRaster: async () => {},
  saveToDisk: async () => {},
  busy: false,
}

export const EditorContext = createContext<EditorController>(NOOP)

/** Access the PART B editor controller. */
export function useEditor(): EditorController {
  return useContext(EditorContext)
}
