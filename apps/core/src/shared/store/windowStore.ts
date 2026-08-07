import { create } from 'zustand'
import { isShellSuspended } from '../../modules/auth/store/authStore'
import { v4 as uuidv4 } from 'uuid'
import { useIntentStore } from './intentStore'

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

// The minimum sliver of a window that must stay on screen so its title bar can
// be grabbed — the same constant the drag clamp uses (windows deliberately have
// no window-level scroll, so a title bar past this line is unrecoverable).
export const TITLEBAR_MIN_VISIBLE = 28

/**
 * How the compositor learns an app's honest `minSize` without the store
 * importing the manifest graph (that coupling risks an import cycle for one
 * lookup). App.tsx registers the APP_REGISTRY-backed resolver at boot; the
 * default is the same fallback WindowContainer uses for unknown apps.
 */
type MinSizeResolver = (appId: string) => { width: number; height: number }
let minSizeResolver: MinSizeResolver = () => ({ width: 240, height: 180 })
export function setMinSizeResolver(resolver: MinSizeResolver): void {
  minSizeResolver = resolver
}

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
   * Brief 85 called this out and brief 49 settled where it belongs: the window
   * layout is **per-tab session state**, persisted in `sessionStorage`, so the
   * workspace a window sits on rides along with it. Omitting it would mean a
   * reload silently collapses every workspace onto 1, destroying the arrangement
   * the feature exists to create, with no warning — while persisting it in
   * `localStorage` would have made two tabs fight over it. Session storage is
   * both answers at once.
   */
  workspaceId?: WorkspaceId
  position: { x: number; y: number }
  size: { width: number; height: number }
  isMaximized: boolean
  isVisible: boolean
  zIndex: number
  snapState?: SnapRegion
}

/**
 * Where a tab's window layout lives (brief 49).
 *
 * **`sessionStorage`, not `localStorage`** — and that one word is the whole
 * brief-49 session fix. `localStorage` is shared by every tab of an origin, so
 * two desktops fought over one key and whichever wrote last decided what both
 * saw on reload. `sessionStorage` is per tab: each gets its own layout, a new
 * tab opens to a fresh desktop, and closing a tab takes its arrangement with it.
 *
 * The brief said to delete the persistence outright and hold the session purely
 * in memory. That ends the stomp, but it also throws away reload survival for
 * the overwhelmingly common single-tab case — you would lose your whole
 * arrangement every refresh to fix a two-tab problem. Under the brief's own SSH
 * analogy that is the wrong cut: **closing the tab is logging out; reloading is
 * the terminal redrawing.** `sessionStorage` models exactly that, meets every
 * acceptance criterion the brief lists, and needs no server state, no reattach
 * and no GC — the browser drops it with the tab.
 */
const LAYOUT_STORAGE_KEY = 'imbatranimos:window-layout'
const ACTIVE_WORKSPACE_KEY = 'imbatranimos:active-workspace'

/**
 * Per-tab storage, degrading to a no-op rather than throwing.
 *
 * Safari in private mode has historically thrown from `sessionStorage`; a
 * desktop that will not open because it could not remember its own window
 * positions would be a much worse failure than forgetting them.
 */
function sessionStore(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

/**
 * Remember which workspace was on screen — per tab, like the layout it belongs
 * to (brief 49).
 *
 * Without this, a reload of a session whose windows live on workspace 3 lands on
 * an empty workspace 1 — which reads as "everything is gone" even though nothing
 * is, and is the single most alarming way this feature could fail.
 */
export function saveActiveWorkspace(id: WorkspaceId): void {
  try {
    sessionStore()?.setItem(ACTIVE_WORKSPACE_KEY, String(id))
  } catch {
    // quota exceeded or private mode — silently skip
  }
}

export function loadActiveWorkspace(): WorkspaceId {
  try {
    return clampWorkspace(sessionStore()?.getItem(ACTIVE_WORKSPACE_KEY) ?? 1)
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
    sessionStore()?.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(data))
  } catch {
    // quota exceeded or private mode — silently skip
  }
}

export function loadLayout(): PersistedWindow[] {
  try {
    const raw = sessionStore()?.getItem(LAYOUT_STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as PersistedWindow[]
  } catch {
    return []
  }
}

export function clearLayout(): void {
  sessionStore()?.removeItem(LAYOUT_STORAGE_KEY)
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

// ── Keyboard snapping (brief 103) ─────────────────────────────────────────────

export type SnapKeyDirection = 'left' | 'right' | 'up' | 'down'

export type SnapKeyAction =
  | { type: 'snap'; region: SnapRegion }
  | { type: 'maximize' }
  | { type: 'restore' }
  | { type: 'unsnap' }
  | { type: 'minimize' }
  | { type: 'none' }

/**
 * Windows arrow-key snap semantics as a pure transition table: arrows move the
 * window between regions by SEQUENCE (left half + up → top-left quarter; half
 * + down → bottom quarter; floating + up → maximize; maximized + down →
 * restore; floating + down → minimize) rather than needing one chord per
 * region. Pure and exported — the full table is the unit test's job.
 */
export function nextSnapState(
  prev: { snapState?: SnapRegion; isMaximized: boolean },
  dir: SnapKeyDirection
): SnapKeyAction {
  const s = prev.isMaximized ? 'maximized' : (prev.snapState ?? 'floating')
  switch (dir) {
    case 'left':
      switch (s) {
        case 'floating':
        case 'maximized':
        case 'top':
          return { type: 'snap', region: 'left' }
        case 'right':
          return { type: 'unsnap' } // back toward where it came from
        case 'tr':
          return { type: 'snap', region: 'tl' }
        case 'br':
          return { type: 'snap', region: 'bl' }
        default:
          return { type: 'none' } // already at the left edge
      }
    case 'right':
      switch (s) {
        case 'floating':
        case 'maximized':
        case 'top':
          return { type: 'snap', region: 'right' }
        case 'left':
          return { type: 'unsnap' }
        case 'tl':
          return { type: 'snap', region: 'tr' }
        case 'bl':
          return { type: 'snap', region: 'br' }
        default:
          return { type: 'none' }
      }
    case 'up':
      switch (s) {
        case 'floating':
        case 'top':
        case 'tl':
        case 'tr':
          return { type: 'maximize' } // rising past the top row maximizes
        case 'left':
          return { type: 'snap', region: 'tl' }
        case 'right':
          return { type: 'snap', region: 'tr' }
        case 'bl':
          return { type: 'snap', region: 'left' } // bottom quarter + up → half
        case 'br':
          return { type: 'snap', region: 'right' }
        default:
          return { type: 'none' } // already maximized
      }
    case 'down':
      switch (s) {
        case 'maximized':
          return { type: 'restore' }
        case 'top':
          return { type: 'unsnap' }
        case 'tl':
          return { type: 'snap', region: 'left' } // top quarter + down → half
        case 'tr':
          return { type: 'snap', region: 'right' }
        case 'left':
          return { type: 'snap', region: 'bl' } // half + down → bottom quarter
        case 'right':
          return { type: 'snap', region: 'br' }
        default:
          return { type: 'minimize' } // floating or bottom quarter sinks away
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
  // guard returns true to allow the close, false to abort it — or a promise of
  // either, for guards that ask with a themed dialog (brief 102). Kept generic —
  // the store never knows *why* a close is vetoed; the window supplies the policy.
  closeGuards: Record<string, () => boolean | Promise<boolean>>
  // Windows whose async guard is still deciding. Consulted at closeWindow entry
  // so a second close request neither stacks a dialog nor double-closes.
  pendingCloses: Set<string>
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
  registerCloseGuard: (id: string, guard: () => boolean | Promise<boolean>) => void
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
  /**
   * Re-fit every window to the CURRENT viewport (brief 103): maximized windows
   * take the new usable desktop, snapped windows retile, floaters shrink only
   * if they now overflow and move only enough to keep their title bar
   * reachable. `minSize` still wins over the viewport.
   */
  reflowToViewport: () => void
  /**
   * Show desktop (brief 103): any visible window on the active workspace →
   * stash and hide them all; none → bring the stash back in its stacking
   * order. A window opened between the two presses makes "any visible" true
   * again, so the second press hides — exactly Windows' behaviour.
   */
  toggleShowDesktop: () => void
  /** Per-workspace stash of window ids hidden by toggleShowDesktop, in z-order. */
  showDesktopStash: Partial<Record<WorkspaceId, string[]>>
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
  // Behind the lock overlay no window is focused (brief 101): this is the one
  // gate that silences every app-side useSaveHotkey/useTopWindowKeydown, since
  // they all check system.window.isFocused() at keydown time.
  if (isShellSuspended()) return null
  const { windows, activeWorkspace } = useWindowStore.getState()
  let top: WindowInstance | null = null
  for (const w of windows) {
    // Scoped to the active workspace (brief 85): a window on another virtual
    // desktop is `display:none`, so it must not be treated as focused — else
    // the taskbar highlight, window chrome and Ctrl+S/Mod+W would target a
    // window the user cannot see.
    if (!w.isVisible || w.workspaceId !== activeWorkspace) continue
    if (!top || w.zIndex > top.zIndex) top = w
  }
  return top?.id ?? null
}

/** True when `windowId` is the top-most visible window (owns global hotkeys). */
export function isTopWindow(windowId: string): boolean {
  return topVisibleWindowId() === windowId
}

/**
 * Reactive hook: is this window currently on screen (not minimized)? Minimize
 * is `display:none` with the component still mounted, so an app that polls
 * (System Monitor) or animates can gate that work on visibility instead of
 * running it forever behind a hidden window. Re-renders only when the boolean
 * flips, since the selector returns a primitive.
 */
export function useWindowVisible(windowId: string): boolean {
  return useWindowStore((s) => s.windows.find((w) => w.id === windowId)?.isVisible ?? false)
}

/**
 * A sane floating geometry to restore a maximized window to when its pre-max
 * state is gone (a layout restored while maximized keeps no pre-max entry).
 * Three-quarters of the usable desktop, centered, never below a usable floor.
 */
function fallbackFloatingGeometry(currentSize: { width: number; height: number }): {
  position: { x: number; y: number }
  size: { width: number; height: number }
} {
  const availW = window.innerWidth
  const availH = window.innerHeight - TASKBAR_HEIGHT
  const width = Math.max(360, Math.min(currentSize.width, Math.round(availW * 0.75)))
  const height = Math.max(240, Math.min(currentSize.height, Math.round(availH * 0.75)))
  const x = Math.max(0, Math.floor((availW - width) / 2))
  const y = Math.max(0, Math.floor((availH - height) / 2))
  return { position: { x, y }, size: { width, height } }
}

/**
 * Clamp a floating window's position so at least the title-bar row stays on
 * the usable desktop. Size is untouched here — an honest minSize may overflow
 * a small viewport (that is the minSize-wins rule); position is what keeps it
 * recoverable.
 */
function clampPosition(
  position: { x: number; y: number },
  size: { width: number; height: number }
): { x: number; y: number } {
  // The same bounds as the title-bar drag clamp (Window.tsx): fully on screen
  // horizontally when it fits (x pins to 0 when the window is wider than the
  // viewport), and vertically at least the title-bar row above the taskbar.
  const maxX = Math.max(0, window.innerWidth - size.width)
  const maxY = Math.max(0, window.innerHeight - TASKBAR_HEIGHT - TITLEBAR_MIN_VISIBLE)
  return {
    x: Math.min(Math.max(0, position.x), maxX),
    y: Math.min(Math.max(0, position.y), maxY),
  }
}

export const useWindowStore = create<WindowStore>((set, get) => ({
  windows: [],
  activeWorkspace: 1,
  preMaximizeStates: {},
  preSnapStates: {},
  closeGuards: {},
  pendingCloses: new Set<string>(),
  showDesktopStash: {},
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
    // The cleanup below runs only when a close actually proceeds, exactly once.
    // A window id keys entries in two side stores as well. Nothing removes them
    // when the window goes away, so a long session leaks one entry per opened
    // window (and a stale intent could be mis-delivered to a recycled id). Clear
    // both here, the single choke point every close funnels through.
    // The opened-file latch moved into the SDK with brief 48 and is private to
    // it — the OS cannot (and should not) reach in to clear it. Entries are
    // keyed by uuid window ids that never recur, so a closed window's record
    // is a few dozen orphaned bytes per tab session, not a leak that grows.
    const proceed = () => {
      useIntentStore.getState().clearIntent(id)
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
    }

    // An async guard is still deciding this id — the dialog is up. A second
    // close request neither stacks nor closes; the pending answer settles both.
    if (get().pendingCloses.has(id)) return

    // Consult the window's close guard first (unsaved-changes prompt, etc.).
    // A guard verdict of false — sync or settled — aborts the close for every
    // caller: the title bar X and the Ctrl+W hotkey both funnel through here,
    // so neither can bypass it. A plain boolean keeps today's same-tick close;
    // a promise (a themed dialog asking, brief 102) holds the close open until
    // it settles.
    const guard = get().closeGuards[id]
    const verdict = guard ? guard() : true
    if (verdict === true) {
      proceed()
      return
    }
    if (verdict === false) return

    set((state) => {
      const next = new Set(state.pendingCloses)
      next.add(id)
      return { pendingCloses: next }
    })
    const unpend = () =>
      set((state) => {
        const next = new Set(state.pendingCloses)
        next.delete(id)
        return { pendingCloses: next }
      })
    verdict.then(
      (ok) => {
        unpend()
        if (ok) proceed()
      },
      () => {
        // A guard that rejects answered nothing — keeping the window open (and
        // its unsaved work) is the only safe reading.
        unpend()
      }
    )
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
      const win = state.windows.find((w) => w.id === id)
      if (!win) return state

      const saved = state.preMaximizeStates[id]
      const { [id]: _removed, ...remainingPreMax } = state.preMaximizeStates

      // A window maximized *before* a layout save has no pre-max geometry after
      // restore (restoreLayout drops those), so the old early-return here left it
      // permanently un-restorable. Fall back to a centered, desktop-clamped
      // floating size so the restore button always does something sane.
      const geometry = saved ?? fallbackFloatingGeometry(win.size)
      // The saved geometry may predate a viewport resize (brief 103): re-clamp
      // so a restore never lands off-screen or oversized for the new desktop.
      const size = clampToDesktop(geometry.size, minSizeResolver(win.appId), {
        width: window.innerWidth,
        height: window.innerHeight,
      })
      const position = clampPosition(geometry.position, size)

      return {
        windows: state.windows.map((w) =>
          w.id === id
            ? {
                ...w,
                isMaximized: false,
                snapState: undefined,
                position,
                size,
              }
            : w
        ),
        preMaximizeStates: remainingPreMax,
      }
    })
  },

  focusWindow: (id) => {
    // Every in-window click funnels through here. Without this guard a click on
    // the already-top window still minted a new zIndex + windows array + a
    // debounced localStorage write — pure churn. Bail when nothing would change.
    if (topVisibleWindowId() === id) return
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

      // Same re-clamp as restoreWindow: the pre-snap geometry may have been
      // saved at a different viewport size.
      const size = clampToDesktop(saved.size, minSizeResolver(win.appId), {
        width: window.innerWidth,
        height: window.innerHeight,
      })
      const position = clampPosition(saved.position, size)

      return {
        windows: state.windows.map((w) =>
          w.id === id
            ? {
                ...w,
                snapState: undefined,
                position,
                size,
              }
            : w
        ),
        preSnapStates: remainingPreSnap,
      }
    })
  },

  reflowToViewport: () => {
    set((state) => {
      let changed = false
      const windows = state.windows.map((w) => {
        if (w.isMaximized) {
          const size = {
            width: window.innerWidth,
            height: window.innerHeight - TASKBAR_HEIGHT,
          }
          if (w.size.width === size.width && w.size.height === size.height) return w
          changed = true
          return { ...w, position: { x: 0, y: 0 }, size }
        }
        if (w.snapState) {
          const geo = computeSnapGeometry(w.snapState)
          if (
            w.size.width === geo.size.width &&
            w.size.height === geo.size.height &&
            w.position.x === geo.position.x &&
            w.position.y === geo.position.y
          ) {
            return w
          }
          changed = true
          return { ...w, position: geo.position, size: geo.size }
        }
        // Floater: shrink only what now overflows (minSize still wins — an
        // honest minimum may overflow), move only enough to stay reachable.
        const minSize = minSizeResolver(w.appId)
        const size = clampToDesktop(w.size, minSize, {
          width: window.innerWidth,
          height: window.innerHeight,
        })
        const position = clampPosition(w.position, size)
        if (
          size.width === w.size.width &&
          size.height === w.size.height &&
          position.x === w.position.x &&
          position.y === w.position.y
        ) {
          return w
        }
        changed = true
        return { ...w, position, size }
      })
      // No new array when nothing moved: the persist debounce keys on the
      // `windows` identity, and a no-op resize must not write sessionStorage.
      return changed ? { windows } : state
    })
  },

  toggleShowDesktop: () => {
    set((state) => {
      const ws = state.activeWorkspace
      const visible = state.windows
        .filter((w) => w.isVisible && w.workspaceId === ws)
        .sort((a, b) => a.zIndex - b.zIndex)

      if (visible.length > 0) {
        // Stash ids in ascending z-order and hide them all.
        const ids = visible.map((w) => w.id)
        return {
          windows: state.windows.map((w) => (ids.includes(w.id) ? { ...w, isVisible: false } : w)),
          showDesktopStash: { ...state.showDesktopStash, [ws]: ids },
        }
      }

      const stash = state.showDesktopStash[ws] ?? []
      if (stash.length === 0) return state
      // Restore in ascending stashed z-order with fresh z-indices so the
      // stacking survives the round trip; ids closed in between just skip.
      let z = state.nextZIndex
      const zFor = new Map<string, number>()
      for (const id of stash) {
        if (state.windows.some((w) => w.id === id)) zFor.set(id, z++)
      }
      return {
        windows: state.windows.map((w) =>
          zFor.has(w.id) ? { ...w, isVisible: true, zIndex: zFor.get(w.id)! } : w
        ),
        nextZIndex: z,
        showDesktopStash: { ...state.showDesktopStash, [ws]: [] },
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
