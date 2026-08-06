import { WindowlessSystemProvider } from '../../system/WindowlessSystemProvider'
import { useEnabledApps } from '../registry/enabledApps'

/**
 * Mounts every enabled add-on's `background` service component (brief 93).
 *
 * Lives in the shell beside the ToastHost: present from login to tab close,
 * regardless of which windows exist. Disabling an add-on in Settings unmounts
 * its service on the next render — the same `useEnabledApps` filter the
 * launcher uses, so "disabled" means gone everywhere at once.
 *
 * Each service gets a **windowless** system handle (brief 48): notifications
 * carry the right appId and `system.schedule`/`system.http` work, while
 * `system.window` is the null-object — a background service has no window to
 * retitle or close, and shared code that tries gets a dev warning, not a crash.
 */
export function BackgroundServices() {
  const apps = useEnabledApps()
  return (
    <>
      {apps.map((app) =>
        app.background ? (
          <WindowlessSystemProvider key={`bg-${app.id}`} appId={app.id}>
            <app.background />
          </WindowlessSystemProvider>
        ) : null
      )}
    </>
  )
}
