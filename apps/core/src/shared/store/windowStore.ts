import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'

export type SnapRegion = 'left' | 'right' | 'top' | 'tl' | 'tr' | 'bl' | 'br'

export type WindowInstance = {
  id: string
  appId: string
  title: string
  isVisible: boolean
  isMaximized: boolean
  position: { x: number; y: number }
  size: { width: number; height: number }
  zIndex: number
  snapState?: SnapRegion
}

type PreMaximizeState = {
  position: { x: number; y: number }
  size: { width: number; height: number }
}

// Windows-7-classic layout: chrome lives in a BOTTOM taskbar, so the usable
// desktop starts at y=0 and is bounded below by the taskbar. TOPBAR_HEIGHT is
// kept (=0) for the handful of call sites that still import it.
export const TOPBAR_HEIGHT = 0
export const TASKBAR_HEIGHT = 44

// New windows cascade around the desktop center by a random ± offset so stacked
// opens don't perfectly overlap. Jitter spans [-CASCADE_JITTER_PX, +CASCADE_JITTER_PX].
export const CASCADE_JITTER_PX = 100

/**
 * Fit a window to the usable desktop (the viewport minus the taskbar).
 *
 * A manifest's `defaultSize` is a preference, not a promise: several apps
 * declare heights that cannot fit a short laptop viewport. Because the desktop
 * layer is `overflow-hidden` and windows deliberately do not scroll, anything
 * past the taskbar line is simply unreachable — that is how Calendar's last
 * week row and Calculator's `0 . =` row went missing.
 *
 * `minSize` wins over the clamp: if an app's honest minimum genuinely does not
 * fit, respect it and let it overflow rather than render a squashed, broken
 * layout. That case is the app's bug to fix (an honest `minSize` is required by
 * wiki/ui-conventions.md §20), not something to paper over here.
 *
 * Pure and exported so it can be unit-tested without a DOM, and reused by both
 * the open path and layout restore.
 */
export function clampToDesktop(
  defaultSize: { width: number; height: number },
  minSize: { width: number; height: number },
  viewport: { width: number; height: number }
): { width: number; height: number } {
  const availW = viewport.width
  const availH = viewport.height - TASKBAR_HEIGHT
  return {
    width: Math.max(minSize.width, Math.min(defaultSize.width, availW)),
    height: Math.max(minSize.height, Math.min(defaultSize.height, availH)),
  }
}

// ── Layout persistence ────────────────────────────────────────────────────────

export type PersistedWindow = {
  appId: string
  title: string
  position: { x: number; y: number }
  size: { width: number; height: number }
  isMaximized: boolean
  isVisible: boolean
  zIndex: number
  snapState?: SnapRegion
}

const LAYOUT_STORAGE_KEY = 'imbatranimos:window-layout'

export function saveLayout(windows: WindowInstance[]): void {
  const data: PersistedWindow[] = windows.map((w) => ({
    appId: w.appId,
    title: w.title,
    position: w.position,
    size: w.size,
    isMaximized: w.isMaximized,
    isVisible: w.isVisible,
    zIndex: w.zIndex,
    snapState: w.snapState,
  }))
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(data))
  } catch {
    // quota exceeded or private mode — silently skip
  }
}

export function loadLayout(): PersistedWindow[] {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as PersistedWindow[]
  } catch {
    return []
  }
}

export function clearLayout(): void {
  localStorage.removeItem(LAYOUT_STORAGE_KEY)
}

// ── Snap geometry helpers ─────────────────────────────────────────────────────

export function computeSnapGeometry(region: SnapRegion): {
  position: { x: number; y: number }
  size: { width: number; height: number }
} {
  const W = window.innerWidth
  const H = window.innerHeight - TASKBAR_HEIGHT
  const halfW = Math.floor(W / 2)
  const halfH = Math.floor(H / 2)
  const top = 0

  switch (region) {
    case 'left':
      return { position: { x: 0, y: top }, size: { width: halfW, height: H } }
    case 'right':
      return { position: { x: halfW, y: top }, size: { width: W - halfW, height: H } }
    case 'top':
      return { position: { x: 0, y: top }, size: { width: W, height: H } }
    case 'tl':
      return { position: { x: 0, y: top }, size: { width: halfW, height: halfH } }
    case 'tr':
      return { position: { x: halfW, y: top }, size: { width: W - halfW, height: halfH } }
    case 'bl':
      return { position: { x: 0, y: top + halfH }, size: { width: halfW, height: H - halfH } }
    case 'br':
      return {
        position: { x: halfW, y: top + halfH },
        size: { width: W - halfW, height: H - halfH },
      }
  }
}

// ── Detect snap region from pointer position ──────────────────────────────────

const EDGE_THRESHOLD = 32 // px from edge to trigger snap

export function detectSnapRegion(pointerX: number, pointerY: number): SnapRegion | null {
  const W = window.innerWidth
  const H = window.innerHeight
  const nearLeft = pointerX <= EDGE_THRESHOLD
  const nearRight = pointerX >= W - EDGE_THRESHOLD
  const nearTop = pointerY <= EDGE_THRESHOLD
  const nearBottom = pointerY >= H - TASKBAR_HEIGHT - EDGE_THRESHOLD

  if (nearTop && nearLeft) return 'tl'
  if (nearTop && nearRight) return 'tr'
  if (nearBottom && nearLeft) return 'bl'
  if (nearBottom && nearRight) return 'br'
  if (nearTop) return 'top'
  if (nearLeft) return 'left'
  if (nearRight) return 'right'
  return null
}

// ── Store ─────────────────────────────────────────────────────────────────────

type WindowStore = {
  windows: WindowInstance[]
  preMaximizeStates: Record<string, PreMaximizeState>
  preSnapStates: Record<string, PreMaximizeState>
  // A window may veto its own close (e.g. an editor with unsaved changes). The
  // guard returns true to allow the close, false to abort it. Kept generic — the
  // store never knows *why* a close is vetoed; the window supplies the policy.
  closeGuards: Record<string, () => boolean>
  nextZIndex: number

  openWindow: (
    appId: string,
    title: string,
    defaultSize: { width: number; height: number },
    minSize: { width: number; height: number },
    initialPosition?: { x: number; y: number }
  ) => string
  closeWindow: (id: string) => void
  /** Live-update a window's title bar / taskbar label (e.g. filename + dirty •). */
  updateTitle: (id: string, title: string) => void
  /** Register a veto consulted by closeWindow; returns true to allow the close. */
  registerCloseGuard: (id: string, guard: () => boolean) => void
  unregisterCloseGuard: (id: string) => void
  hideWindow: (id: string) => void
  showWindow: (id: string) => void
  maximizeWindow: (id: string) => void
  restoreWindow: (id: string) => void
  focusWindow: (id: string) => void
  updatePosition: (id: string, position: { x: number; y: number }) => void
  updateSize: (id: string, size: { width: number; height: number }) => void
  getOrderedWindows: () => WindowInstance[]
  snapWindow: (id: string, region: SnapRegion) => void
  unsnap: (id: string) => void
  persistLayout: () => void
  restoreLayout: () => void
}

/**
 * The id of the top-most *visible* window, or null when none is visible.
 * Single source of truth for "which window owns global keyboard focus" —
 * WindowContainer chrome, the taskbar highlight and every window-scoped hotkey
 * must agree on this, so they all read it here rather than each re-deriving it
 * (some over all windows, some over visible ones, which used to disagree when
 * the focused window was minimized).
 */
export function topVisibleWindowId(): string | null {
  const { windows } = useWindowStore.getState()
  let top: WindowInstance | null = null
  for (const w of windows) {
    if (!w.isVisible) continue
    if (!top || w.zIndex > top.zIndex) top = w
  }
  return top?.id ?? null
}

/** True when `windowId` is the top-most visible window (owns global hotkeys). */
export function isTopWindow(windowId: string): boolean {
  return topVisibleWindowId() === windowId
}

export const useWindowStore = create<WindowStore>((set, get) => ({
  windows: [],
  preMaximizeStates: {},
  preSnapStates: {},
  closeGuards: {},
  nextZIndex: 1,

  openWindow: (appId, title, defaultSize, minSize, initialPosition) => {
    const id = uuidv4()
    const { nextZIndex } = get()

    let x: number
    let y: number

    // Size first, then place against the size we are actually going to render.
    // Clamping the position against `minSize` while rendering at `defaultSize`
    // is what let windows hang below the taskbar.
    const size = clampToDesktop(defaultSize, minSize, {
      width: window.innerWidth,
      height: window.innerHeight,
    })

    const maxY = window.innerHeight - TASKBAR_HEIGHT - size.height

    if (initialPosition) {
      x = Math.max(0, Math.min(initialPosition.x, window.innerWidth - size.width))
      y = Math.max(0, Math.min(initialPosition.y, maxY))
    } else {
      const centerX = Math.floor((window.innerWidth - size.width) / 2)
      const centerY = Math.floor((window.innerHeight - TASKBAR_HEIGHT - size.height) / 2)

      const offsetX = Math.floor(Math.random() * (CASCADE_JITTER_PX * 2 + 1)) - CASCADE_JITTER_PX
      const offsetY = Math.floor(Math.random() * (CASCADE_JITTER_PX * 2 + 1)) - CASCADE_JITTER_PX

      x = Math.max(0, Math.min(centerX + offsetX, window.innerWidth - size.width))
      y = Math.max(0, Math.min(centerY + offsetY, maxY))
    }

    const instance: WindowInstance = {
      id,
      appId,
      title,
      isVisible: true,
      isMaximized: false,
      position: { x, y },
      size,
      zIndex: nextZIndex,
    }

    set((state) => ({
      windows: [...state.windows, instance],
      nextZIndex: state.nextZIndex + 1,
    }))

    return id
  },

  closeWindow: (id) => {
    // Consult the window's close guard first (unsaved-changes prompt, etc.).
    // A guard that returns false aborts the close for every caller — the title
    // bar X and the Ctrl+W hotkey both funnel through here, so neither can
    // bypass it.
    const guard = get().closeGuards[id]
    if (guard && !guard()) return
    set((state) => {
      const { [id]: _removedPre, ...remainingPreMax } = state.preMaximizeStates
      const { [id]: _removedSnap, ...remainingPreSnap } = state.preSnapStates
      const { [id]: _removedGuard, ...remainingGuards } = state.closeGuards
      return {
        windows: state.windows.filter((w) => w.id !== id),
        preMaximizeStates: remainingPreMax,
        preSnapStates: remainingPreSnap,
        closeGuards: remainingGuards,
      }
    })
  },

  updateTitle: (id, title) => {
    set((state) => ({
      windows: state.windows.map((w) => (w.id === id ? { ...w, title } : w)),
    }))
  },

  registerCloseGuard: (id, guard) => {
    set((state) => ({ closeGuards: { ...state.closeGuards, [id]: guard } }))
  },

  unregisterCloseGuard: (id) => {
    set((state) => {
      const { [id]: _removed, ...rest } = state.closeGuards
      return { closeGuards: rest }
    })
  },

  hideWindow: (id) => {
    set((state) => ({
      windows: state.windows.map((w) => (w.id === id ? { ...w, isVisible: false } : w)),
    }))
  },

  showWindow: (id) => {
    const { nextZIndex } = get()
    set((state) => ({
      windows: state.windows.map((w) =>
        w.id === id ? { ...w, isVisible: true, zIndex: nextZIndex } : w
      ),
      nextZIndex: state.nextZIndex + 1,
    }))
  },

  maximizeWindow: (id) => {
    set((state) => {
      const win = state.windows.find((w) => w.id === id)
      if (!win) return state

      const preMaximizeStates = {
        ...state.preMaximizeStates,
        [id]: { position: win.position, size: win.size },
      }

      return {
        windows: state.windows.map((w) =>
          w.id === id
            ? {
                ...w,
                isMaximized: true,
                snapState: undefined,
                position: { x: 0, y: 0 },
                size: {
                  width: window.innerWidth,
                  height: window.innerHeight - TASKBAR_HEIGHT,
                },
              }
            : w
        ),
        preMaximizeStates,
      }
    })
  },

  restoreWindow: (id) => {
    set((state) => {
      const saved = state.preMaximizeStates[id]
      if (!saved) return state

      const { [id]: _removed, ...remainingPreMax } = state.preMaximizeStates

      return {
        windows: state.windows.map((w) =>
          w.id === id
            ? {
                ...w,
                isMaximized: false,
                snapState: undefined,
                position: saved.position,
                size: saved.size,
              }
            : w
        ),
        preMaximizeStates: remainingPreMax,
      }
    })
  },

  focusWindow: (id) => {
    const { nextZIndex } = get()
    set((state) => ({
      windows: state.windows.map((w) => (w.id === id ? { ...w, zIndex: nextZIndex } : w)),
      nextZIndex: state.nextZIndex + 1,
    }))
  },

  updatePosition: (id, position) => {
    set((state) => ({
      windows: state.windows.map((w) => (w.id === id ? { ...w, position } : w)),
    }))
  },

  updateSize: (id, size) => {
    set((state) => ({
      windows: state.windows.map((w) => (w.id === id ? { ...w, size } : w)),
    }))
  },

  getOrderedWindows: () => {
    return [...get().windows].sort((a, b) => a.zIndex - b.zIndex)
  },

  snapWindow: (id, region) => {
    set((state) => {
      const win = state.windows.find((w) => w.id === id)
      if (!win) return state

      // Save pre-snap state only if not already snapped
      const preSnapStates = win.snapState
        ? state.preSnapStates
        : {
            ...state.preSnapStates,
            [id]: { position: win.position, size: win.size },
          }

      const { position, size } = computeSnapGeometry(region)

      return {
        windows: state.windows.map((w) =>
          w.id === id
            ? {
                ...w,
                snapState: region,
                isMaximized: false,
                position,
                size,
              }
            : w
        ),
        preSnapStates,
      }
    })
  },

  unsnap: (id) => {
    set((state) => {
      const saved = state.preSnapStates[id]
      const win = state.windows.find((w) => w.id === id)
      if (!win || !saved) {
        // Just clear snapState
        return {
          windows: state.windows.map((w) => (w.id === id ? { ...w, snapState: undefined } : w)),
        }
      }

      const { [id]: _removed, ...remainingPreSnap } = state.preSnapStates

      return {
        windows: state.windows.map((w) =>
          w.id === id
            ? {
                ...w,
                snapState: undefined,
                position: saved.position,
                size: saved.size,
              }
            : w
        ),
        preSnapStates: remainingPreSnap,
      }
    })
  },

  persistLayout: () => {
    const { windows } = get()
    saveLayout(windows)
  },

  restoreLayout: () => {
    const persisted = loadLayout()
    if (persisted.length === 0) return

    const maxZ = persisted.reduce((acc, w) => Math.max(acc, w.zIndex), 0)

    const windows: WindowInstance[] = persisted.map((p) => ({
      id: uuidv4(), // regenerate — do NOT persist uuid
      appId: p.appId,
      title: p.title,
      position: p.position,
      size: p.size,
      isMaximized: p.isMaximized,
      isVisible: p.isVisible,
      zIndex: p.zIndex,
      snapState: p.snapState,
    }))

    set({
      windows,
      nextZIndex: maxZ + 1,
      preMaximizeStates: {},
      preSnapStates: {},
    })
  },
}))
