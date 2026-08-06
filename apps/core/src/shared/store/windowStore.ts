import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'

export type SnapRegion = 'left' | 'right' | 'top' | 'tl' | 'tr' | 'bl' | 'br'

// ── Workspaces (brief 85) ─────────────────────────────────────────────────────

/**
 * How many virtual desktops there are.
 *
 * Fixed at four rather than dynamic. Add/remove is where this gets expensive —
 * naming, reordering, and deciding what happens to the windows on a workspace
 * you delete — for very little gain on a single-user desktop that has no second
 * monitor to escape to in the first place.
 */
export const WORKSPACE_COUNT = 4
export const WORKSPACE_IDS = [1, 2, 3, 4] as const
export type WorkspaceId = (typeof WORKSPACE_IDS)[number]

/**
 * Force any number into a real workspace.
 *
 * Load-bearing rather than defensive: a persisted layout from a build with a
 * different count, or a hand-edited localStorage value, must never leave a
 * window on a workspace no pip can reach. The brief's hard invariant is that no
 * window can become unreachable, and this is where that is enforced.
 */
export function clampWorkspace(value: unknown): WorkspaceId {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n) || n < 1) return 1
  return (n > WORKSPACE_COUNT ? WORKSPACE_COUNT : n) as WorkspaceId
}

/** Which workspaces currently hold at least one window. */
export function workspaceOccupancy(
  windows: { workspaceId: WorkspaceId }[]
): Record<WorkspaceId, number> {
  const out = { 1: 0, 2: 0, 3: 0, 4: 0 } as Record<WorkspaceId, number>
  for (const w of windows) out[clampWorkspace(w.workspaceId)]++
  return out
}

/** Step from `current` by `delta`, wrapping — so ← from 1 lands on 4. */
export function nextWorkspace(current: WorkspaceId, delta: number): WorkspaceId {
  const zero = (current - 1 + delta) % WORKSPACE_COUNT
  return (((zero + WORKSPACE_COUNT) % WORKSPACE_COUNT) + 1) as WorkspaceId
}

export type WindowInstance = {
  id: string
  appId: string
  title: string
  /** Which virtual desktop this window lives on (brief 85). Never undefined. */
  workspaceId: WorkspaceId
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
  /**
   * Persisted, despite the brief listing it as out of scope.
   *
   * The brief calls workspace assignment "session state" and says a new tab
   * starts fresh on workspace 1 — but window layout **is already persisted
   * here**, geometry and all, and restored on boot. Leaving `workspaceId` out
   * would mean a reload silently collapses every workspace onto 1, destroying
   * the arrangement the feature exists to create, with no warning. That is
   * worse than either option the brief weighed. This is not brief 49's dotfile
   * question: it is the window layout, and the window layout already persists.
   */
  workspaceId?: WorkspaceId
  position: { x: number; y: number }
  size: { width: number; height: number }
  isMaximized: boolean
  isVisible: boolean
  zIndex: number
  snapState?: SnapRegion
}

const LAYOUT_STORAGE_KEY = 'imbatranimos:window-layout'
const ACTIVE_WORKSPACE_KEY = 'imbatranimos:active-workspace'

/**
 * Remember which workspace was on screen.
 *
 * Without this, a reload of a session whose windows live on workspace 3 lands on
 * an empty workspace 1 — which reads as "everything is gone" even though nothing
 * is, and is the single most alarming way this feature could fail.
 */
export function saveActiveWorkspace(id: WorkspaceId): void {
  try {
    localStorage.setItem(ACTIVE_WORKSPACE_KEY, String(id))
  } catch {
    // quota exceeded or private mode — silently skip
  }
}

export function loadActiveWorkspace(): WorkspaceId {
  try {
    return clampWorkspace(localStorage.getItem(ACTIVE_WORKSPACE_KEY) ?? 1)
  } catch {
    return 1
  }
}

export function saveLayout(windows: WindowInstance[]): void {
  const data: PersistedWindow[] = windows.map((w) => ({
    appId: w.appId,
    title: w.title,
    workspaceId: w.workspaceId,
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
  /** The workspace currently on screen (brief 85). */
  activeWorkspace: WorkspaceId
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
  /** Ordered windows on one workspace — defaults to the active one. */
  getWorkspaceWindows: (workspaceId?: WorkspaceId) => WindowInstance[]
  setActiveWorkspace: (workspaceId: WorkspaceId) => void
  moveWindowToWorkspace: (id: string, workspaceId: WorkspaceId) => void
  snapWindow: (id: string, region: SnapRegion) => void
  unsnap: (id: string) => void
  persistLayout: () => void
  restoreLayout: () => void
}

export const useWindowStore = create<WindowStore>((set, get) => ({
  windows: [],
  activeWorkspace: 1,
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
      // A new window belongs to the desktop you are looking at.
      workspaceId: get().activeWorkspace,
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
    set((state) => {
      const target = state.windows.find((w) => w.id === id)
      // Focusing a window on another workspace SWITCHES to it (brief 85).
      //
      // This is the invariant "no window can become unreachable", enforced at
      // the one place every caller funnels through: the taskbar, Alt+Tab,
      // `openApp` re-focusing a single-instance app, and a notification click.
      // Without it, clicking a toast raised by an app on workspace 3 would
      // raise the z-index of a window you cannot see and appear to do nothing.
      const activeWorkspace =
        target && target.workspaceId !== state.activeWorkspace
          ? target.workspaceId
          : state.activeWorkspace
      if (activeWorkspace !== state.activeWorkspace) saveActiveWorkspace(activeWorkspace)
      return {
        windows: state.windows.map((w) => (w.id === id ? { ...w, zIndex: nextZIndex } : w)),
        nextZIndex: state.nextZIndex + 1,
        activeWorkspace,
      }
    })
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

  /**
   * A workspace-aware variant rather than a change to `getOrderedWindows`.
   *
   * Existing callers mean "every window" and must keep meaning it — the add-on
   * manager and the palette act on apps, and a store method that quietly starts
   * returning a subset is the kind of change that breaks them silently.
   */
  getWorkspaceWindows: (workspaceId) => {
    const target = workspaceId ?? get().activeWorkspace
    return [...get().windows]
      .filter((w) => w.workspaceId === target)
      .sort((a, b) => a.zIndex - b.zIndex)
  },

  setActiveWorkspace: (workspaceId) => {
    const next = clampWorkspace(workspaceId)
    saveActiveWorkspace(next)
    set({ activeWorkspace: next })
  },

  /**
   * Move a window, and follow it.
   *
   * Following is deliberate: silently relocating the window the user is looking
   * at, leaving them staring at the space where it used to be, is disorienting
   * and reads as a bug. Focus follows too, so the window is usable on arrival.
   */
  moveWindowToWorkspace: (id, workspaceId) => {
    const next = clampWorkspace(workspaceId)
    const { nextZIndex } = get()
    saveActiveWorkspace(next)
    set((state) => ({
      windows: state.windows.map((w) =>
        w.id === id ? { ...w, workspaceId: next, isVisible: true, zIndex: nextZIndex } : w
      ),
      nextZIndex: state.nextZIndex + 1,
      activeWorkspace: next,
    }))
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
      // A layout written before brief 85 has no workspace; clamp defaults it to
      // 1 rather than leaving `undefined`, which would filter to nowhere.
      workspaceId: clampWorkspace(p.workspaceId),
    }))

    set({
      windows,
      nextZIndex: maxZ + 1,
      preMaximizeStates: {},
      preSnapStates: {},
      activeWorkspace: loadActiveWorkspace(),
    })
  },
}))
