/**
 * @imbatranim/core — what is left of the public surface after brief 48: the
 * add-on CONTRACT, and nothing else.
 *
 * Everything an app does at runtime now arrives through the injected `system`
 * handle (see `@imbatranim/ui`'s `system.ts`, which IS the protocol spec), and
 * everything it renders with comes from `@imbatranim/ui`. What remains here is
 * the registration contract — the types `manifest.ts` composes — and types are
 * erased at build time, so nothing importable from this barrel can couple an
 * app bundle to the OS. Eslint enforces exactly that in every add-on:
 * `@imbatranim/core` is type-only.
 *
 * Adding a VALUE export back here is not a convenience — it is a hole in the
 * seam. If an app needs a new ability, it goes on the `SystemHandle` protocol,
 * as an API decision.
 */

export type { AppConfig, AddonManifest, WidgetConfig } from './contract'
export type {
  CommandSource,
  CommandSourceContext,
  CommandItem,
} from './shared/commands/CommandSourcesRegistry'
