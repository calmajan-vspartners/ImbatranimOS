import { type ComponentType, type LazyExoticComponent } from 'react'
import type { CommandSource } from './shared/commands/CommandSourcesRegistry'

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
}

export type AddonManifest = AppConfig & {
  /** Optional command-palette sources this app contributes. */
  commandSources?: CommandSource[]
}
