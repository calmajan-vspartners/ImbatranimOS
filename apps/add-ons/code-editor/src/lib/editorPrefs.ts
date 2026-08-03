import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const FONT_SIZES = [11, 12, 13, 14, 16, 18] as const

export type EditorPrefs = {
  minimap: boolean
  wordWrap: boolean
  fontSize: number
  formatOnSave: boolean
}

type EditorPrefsStore = EditorPrefs & {
  set: <K extends keyof EditorPrefs>(key: K, value: EditorPrefs[K]) => void
}

/**
 * Editor preferences, shared by every Code Editor window and remembered
 * across sessions.
 *
 * Two defaults are deliberate rather than inherited from VS Code:
 *
 * - **minimap off.** The OS's windows are frequently 520-900px wide; a minimap
 *   eats ~10% of that to show a thumbnail nobody reads at that size.
 * - **format-on-save off.** A formatter that rewrites a file the user only
 *   meant to save is a worse failure than no formatter at all — especially
 *   here, where the file may be a real config the container is running from.
 *   Opt in and it is a feature; default on and it is a surprise.
 *
 * These live in localStorage rather than the container because they are a
 * per-browser display preference, the same class as the theme. When brief 49
 * lands durable dotfiles this moves there rather than growing a second store.
 */
export const useEditorPrefs = create<EditorPrefsStore>()(
  persist(
    (set) => ({
      minimap: false,
      wordWrap: false,
      fontSize: 13,
      formatOnSave: false,
      set: (key, value) => set({ [key]: value } as Partial<EditorPrefs>),
    }),
    { name: 'imbatranimos:code-editor:prefs' }
  )
)
