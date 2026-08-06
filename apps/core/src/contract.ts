import { type ComponentType, type LazyExoticComponent } from 'react'
import type { CommandSource } from './shared/commands/CommandSourcesRegistry'

/**
 * A desktop widget an app contributes (brief 96): a small always-visible
 * panel the user can place on the desktop — Win7 gadgets, in the house style.
 *
 * Unlike `desktopLayer` (one free-form surface the app paints itself), a
 * widget is *hosted*: core owns placement, drag, clamping and persistence, so
 * every widget behaves identically and none reimplements the choreography.
 * Contract for the component: render exactly the widget's content (the host
 * draws the frame), be cheap, poll in seconds not frames, and hold no
 * WebSocket.
 */
export type WidgetConfig = {
  /** Unique within the app; the stored key is `<appId>:<id>`. */
  id: string
  /** Shown in the desktop's "Add widget" menu. */
  name: string
  component: ComponentType | LazyExoticComponent<ComponentType>
  /** Fixed size in px — widgets are not resizable (v1). */
  defaultSize: { width: number; height: number }
}

/**
 * The add-on contract. An add-on package (`apps/add-ons/<app>`) exports a
 * single `manifest: AddonManifest` from its entry point; core's
 * `manifest.ts` — the ONE file allowed to import add-on packages —
 * aggregates them into APP_REGISTRY and registers their command sources.
 */
export type AppConfig = {
  id: string
  name: string
  description: string
  meta: string[]
  icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>
  component:
    | ComponentType<{ windowId: string }>
    | LazyExoticComponent<ComponentType<{ windowId: string }>>
  multiInstance: boolean
  defaultSize: { width: number; height: number }
  minSize: { width: number; height: number }
  /**
   * Optional component painted on the **desktop**, beneath every window.
   *
   * The seam exists so Sticky Notes (brief 74) can put notes on the desktop
   * without core importing that package — core knows only "some app contributed a
   * layer", exactly as it knows only "some app contributed a command source".
   *
   * Contract for anything rendering here:
   *
   * - It is mounted once, always, whether or not the app's window is open — that
   *   is the point, and it means the component must be cheap when it has nothing
   *   to draw.
   * - Its wrapper is `pointer-events-none`, so the layer never swallows a click
   *   meant for the wallpaper or an icon. Anything interactive inside it must opt
   *   back in with `pointer-events-auto` on its own element.
   * - It sits **above** the icon grid, because the icon container spans the whole
   *   desktop and would otherwise intercept every click aimed at the layer. Draw
   *   only where the user has actually put something.
   */
  desktopLayer?: ComponentType | LazyExoticComponent<ComponentType>
  /**
   * Optional headless **desktop-lifetime service** (brief 93): mounted by the
   * shell from login to tab close, whether or not any of the app's windows are
   * open, and unmounted when the add-on is disabled.
   *
   * The seam exists so Clock alarms, Calendar reminders and Todo due dates can
   * fire without their windows being open — the three apps used to apologise
   * for exactly this. Contract for anything mounted here:
   *
   * - It renders nothing (`return null`); it exists for effects.
   * - It must be cheap: one slow interval, no per-frame work, no WebSockets.
   * - Anything user-visible it produces goes through `notify(...)`, and any
   *   occurrence-shaped notification must be claimed first (see
   *   `claimScheduleOccurrence`) so a second desktop tab does not double-toast.
   */
  background?: ComponentType
  /** Desktop widgets this app contributes (brief 96) — hosted by core's layer. */
  widgets?: WidgetConfig[]
}

export type AddonManifest = AppConfig & {
  /** Optional command-palette sources this app contributes. */
  commandSources?: CommandSource[]
}
