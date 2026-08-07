import {
  PROTOCOL_VERSION,
  type ShortcutBinding,
  type ShortcutDoc,
  type SystemAppearanceState,
  type SystemEvent,
  type SystemEventMap,
  type SystemHandle,
  type SystemHttp,
  type SystemNotifyInput,
  type SystemWindow,
} from '@imbatranim/ui'
import { api } from '../lib/axios'
import { fetchFileBytes, uploadFileBytes, downloadUrl } from '../lib/fileBytes'
import { recordRecentFile, removeRecentFile } from '../lib/recentFiles'
import { claimScheduleOccurrence, type ScheduleDomain } from '../lib/scheduleClaim'
import { notify } from '../shared/store/notificationStore'
import { useAppearanceStore } from '../shared/store/appearanceStore'
import { useIntentStore } from '../shared/store/intentStore'
import { isTopWindow, useWindowStore } from '../shared/store/windowStore'
import { openApp } from '../shared/intents/openApp'
import { isShellSuspended } from '../modules/auth/store/authStore'
import { useShortcutStore } from '../shared/hooks/shortcutRegistry'
import { eventMatchesBinding, parseBinding } from '../shared/hooks/useGlobalHotkeys'
import { isTextEntry } from '@imbatranim/ui'
import {
  allOpenerCandidates,
  associationKey,
  candidatesFor,
  openerName,
  resolveOpener,
  useAssociationStore,
} from '../shared/registry/associations'
import { requestPick } from './filePortal'

/**
 * The in-process transport of the protocol (brief 48).
 *
 * One handle per (app, window) mount, built over the exact stores and libs the
 * old direct imports reached — so behaviour is identical, only the coupling
 * changed. The day a sandboxed transport arrives, this file is what gets a
 * postMessage twin; the protocol in `@imbatranim/ui`'s `system.ts` and every
 * app stay put.
 */

/** Imperative twin of `useGlobalHotkeys`, same matcher, same text-entry rule. */
function bindHotkeys(bindings: ShortcutBinding[]): () => void {
  function onKeyDown(e: KeyboardEvent) {
    // Same rule as useGlobalHotkeys: a covered screen eats no keys (brief 101).
    if (isShellSuspended()) return
    for (const binding of bindings) {
      const parsed = parseBinding(binding.keys)
      if (!eventMatchesBinding(e, parsed)) continue
      const bare = !parsed.mod && !parsed.ctrl && !parsed.alt
      if (bare && isTextEntry(e.target)) continue
      e.preventDefault()
      binding.handler()
      return
    }
  }
  window.addEventListener('keydown', onKeyDown)
  return () => window.removeEventListener('keydown', onKeyDown)
}

/**
 * The null-object window for handles minted outside one (background service,
 * desktop layer, widget). Reads return inert values; writes are dev-visible
 * no-ops rather than throws, because "shared code touched window state from a
 * background mount" should degrade, not crash the service.
 */
function windowlessWindow(appId: string): SystemWindow {
  const warn = (op: string) => {
    if (import.meta.env.DEV) {
      console.warn(`[system] ${appId}: window.${op}() ignored — this mount has no window`)
    }
  }
  return {
    setTitle: () => warn('setTitle'),
    requestClose: () => warn('requestClose'),
    focus: () => warn('focus'),
    hide: () => warn('hide'),
    show: () => warn('show'),
    isFocused: () => false,
    isVisible: () => false,
    onCloseRequest: () => {
      warn('onCloseRequest')
      return () => undefined
    },
  }
}

function windowFor(windowId: string): SystemWindow {
  const store = () => useWindowStore.getState()
  return {
    setTitle: (title) => store().updateTitle(windowId, title),
    requestClose: () => store().closeWindow(windowId),
    focus: () => store().focusWindow(windowId),
    hide: () => store().hideWindow(windowId),
    show: () => store().showWindow(windowId),
    isFocused: () => isTopWindow(windowId),
    isVisible: () => store().windows.find((w) => w.id === windowId)?.isVisible ?? false,
    onCloseRequest: (guard) => {
      store().registerCloseGuard(windowId, guard)
      return () => store().unregisterCloseGuard(windowId)
    },
  }
}

function appearanceSnapshot(): SystemAppearanceState {
  const { theme, accent } = useAppearanceStore.getState()
  return { theme, accent }
}

export function createSystemHandle(appId: string, windowId: string | null): SystemHandle {
  const win = windowId === null ? windowlessWindow(appId) : windowFor(windowId)

  const on = <E extends SystemEvent>(
    event: E,
    cb: (payload: SystemEventMap[E]) => void
  ): (() => void) => {
    switch (event) {
      case 'appearance-changed':
        return useAppearanceStore.subscribe(() => {
          ;(cb as (p: SystemAppearanceState) => void)(appearanceSnapshot())
        })
      case 'visibility': {
        let last = win.isVisible()
        return useWindowStore.subscribe(() => {
          const next = win.isVisible()
          if (next === last) return
          last = next
          ;(cb as (p: boolean) => void)(next)
        })
      }
      case 'focus':
      case 'blur': {
        let last = win.isFocused()
        return useWindowStore.subscribe(() => {
          const next = win.isFocused()
          if (next === last) return
          last = next
          if (next === (event === 'focus')) (cb as (p: void) => void)(undefined)
        })
      }
      default:
        return () => undefined
    }
  }

  return {
    protocolVersion: PROTOCOL_VERSION,
    appId,
    windowId,

    fs: {
      read: (root, path) => fetchFileBytes(root, path),
      upload: (root, path, bytes, name) => uploadFileBytes(root, path, bytes, name),
      downloadUrl: (root, path) => downloadUrl(root, path),
      pickOpen: (opts = {}) =>
        requestPick({
          mode: 'open',
          title: opts.title ?? 'Open file',
          extensions: opts.extensions,
        }),
      pickSave: (opts = {}) =>
        requestPick({
          mode: 'save',
          title: opts.title ?? 'Save as',
          extensions: opts.extensions,
          suggestedName: opts.suggestedName,
        }),
      pickDirectory: (opts = {}) =>
        requestPick({ mode: 'directory', title: opts.title ?? 'Choose a folder' }),
      recordRecent: (root, path) => recordRecentFile(root, path, appId),
      removeRecent: (root, path) => removeRecentFile(root, path),
    },

    // The escape hatch is the axios client itself, narrowed to the protocol's
    // surface. Structural: nothing is wrapped, so behaviour (interceptors,
    // the 401 → lock-screen drop) is exactly the old `api` import's.
    http: api as unknown as SystemHttp,

    window: win,

    intents: {
      openApp: (target, payload) => openApp(target, payload),
      consume: <T>() =>
        windowId === null
          ? undefined
          : (useIntentStore.getState().consumeIntent(windowId) as T | undefined),
      onIntent: (cb) => {
        if (windowId === null) return () => undefined
        const store = useIntentStore
        // Pending payload first: the launch intent is set before the app mounts.
        const pending = store.getState().consumeIntent(windowId)
        if (pending !== undefined) cb(pending)
        return store.subscribe((state) => {
          const next = state.intents.get(windowId)
          if (next === undefined) return
          store.getState().consumeIntent(windowId)
          cb(next)
        })
      },
      associations: {
        resolveOpener: (name) => resolveOpener(name),
        candidatesFor: (name) => candidatesFor(name),
        allCandidates: () => allOpenerCandidates(),
        keyFor: (name) => associationKey(name),
        openerName: (id) => openerName(id),
        setDefault: (key, id) => useAssociationStore.getState().setDefault(key, id),
      },
    },

    shortcuts: {
      register: (bindings: ShortcutBinding[]) => {
        useShortcutStore.getState().register(bindings.map(({ handler: _h, ...doc }) => doc))
        const unbind = bindHotkeys(bindings)
        return () => {
          unbind()
          useShortcutStore.getState().unregister(bindings.map((b) => b.id))
        }
      },
      document: (docs: ShortcutDoc[]) => {
        useShortcutStore.getState().register(docs)
        return () => useShortcutStore.getState().unregister(docs.map((d) => d.id))
      },
    },

    appearance: { get: appearanceSnapshot },

    schedule: {
      claim: (domain: ScheduleDomain, itemId, occurrenceMs) =>
        claimScheduleOccurrence(domain, itemId, occurrenceMs),
    },

    // Stamped with this handle's app: a capability cannot toast in another
    // app's name, which the old free `notify(...)` import happily allowed.
    notify: (input: SystemNotifyInput) => notify({ ...input, appId }),

    on,
  }
}
