import { useWindowStore } from '../store/windowStore'
import { recordRecentFile } from '../../lib/recentFiles'
import { useIntentStore } from '../store/intentStore'
import { APP_REGISTRY } from '../registry/registry'
import { NON_DISABLEABLE } from '../registry/enabledApps'
import { useAddonStore } from '../store/addonStore'

/**
 * Opens an app window with optional payload.
 * If the target is single-instance and already open, focuses the existing window
 * and re-delivers the payload. Otherwise creates a new window.
 * @param appId - The app ID from APP_REGISTRY
 * @param payload - Optional payload to deliver to the app (app-specific shape)
 * @returns The window ID of the opened/focused window
 */
export function openApp(appId: string, payload?: unknown): string {
  // A disabled add-on can't be launched (file routing / commands can't open a
  // hidden app). Non-disableable core apps always open. Existing open windows
  // are unaffected — they render/close via the full registry elsewhere.
  if (useAddonStore.getState().isDisabled(appId) && !NON_DISABLEABLE.has(appId)) {
    return ''
  }

  const appConfig = APP_REGISTRY.find((app) => app.id === appId)
  if (!appConfig) {
    throw new Error(`App "${appId}" not found in registry`)
  }

  // The OS records "file X opened with app Y" here, at the one choke point
  // every launcher funnels through (brief 48). File Manager used to make this
  // call itself, per target app — but attributing a recent to another app is
  // exactly what a scoped capability must forbid, so the shell owns it.
  if (
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as { openPath?: unknown }).openPath === 'string' &&
    typeof (payload as { root?: unknown }).root === 'string'
  ) {
    const p = payload as { openPath: string; root: string }
    recordRecentFile(p.root, p.openPath, appId)
  }

  const windowStore = useWindowStore.getState()
  const intentStore = useIntentStore.getState()

  // Check if single-instance app is already open
  if (!appConfig.multiInstance) {
    const existingWindow = windowStore.windows.find((w) => w.appId === appId)
    if (existingWindow) {
      windowStore.focusWindow(existingWindow.id)
      if (payload !== undefined) {
        intentStore.setIntent(existingWindow.id, payload)
      }
      return existingWindow.id
    }
  }

  // Open new window
  const windowId = windowStore.openWindow(
    appId,
    appConfig.name,
    appConfig.defaultSize,
    appConfig.minSize
  )

  // Stash payload if provided
  if (payload !== undefined) {
    intentStore.setIntent(windowId, payload)
  }

  return windowId
}
