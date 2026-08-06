import { useMemo } from 'react'
import { ArrowDown, ArrowUp, Camera, RotateCcw } from 'lucide-react'
import { Button, Checkbox } from '../../shared/components/ui'
import { cn } from '../../lib/cn'
import { APP_REGISTRY } from '../../shared/registry/registry'
import { NON_DISABLEABLE } from '../../shared/registry/enabledApps'
import { useAddonStore } from '../../shared/store/addonStore'
import { useStartupStore } from '../../shared/store/startupStore'
import { useWindowStore } from '../../shared/store/windowStore'
import { startupCandidates } from '../../shared/lib/startup'

/**
 * Settings → Startup (brief 82).
 *
 * Two lists in one panel, because they answer different questions: the **chosen**
 * apps in the order they will open (which is the thing you edit), and everything
 * else you could add. Merging them into one alphabetical checkbox list would make
 * the order — the only reason this is a list rather than a set — invisible.
 *
 * A chosen app that is currently disabled stays in the list and says so rather
 * than vanishing: silently dropping it would lose the setting, and re-enabling the
 * app should bring its startup entry back with it.
 */
export function StartupSettings() {
  const apps = useStartupStore((s) => s.apps)
  const toggle = useStartupStore((s) => s.toggle)
  const move = useStartupStore((s) => s.move)
  const setApps = useStartupStore((s) => s.setApps)
  const clear = useStartupStore((s) => s.clear)
  const disabled = useAddonStore((s) => s.disabled)
  const windows = useWindowStore((s) => s.windows)

  const byId = useMemo(() => new Map(APP_REGISTRY.map((a) => [a.id, a])), [])

  // What boot would actually open, computed by the same function boot uses — so
  // the count under the list cannot drift from behaviour. Not memoised: it is a
  // filter over at most a few dozen ids, and it reads the addon store internally,
  // so a dependency array would either be stale or be a lie eslint objects to.
  const willOpen = startupCandidates(apps)

  const chosen = apps.filter((id) => byId.has(id))
  const available = APP_REGISTRY.filter((app) => !apps.includes(app.id))

  /**
   * "Use my current windows" — the way people actually build this list.
   *
   * Taken in **z-order** rather than open order, so the arrangement you are
   * looking at is the arrangement you get: the front-most window is opened last
   * and therefore ends up in front again. De-duplicated, because two Notepad
   * windows are still one startup entry (brief 82 rejected per-document startup,
   * so a second copy would open the same empty app twice).
   */
  function snapshot() {
    const ordered = useWindowStore.getState().getOrderedWindows()
    setApps(ordered.map((w) => w.appId))
  }

  const isDisabled = (id: string) => disabled.includes(id) && !NON_DISABLEABLE.has(id)

  return (
    <div>
      <p className="text-on-surface-variant mb-4 max-w-prose text-[12px]">
        These open when you sign in, in this order — the last one ends up in front. They open{' '}
        <span className="text-on-surface font-semibold">fresh, at their usual size</span>: window
        positions belong to the tab you arranged them in, not to your account, so a new tab starts
        from the list rather than from someone else&rsquo;s layout.
      </p>

      <div className="mb-3 flex items-center gap-2">
        <Button
          variant="default"
          size="sm"
          className="gap-1"
          disabled={windows.length === 0}
          onClick={snapshot}
          title={
            windows.length === 0
              ? 'Open the windows you want first'
              : 'Replace the list with the windows open right now'
          }
        >
          <Camera size={12} />
          Use my current windows
        </Button>
        <Button
          variant="default"
          size="sm"
          className="gap-1"
          disabled={apps.length === 0}
          onClick={clear}
        >
          <RotateCcw size={12} />
          Clear
        </Button>
      </div>

      {chosen.length === 0 ? (
        <p className="border-outline-variant text-on-surface-variant border border-dashed px-3 py-4 text-[12px]">
          Nothing opens at startup. Tick an app below, or arrange the windows you want and press{' '}
          <span className="text-on-surface font-semibold">Use my current windows</span>.
        </p>
      ) : (
        <ol className="border-outline-variant border">
          {chosen.map((id, index) => {
            const app = byId.get(id)
            if (!app) return null
            const AppIcon = app.icon
            const off = isDisabled(id)
            return (
              <li
                key={id}
                className="border-outline-variant/50 flex items-center gap-2 border-b px-2 py-1.5 last:border-b-0"
              >
                <span className="text-on-surface-variant w-5 shrink-0 text-right text-[11px] tabular-nums">
                  {index + 1}
                </span>
                <span className="border-outline-variant bg-surface-container-lowest text-on-surface flex h-6 w-6 shrink-0 items-center justify-center border">
                  <AppIcon size={13} strokeWidth={1.75} />
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'block truncate text-[12px]',
                      off ? 'text-on-surface-variant line-through' : 'text-on-surface'
                    )}
                  >
                    {app.name}
                  </span>
                  {off && (
                    <span className="text-on-surface-variant block text-[10px]">
                      Turned off in Apps — skipped at startup, kept here so re-enabling restores it
                    </span>
                  )}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Move ${app.name} earlier`}
                  disabled={index === 0}
                  onClick={() => move(id, -1)}
                >
                  <ArrowUp size={12} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Move ${app.name} later`}
                  disabled={index === chosen.length - 1}
                  onClick={() => move(id, 1)}
                >
                  <ArrowDown size={12} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${app.name} from startup`}
                  onClick={() => toggle(id)}
                  className="text-[11px]"
                >
                  Remove
                </Button>
              </li>
            )
          })}
        </ol>
      )}

      <p className="text-on-surface-variant mt-2 text-[11px]">
        {willOpen.length === 0
          ? 'Nothing will open at startup.'
          : `${willOpen.length} app${willOpen.length === 1 ? '' : 's'} will open at startup.`}
      </p>

      {available.length > 0 && (
        <div className="mt-5">
          <p className="font-ui text-on-surface-variant mb-2 text-[11px] font-semibold tracking-widest uppercase">
            Add an app
          </p>
          <div className="border-outline-variant max-h-56 overflow-auto border">
            {available.map((app) => (
              <div
                key={app.id}
                className="border-outline-variant/50 flex items-center gap-2 border-b px-2 py-1.5 last:border-b-0"
              >
                <span className="border-outline-variant bg-surface-container-lowest text-on-surface flex h-6 w-6 shrink-0 items-center justify-center border">
                  <app.icon size={13} strokeWidth={1.75} />
                </span>
                <span className="text-on-surface min-w-0 flex-1 truncate text-[12px]">
                  {app.name}
                </span>
                <Checkbox
                  aria-label={`Open ${app.name} at startup`}
                  checked={false}
                  onCheckedChange={() => toggle(app.id)}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
