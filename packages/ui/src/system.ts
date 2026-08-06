/**
 * The app ↔ OS protocol (brief 48). THIS FILE IS THE SPEC.
 *
 * An app imports nothing from the OS. At mount, the compositor hands it one
 * `system` object — its connection to the machine, the way a Wayland client
 * holds a display connection or a VS Code extension holds its
 * `ExtensionContext`. Everything an app may do to the world is a method here;
 * everything the world may tell an app arrives through `on(...)`. Because the
 * handle is an object passed in, the same app code runs whether it is backed by
 * direct calls (today) or postMessage to a sandboxed iframe (the day
 * third-party apps arrive). Swap the transport; the app never changes.
 *
 * Rules for editing this file:
 *
 * - **Additions are API decisions.** Every member is a promise to every app,
 *   under every future transport. If a thing can be done app-side with what is
 *   already here, it does not get a method.
 * - **Everything must survive postMessage.** Methods take and return data (or
 *   promises of data). Callbacks are fine — a transport can proxy them — but
 *   no live objects, no stores, no DOM nodes. The one deliberate exception is
 *   `window.onCloseRequest`, whose veto is synchronous; a message transport
 *   will have to renegotiate that contract, and the note there says so.
 * - **Scope is the security model.** A handle is minted for one app in one
 *   window. `window.*` acts on that window alone; `notify` stamps that app's
 *   id. An app cannot address what its handle does not name.
 * - Bump {@link PROTOCOL_VERSION} on any breaking change.
 */

export const PROTOCOL_VERSION = 1

// ── Files ─────────────────────────────────────────────────────────────────────

/** A chosen file: which jailed root it lives in, and the path inside it. */
export type FileChoice = { root: string; path: string }

export type PickOpenOptions = {
  title?: string
  /** Preferred extensions, lowercase without the dot. A hint, not a jail. */
  extensions?: string[]
}

export type PickSaveOptions = PickOpenOptions & { suggestedName?: string }

/**
 * `system.fs` — the file syscalls, plus the OS file portal.
 *
 * `read`/`upload` move bytes over the *authenticated* channel: a 401 anywhere
 * drops the desktop to the lock screen, which is exactly right for an
 * internet-exposable OS. The `pick*` trio is the xdg-desktop-portal analogue:
 * the OS renders its Open/Save dialog and the app receives only the choice —
 * pure data, transport-safe, and the dialog UI can never drift per app.
 */
export interface SystemFs {
  /** Fetch a file's raw bytes. Rejects with an HTTP-shaped error on failure. */
  read(root: string, path: string): Promise<ArrayBuffer>
  /**
   * Write bytes to a path (overwrites; creates parent directories). Throws
   * `UploadTooLargeError` when the backend refuses an over-cap body.
   */
  upload(root: string, path: string, bytes: ArrayBuffer | Uint8Array, name: string): Promise<void>
  /** Bare URL for `<a href>`-style downloads (browser-native, cookie-authed). */
  downloadUrl(root: string, path: string): string
  /** OS Open dialog. Resolves the choice, or null on cancel. */
  pickOpen(opts?: PickOpenOptions): Promise<FileChoice | null>
  /** OS Save-as dialog. Resolves the choice, or null on cancel. */
  pickSave(opts?: PickSaveOptions): Promise<FileChoice | null>
  /** OS folder chooser. `path` is `''` at a root. */
  pickDirectory(opts?: { title?: string }): Promise<FileChoice | null>
  /** Record a file in the OS-wide recents (brief 94), attributed to this app. */
  recordRecent(root: string, path: string): void
  /** Drop a recents entry this app failed to reopen (self-heal, brief 94). */
  removeRecent(root: string, path: string): void
}

// ── HTTP (the escape hatch) ───────────────────────────────────────────────────

export type SystemHttpRequestConfig = {
  params?: Record<string, unknown>
  headers?: Record<string, string>
  responseType?: 'arraybuffer' | 'blob' | 'json' | 'text'
  signal?: AbortSignal
  timeout?: number
}

export interface SystemHttpResponse<T = unknown> {
  data: T
  status: number
  headers: Record<string, unknown>
}

/**
 * `system.http` — the authenticated backend client, for an app's own routes.
 *
 * Deliberately the loosest capability and the one to prefer *against*: reach
 * for `system.fs` and friends first. It exists because every app is
 * first-party and owns backend modules of its own (notes, calendar, git, …)
 * behind `SessionAuthGuard`. It is also the future permission boundary: when
 * third-party apps arrive, this is the capability a manifest must ask for.
 */
export interface SystemHttp {
  get<T = unknown>(url: string, config?: SystemHttpRequestConfig): Promise<SystemHttpResponse<T>>
  delete<T = unknown>(url: string, config?: SystemHttpRequestConfig): Promise<SystemHttpResponse<T>>
  post<T = unknown>(
    url: string,
    data?: unknown,
    config?: SystemHttpRequestConfig
  ): Promise<SystemHttpResponse<T>>
  put<T = unknown>(
    url: string,
    data?: unknown,
    config?: SystemHttpRequestConfig
  ): Promise<SystemHttpResponse<T>>
  patch<T = unknown>(
    url: string,
    data?: unknown,
    config?: SystemHttpRequestConfig
  ): Promise<SystemHttpResponse<T>>
}

// ── Window ────────────────────────────────────────────────────────────────────

/**
 * `system.window` — the app-facing slice of the compositor, scoped to the
 * app's own window. There is no way to name another window; that is the point.
 *
 * Handles minted without a window (a background service, a desktop layer, a
 * widget) carry a null-object implementation: reads return inert values,
 * writes warn in dev and do nothing. Code shared between windowed and
 * windowless mounts must not depend on window state.
 */
export interface SystemWindow {
  /** Retitle the window (title bar + taskbar). */
  setTitle(title: string): void
  /** Ask to close — runs the close guard first, same as the title-bar X. */
  requestClose(): void
  /** Raise + focus this window. */
  focus(): void
  /** Minimise. */
  hide(): void
  /** Un-minimise (does not steal focus). */
  show(): void
  /** True while this window is the top-most visible one on its workspace. */
  isFocused(): boolean
  /** False while minimised. (Workspace parking is not minimisation: brief 85.) */
  isVisible(): boolean
  /**
   * Register a close veto: return false to keep the window open (unsaved
   * changes). Returns the unregister function. One guard per window — a second
   * registration replaces the first.
   *
   * Transport note: the veto is consulted synchronously, which a postMessage
   * transport cannot do. When that transport arrives, close becomes a
   * request/acknowledge exchange and this signature changes with a version
   * bump. Documented now so the constraint is a decision, not a surprise.
   */
  onCloseRequest(guard: () => boolean): () => void
}

// ── Intents ───────────────────────────────────────────────────────────────────

/** Why the opener resolved the way it did (brief 81). */
export type OpenerResolution = {
  appId: string
  reason: 'override' | 'declared' | 'text-fallback' | 'none'
}

export type OpenerCandidate = { appId: string; name: string }

/**
 * `system.intents` — the shell: launching apps, and receiving what was thrown
 * at you.
 *
 * Delivery is push-based: `onIntent` fires immediately with a pending payload
 * (the launch intent is set before the app mounts) and again on every
 * re-delivery to an already-open single-instance window. `consume` is the
 * one-shot pull for apps that only ever read a launch payload.
 */
export interface SystemIntents {
  /** Launch (or focus) an app, optionally handing it a payload. Returns its window id, '' if refused. */
  openApp(appId: string, payload?: unknown): string
  /** Drain this window's pending intent, if any. */
  consume<T = unknown>(): T | undefined
  /** Subscribe to intents for this window; pending payload delivered at once. */
  onIntent(cb: (payload: unknown) => void): () => void
  /** The file-association registry (brief 81), read side + the user's choice. */
  readonly associations: {
    resolveOpener(fileName: string): OpenerResolution
    candidatesFor(fileName: string): OpenerCandidate[]
    allCandidates(): OpenerCandidate[]
    /** The override key for a filename: extension, or whole name when bare. */
    keyFor(fileName: string): string
    /** Display name for an opener app id, or null if unknown. */
    openerName(appId: string): string | null
    /** Persist "always open this type with …" (a dotfile, brief 49). */
    setDefault(key: string, appId: string): void
  }
}

// ── Notifications ─────────────────────────────────────────────────────────────

export type SystemNotifyLevel = 'info' | 'success' | 'warning' | 'error'

/**
 * Input for `system.notify`. There is deliberately no `appId` field: the
 * handle stamps the app it was minted for, so an app cannot toast in another
 * app's name.
 */
export type SystemNotifyInput = {
  title: string
  body?: string
  level?: SystemNotifyLevel
}

// ── Shortcuts ─────────────────────────────────────────────────────────────────

export type ShortcutScope = 'Global' | 'Window management' | 'Editing'

export type ShortcutDoc = {
  /** Stable id, so re-registration (HMR, remount) replaces rather than duplicates. */
  id: string
  /** Binding string, e.g. `mod+k`. */
  keys: string
  description: string
  scope: ShortcutScope
  /** Caveat shown beside the row — e.g. a key the browser may intercept first. */
  note?: string
}

export type ShortcutBinding = ShortcutDoc & { handler: () => void }

/**
 * `system.shortcuts` — the OS shortcut registry. `register` binds AND
 * documents in one call (a bound-but-undiscoverable key and a documented-but-
 * dead row are both impossible); `document` publishes rows for keys the app
 * binds itself inside its own DOM (an editor's mod+B).
 */
export interface SystemShortcuts {
  register(bindings: ShortcutBinding[]): () => void
  document(docs: ShortcutDoc[]): () => void
}

// ── Appearance ────────────────────────────────────────────────────────────────

export type SystemAppearanceState = { theme: 'dark' | 'light'; accent: string }

/**
 * `system.appearance` — read the OS theme. Most apps need nothing here (the
 * design tokens are CSS variables); this exists for the ones that drive a
 * non-DOM surface from it — xterm's palette, Monaco's theme. Live changes
 * arrive via `on('appearance-changed', …)`.
 */
export interface SystemAppearance {
  get(): SystemAppearanceState
}

// ── Schedule ──────────────────────────────────────────────────────────────────

export type ScheduleDomain = 'clock' | 'calendar' | 'todo'

/**
 * `system.schedule` — atomic cross-tab occurrence claims (brief 93), so two
 * desktop tabs polling the same alarm produce exactly one toast. Fails open:
 * an unreachable backend claims true, because a duplicate toast beats a
 * silently missed alarm.
 */
export interface SystemSchedule {
  claim(domain: ScheduleDomain, itemId: string, occurrenceMs: number): Promise<boolean>
}

// ── Events ────────────────────────────────────────────────────────────────────

/**
 * Compositor → app events. `focus`/`blur` track top-most-visible status;
 * `visibility` fires with the new value on minimise/restore and workspace
 * switches; `appearance-changed` fires with the new theme + accent.
 */
export type SystemEventMap = {
  focus: void
  blur: void
  visibility: boolean
  'appearance-changed': SystemAppearanceState
}

export type SystemEvent = keyof SystemEventMap

// ── The handle ────────────────────────────────────────────────────────────────

export interface SystemHandle {
  readonly protocolVersion: number
  /** The app this handle was minted for. */
  readonly appId: string
  /** The window it is scoped to, or null outside one (background/layer/widget). */
  readonly windowId: string | null
  readonly fs: SystemFs
  readonly http: SystemHttp
  readonly window: SystemWindow
  readonly intents: SystemIntents
  readonly shortcuts: SystemShortcuts
  readonly appearance: SystemAppearance
  readonly schedule: SystemSchedule
  /** Raise a notification as this app. Returns the notification id. */
  notify(input: SystemNotifyInput): string
  /** Subscribe to a compositor event. Returns the unsubscribe function. */
  on<E extends SystemEvent>(event: E, cb: (payload: SystemEventMap[E]) => void): () => void
}
