import { Suspense, useCallback, useMemo, useState } from 'react'
import { useWindowStore } from '../../store/windowStore'
import { Window } from './Window'
import { APP_REGISTRY, type AppConfig } from '../../registry/registry'
import { AppErrorBoundary } from './AppErrorBoundary'
import { AppErrorFallback } from './AppErrorFallback'

export function WindowContainer() {
  // Subscribe to the raw windows array — a reference that only changes when the
  // store actually updates. We must NOT project into a fresh array of objects
  // inside the selector: `useShallow` compares only one level deep, so an array
  // of freshly-built objects is never seen as equal. That makes the
  // useSyncExternalStore snapshot change on every call ("getSnapshot should be
  // cached" → infinite render loop the moment a window is open). The projection
  // is done below in useMemo instead, keyed off the stable array reference.
  const windows = useWindowStore((s) => s.windows)

  const orderedWindows = useMemo(
    () =>
      windows
        .map((w) => ({
          id: w.id,
          appId: w.appId,
          zIndex: w.zIndex,
          isVisible: w.isVisible,
        }))
        .sort((a, b) => a.zIndex - b.zIndex),
    [windows]
  )
  const maxZIndex = windows.length > 0 ? Math.max(...windows.map((w) => w.zIndex)) : 0

  return (
    <>
      {orderedWindows.map((w) => (
        <WindowSlot
          key={w.id}
          windowId={w.id}
          app={APP_REGISTRY.find((a) => a.id === w.appId)}
          appId={w.appId}
          isFocused={w.zIndex === maxZIndex && w.isVisible}
        />
      ))}
    </>
  )
}

/**
 * One window and the app inside it.
 *
 * Extracted from the map so each window can own a remount counter — the "Reload"
 * a crashed app offers (brief 47) is a key change, and a key needs state, which a
 * map callback cannot hold.
 *
 * The layering is the point: `Window` renders the chrome and takes the app as
 * children, so the boundary sits **inside** the frame. A crashed app therefore
 * still has a title bar that drags, a taskbar button that focuses it, and a close
 * button that works — putting the chrome inside the boundary would take away the
 * exact controls the user needs to deal with the crash.
 */
function WindowSlot({
  windowId,
  app,
  appId,
  isFocused,
}: {
  windowId: string
  app: AppConfig | undefined
  appId: string
  isFocused: boolean
}) {
  const closeWindow = useWindowStore((s) => s.closeWindow)
  const [remountKey, setRemountKey] = useState(0)

  const reload = useCallback(() => setRemountKey((k) => k + 1), [])
  const close = useCallback(() => closeWindow(windowId), [closeWindow, windowId])

  const AppComponent = app?.component
  const minSize = app?.minSize ?? { width: 240, height: 180 }
  const appName = app?.name ?? appId

  return (
    <Window windowId={windowId} minSize={minSize} isFocused={isFocused}>
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
          <Suspense
            fallback={
              <div className="text-on-surface-variant flex h-full items-center justify-center p-3 text-sm">
                Loading…
              </div>
            }
          >
            <AppComponent windowId={windowId} />
          </Suspense>
        </AppErrorBoundary>
      ) : (
        <div className="text-on-surface-variant p-3 text-sm">Unknown app: {appId}</div>
      )}
    </Window>
  )
}
