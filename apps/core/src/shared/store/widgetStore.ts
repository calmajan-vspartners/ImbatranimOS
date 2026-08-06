import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Which widgets are on the desktop and where (brief 96). User config in the
 * house key style — a brief-49-shaped pref the dotfiles migration can sweep.
 *
 * Rows for a disabled add-on's widgets are kept (the layer just does not
 * render them), so disabling an app and re-enabling it restores its widgets
 * where they were.
 */
export type PlacedWidget = {
  /** `<appId>:<widgetId>` — the key the registry resolves back to a config. */
  key: string
  x: number
  y: number
}

type WidgetStore = {
  placed: PlacedWidget[]
  add: (key: string, position: { x: number; y: number }) => void
  remove: (key: string) => void
  move: (key: string, x: number, y: number) => void
}

export const useWidgetStore = create<WidgetStore>()(
  persist(
    (set) => ({
      placed: [],
      add: (key, position) =>
        set((s) =>
          s.placed.some((w) => w.key === key) ? s : { placed: [...s.placed, { key, ...position }] }
        ),
      remove: (key) => set((s) => ({ placed: s.placed.filter((w) => w.key !== key) })),
      move: (key, x, y) =>
        set((s) => ({
          placed: s.placed.map((w) => (w.key === key ? { ...w, x, y } : w)),
        })),
    }),
    { name: 'imbatranimos:widgets' }
  )
)
