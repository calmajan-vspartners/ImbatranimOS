import { Suspense, memo, useCallback, useMemo, useState } from 'react'
import { useShallow } from 'zustand/shallow'
import { topVisibleWindowId, useWindowStore } from '../../store/windowStore'
import { Window } from './Window'
import { APP_REGISTRY, type AppConfig } from '../../registry/registry'
import { SystemProvider } from '@imbatranim/ui'
import { createSystemHandle } from '../../../system/createSystemHandle'
import { AppErrorBoundary } from './AppErrorBoundary'
import { AppErrorFallback } from './AppErrorFallback'

// Field separator for the per-window projection key. `␟` (SYMBOL FOR UNIT
// SEPARATOR) cannot occur in a uuid or an app-id slug, so splitting is safe.
const SEP = '␟'

/**
 * Subscribe to a projection that deliberately omits `position`/`size`, so the
 * ~60fps geometry churn of a drag/resize does NOT re-render this container —
 * only a change to identity, stacking order (zIndex), visibility or workspace
 * does. `useShallow` caches the array while the projected strings are unchanged;
 * projecting to *objects* would defeat it (freshly-built objects are never
 * shallow-equal), the trap the old raw-`windows` subscription fell into.
 */
function useOrderedWindows(): {
  id: string
  appId: string
  zIndex: number
  isVisible: boolean
  workspaceId: number
}[] {
  const keys = useWindowStore(
    useShallow((s) =>
      s.windows.map(
        (w) =>
          `${w.id}${SEP}${w.appId}${SEP}${w.zIndex}${SEP}${w.isVisible ? 1 : 0}${SEP}${w.workspaceId}`
      )
    )
  )
  return keys
    .map((k) => {
      const [id, appId, zIndex, isVisible, workspaceId] = k.split(SEP)
      return {
        id,
        appId,
        zIndex: Number(zIndex),
        isVisible: isVisible === '1',
        workspaceId: Number(workspaceId),
      }
    })
    .sort((a, b) => a.zIndex - b.zIndex)
}

export function WindowContainer() {
  const orderedWindows = useOrderedWindows()
  const activeWorkspace = useWindowStore((s) => s.activeWorkspace)
  // The one shared definition of "focused", now workspace-scoped (brief 85):
  // the taskbar highlight, window chrome and every window-scoped hotkey read
  // this same helper so they can never disagree.
  const focusedId = topVisibleWindowId()

  return (
    // Own stacking context: window zIndex grows unboundedly (persisted, bumped
    // on every focus), so left in the root context it would climb past portaled
    // overlays and swallow dialogs/selects/tooltips. `isolation:isolate` confines
    // the whole window band to this wrapper; overlays sit in a higher band above it.
    <div style={{ isolation: 'isolate' }}>
      {/*
        EVERY window is rendered, on every workspace — a window on an inactive
        workspace is hidden with `display:none`, exactly as a minimised one is,
        NOT unmounted. Filtering the list here would look identical and be
        badly wrong: switching workspaces would tear down the Terminal's PTY
        socket, throw away an editor's unsaved buffer, and restart every
        in-flight request, once per switch. Real virtual desktops hide windows;
        they do not close them.
      */}
      {orderedWindows.map((w) => (
        <WindowSlot
          key={w.id}
          windowId={w.id}
          app={APP_REGISTRY.find((a) => a.id === w.appId)}
          appId={w.appId}
          isFocused={w.id === focusedId}
          onActiveWorkspace={w.workspaceId === activeWorkspace}
        />
      ))}
    </div>
  )
}

/**
 * One window and the app inside it.
 *
 * Extracted from the map so each window can own a remount counter — the "Reload"
 * a crashed app offers (brief 47) is a key change, and a key needs state, which a
 * map callback cannot hold. Memoised so that when the container re-renders (a
 * zIndex bump, a visibility or workspace change), only the windows whose props
 * actually changed re-render.
 *
 * The layering is the point: `Window` renders the chrome and takes the app as
 * children, so the boundary sits **inside** the frame. A crashed app therefore
 * still has a title bar that drags, a taskbar button that focuses it, and a close
 * button that works — putting the chrome inside the boundary would take away the
 * exact controls the user needs to deal with the crash.
 */
const WindowSlot = memo(function WindowSlot({
  windowId,
  app,
  appId,
  isFocused,
  onActiveWorkspace,
}: {
  windowId: string
  app: AppConfig | undefined
  appId: string
  isFocused: boolean
  onActiveWorkspace: boolean
}) {
  const closeWindow = useWindowStore((s) => s.closeWindow)
  const [remountKey, setRemountKey] = useState(0)

  const reload = useCallback(() => setRemountKey((k) => k + 1), [])
  const close = useCallback(() => closeWindow(windowId), [closeWindow, windowId])

  // One handle per (app, window) mount, stable across renders — hooks key
  // their effects on it, and a fresh object per render would re-bind them all.
  const system = useMemo(() => createSystemHandle(appId, windowId), [appId, windowId])

  const AppComponent = app?.component
  const minSize = app?.minSize ?? { width: 240, height: 180 }
  const appName = app?.name ?? appId

  return (
    <Window
      windowId={windowId}
      minSize={minSize}
      isFocused={isFocused}
      onActiveWorkspace={onActiveWorkspace}
    >
      {AppComponent ? (
        <AppErrorBoundary
          // Bumping the key remounts the boundary AND the app beneath it, which
          // is what makes Reload a real recovery rather than a re-render of the
          // state that just threw.
          key={remountKey}
          appId={appId}
          appName={appName}
          fallback={(error) => (
            <AppErrorFallback appName={appName} error={error} onReload={reload} onClose={close} />
          )}
        >
          {/* Inside the boundary on purpose: a lazy chunk that fails to load
              throws, and that is a crash the user should see handled the same
              way as any other. */}
          {/* The seam (brief 48): the compositor hands the app its one
              connection to the OS here. Scoped to this app in this window —
              `system.window.*` cannot address anything else. */}
          <SystemProvider system={system}>
            <Suspense
              fallback={
                <div className="text-on-surface-variant flex h-full items-center justify-center p-3 text-sm">
                  Loading…
                </div>
              }
            >
              <AppComponent windowId={windowId} />
            </Suspense>
          </SystemProvider>
        </AppErrorBoundary>
      ) : (
        <div className="text-on-surface-variant p-3 text-sm">Unknown app: {appId}</div>
      )}
    </Window>
  )
})
