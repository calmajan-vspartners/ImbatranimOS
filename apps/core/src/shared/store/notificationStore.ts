import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** Visual severity of a notification — drives icon + accent stripe only. */
export type NotificationLevel = 'info' | 'success' | 'warning' | 'error'

/**
 * A toast button (brief 107) — intent-shaped data, never a closure, so it can
 * ride the persisted history and outlive the window that raised it.
 */
export type NotificationAction = {
  label: string
  payload: unknown
}

/** A recorded notification (lives in history until removed/cleared). */
export type NotificationItem = {
  id: string
  title: string
  body?: string
  /** Raising app's id — used for the item icon and click-to-open. */
  appId?: string
  level: NotificationLevel
  /** epoch ms */
  timestamp: number
  read: boolean
  /** Rendered on the live toast only; harmless (and inert) in history. */
  actions?: readonly NotificationAction[]
}

/** Shape callers pass to `notify(...)`. */
export type NotifyInput = {
  title: string
  body?: string
  appId?: string
  level?: NotificationLevel
  actions?: readonly NotificationAction[]
}

/** History is bounded so persisted storage can't grow without limit. */
const MAX_HISTORY = 100

type NotificationStore = {
  /** Full history, newest first. Persisted. */
  notifications: NotificationItem[]
  /** Ids currently shown as live toasts. In-memory only (never persisted). */
  toasts: string[]
  /** Do Not Disturb: still records history, but shows no toast. Persisted. */
  dnd: boolean

  /** Raise a notification. Records history + (unless DnD) shows a toast. */
  notify: (input: NotifyInput) => string
  /** Remove a toast from the live stack (stays in history). */
  dismissToast: (id: string) => void
  markRead: (id: string) => void
  markAllRead: () => void
  /** Remove a single item from history (and any live toast). */
  remove: (id: string) => void
  /** Empty the whole history and clear live toasts. */
  clearAll: () => void
  setDnd: (dnd: boolean) => void
}

const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `n-${Date.now()}-${Math.floor(Math.random() * 1e9)}`

export const useNotificationStore = create<NotificationStore>()(
  persist(
    (set) => ({
      notifications: [],
      toasts: [],
      dnd: false,

      notify: (input) => {
        const id = newId()
        const item: NotificationItem = {
          id,
          title: input.title,
          body: input.body,
          appId: input.appId,
          level: input.level ?? 'info',
          timestamp: Date.now(),
          read: false,
          // Only kept when non-empty, so every existing caller's item shape —
          // and its persisted JSON — is byte-identical to before.
          ...(input.actions?.length ? { actions: input.actions } : {}),
        }
        set((state) => ({
          notifications: [item, ...state.notifications].slice(0, MAX_HISTORY),
          toasts: state.dnd ? state.toasts : [id, ...state.toasts],
        }))
        return id
      },

      dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t !== id) })),

      markRead: (id) =>
        set((state) => ({
          notifications: state.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
        })),

      markAllRead: () =>
        set((state) => ({
          notifications: state.notifications.map((n) => (n.read ? n : { ...n, read: true })),
        })),

      remove: (id) =>
        set((state) => ({
          notifications: state.notifications.filter((n) => n.id !== id),
          toasts: state.toasts.filter((t) => t !== id),
        })),

      clearAll: () => set({ notifications: [], toasts: [] }),

      setDnd: (dnd) => set({ dnd }),
    }),
    {
      name: 'imbatranimos:notifications',
      // Live toasts are session-only — a toast must never resurrect on reload.
      partialize: (state) => ({ notifications: state.notifications, dnd: state.dnd }),
    }
  )
)

/**
 * Imperative entry point add-ons import from `@imbatranim/core`. Mirrors
 * `openApp` — callable from any code (React or not). Returns the new id.
 */
export function notify(input: NotifyInput): string {
  return useNotificationStore.getState().notify(input)
}
