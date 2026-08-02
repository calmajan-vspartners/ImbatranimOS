import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type IconPosition = {
  x: number
  y: number
  /**
   * True once the user has dragged this icon. Pinned icons keep their exact
   * coordinates forever; auto-placed icons are free to reflow when the viewport
   * changes or the app roster changes. Without this distinction the layout has
   * no way to tell "the user put it here" from "we computed this once at a
   * different window size", which is how stale coordinates ended up colliding
   * with freshly computed ones and icons drew on top of each other.
   */
  pinned?: boolean
}

type DesktopStore = {
  iconPositions: Record<string, IconPosition>
  /** A user drag — pins the icon. */
  updateIconPosition: (appId: string, position: { x: number; y: number }) => void
  /** An auto-layout placement — does not pin, and never overwrites a pin. */
  setAutoPositions: (positions: Record<string, { x: number; y: number }>) => void
}

export const useDesktopStore = create<DesktopStore>()(
  persist(
    (set) => ({
      iconPositions: {},

      updateIconPosition: (appId, position) =>
        set((state) => ({
          iconPositions: {
            ...state.iconPositions,
            [appId]: { ...position, pinned: true },
          },
        })),

      setAutoPositions: (positions) =>
        set((state) => {
          const next = { ...state.iconPositions }
          let changed = false
          for (const [appId, pos] of Object.entries(positions)) {
            const prev = next[appId]
            if (prev?.pinned) continue
            if (prev && prev.x === pos.x && prev.y === pos.y) continue
            next[appId] = { ...pos, pinned: false }
            changed = true
          }
          // Returning the identical state keeps the store from notifying
          // subscribers when the layout has not moved. Without this, a
          // re-render that recomputes the same positions would publish a new
          // object every time.
          return changed ? { iconPositions: next } : state
        }),
    }),
    {
      name: 'desktop-storage',
      version: 1,
      /**
       * v0 stored bare `{x, y}` with no notion of pinning. Those coordinates
       * were produced by the old fixed 8-row layout, not by the user, so they
       * are treated as auto-placed and allowed to reflow — which is what
       * clears the pre-existing overlaps.
       */
      migrate: (persisted, version) => {
        const state = persisted as DesktopStore | undefined
        if (!state || version >= 1) return state as DesktopStore
        const iconPositions: Record<string, IconPosition> = {}
        for (const [appId, pos] of Object.entries(state.iconPositions ?? {})) {
          iconPositions[appId] = { x: pos.x, y: pos.y, pinned: false }
        }
        return { ...state, iconPositions }
      },
    }
  )
)
