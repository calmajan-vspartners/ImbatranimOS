import { useEnabledApps } from '../registry/enabledApps'

/**
 * Mounts every enabled add-on's `background` service component (brief 93).
 *
 * Lives in the shell beside the ToastHost: present from login to tab close,
 * regardless of which windows exist. Disabling an add-on in Settings unmounts
 * its service on the next render — the same `useEnabledApps` filter the
 * launcher uses, so "disabled" means gone everywhere at once.
 */
export function BackgroundServices() {
  const apps = useEnabledApps()
  return <>{apps.map((app) => (app.background ? <app.background key={`bg-${app.id}`} /> : null))}</>
}
