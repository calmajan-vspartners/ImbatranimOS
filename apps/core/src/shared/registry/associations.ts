import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { prefsStorage } from '../../lib/prefs'
import { APP_REGISTRY } from './registry'
import { useAddonStore } from '../store/addonStore'
import { NON_DISABLEABLE } from './enabledApps'

/**
 * Which app opens which file, and how the user changes it (brief 81).
 *
 * The table is **computed from `APP_REGISTRY`**, not maintained: each app
 * declares `opens` in its own manifest and core derives extension → candidates.
 * Before this, the association map was a hardcoded constant inside the *file
 * manager*, which meant adding an app required editing another app — the exact
 * coupling `manifest.ts` exists to avoid, and the reason brief 65's PDF
 * mismatch survived so long.
 *
 * Resolution order, and it is the whole feature:
 *
 * 1. the user's choice for that extension, if the app is still available;
 * 2. the first registered candidate in registry order;
 * 3. a **fallback that always resolves to something**.
 *
 * Step 3 is the most valuable part. `handleOpen` used to `return` for an
 * unmapped extension, so double-clicking a `.env`, a `.conf`, a `Dockerfile` or
 * any extensionless file did *nothing at all* — and a dead double-click reads as
 * a broken OS.
 */

/**
 * Where the user's per-extension choices live. A dotfile (brief 49), not session
 * state. Exported so a test can assert it is actually in `DOTFILE_KEYS` — being
 * wired to `prefsStorage` is not sufficient, and the failure is invisible in one
 * browser.
 */
export const ASSOCIATIONS_KEY = 'imbatranimos:file-associations'

/**
 * Names with no extension that are still text, and common dotfiles.
 *
 * Matched on the whole lowercase filename. Without this, the most ordinary files
 * in a project — `Dockerfile`, `Makefile`, `.gitignore`, `.env` — are exactly the
 * ones that dead-end.
 */
const TEXTISH_NAMES = new Set([
  'dockerfile',
  'containerfile',
  'makefile',
  'justfile',
  'procfile',
  'rakefile',
  'gemfile',
  'brewfile',
  'vagrantfile',
  'license',
  'licence',
  'readme',
  'changelog',
  'authors',
  'notice',
  'copying',
  'todo',
  '.gitignore',
  '.gitattributes',
  '.gitmodules',
  '.dockerignore',
  '.npmrc',
  '.nvmrc',
  '.editorconfig',
  '.env',
  '.bashrc',
  '.bash_profile',
  '.profile',
  '.zshrc',
  '.inputrc',
  '.vimrc',
  '.prettierrc',
  '.eslintrc',
  '.babelrc',
])

/**
 * Extensions that are text but that no app claims by name.
 *
 * Kept short on purpose: this is the "obviously text, nobody asked for it" list,
 * not a second association table. Anything an app genuinely wants belongs in that
 * app's `opens`.
 */
const TEXTISH_EXTENSIONS = new Set([
  'env',
  'ini',
  'conf',
  'cfg',
  'config',
  'properties',
  'lock',
  'gitignore',
  'gitconfig',
  'editorconfig',
  'diff',
  'patch',
  'text',
  'nfo',
  'srt',
  'vtt',
  'csv2',
  'tsv',
  'jsonl',
  'ndjson',
  'jsonc',
  'json5',
  'lua',
  'pl',
  'r',
  'kt',
  'swift',
  'scala',
  'clj',
  'ex',
  'exs',
  'erl',
  'hs',
  'dart',
  'zig',
  'nim',
  'vue',
  'svelte',
  'astro',
  'scss',
  'sass',
  'less',
  'styl',
  'graphql',
  'gql',
  'proto',
  'bat',
  'ps1',
  'zsh',
  'fish',
  'bash',
  'mk',
  'cmake',
  'gradle',
  'tf',
  'tfvars',
  'nix',
  'service',
  'desktop',
])

/** The app text falls back to when nothing claims the file. */
export const TEXT_FALLBACK_APP = 'code-editor'

/**
 * The apps that open text. Anything **they** claim is text by definition.
 *
 * Derived rather than listed, and that fixes a real hole: `.md` was not in
 * `TEXTISH_EXTENSIONS`, so disabling Markdown Editor made every `.md` dead-end —
 * precisely the "disabling the owner must fall back" case the brief calls out.
 * Enumerating every claimed text extension a second time would be the same class
 * of duplication `opens` exists to remove, so the question is asked of the
 * registry instead. Membership ignores whether the app is currently *enabled*:
 * `.md` is text whether or not you can still open it in Markdown Editor.
 */
const TEXT_APP_IDS = ['code-editor', 'notepad', 'markdown-editor'] as const

/**
 * The default when more than one app claims an extension.
 *
 * The brief proposed "first in registry order wins", and that would have
 * **silently reversed brief 65**: `pdfViewer` is registered before `norpdf`, so
 * `.pdf` would have gone back to the 340-line viewer that brief 65 deliberately
 * demoted. Registry order is an incidental property — it drives desktop icon
 * layout — and using it to decide file associations couples two unrelated things,
 * so a contested extension gets a decision written down instead.
 *
 * This is one line per genuinely contested type, not a second association table:
 * every uncontested extension still comes straight from the app's own `opens`.
 */
const PREFERRED_DEFAULT: Record<string, string> = {
  // Brief 65: norPDF is a strict superset (outline, search, annotate, forms,
  // a real save path). PDF Viewer stays the light option, via Open with.
  pdf: 'norpdf',
}

/**
 * The extension for association purposes, or the whole lowercase name when there
 * is none.
 *
 * A dotfile like `.env` has no extension in the usual sense — `split('.')` on it
 * yields `['', 'env']` — so treating a leading dot as a separator would classify
 * `.gitignore` as a `gitignore` file. Both spellings are handled: the name is
 * checked against {@link TEXTISH_NAMES} first.
 */
export function extensionOf(fileName: string): string {
  const name = fileName.toLowerCase()
  const lastDot = name.lastIndexOf('.')
  if (lastDot <= 0) return '' // no dot, or a leading-dot name like `.env`
  return name.slice(lastDot + 1)
}

/** True when this file should open in a text editor if nothing else claims it. */
export function isTextish(fileName: string): boolean {
  const name = fileName.toLowerCase()
  if (TEXTISH_NAMES.has(name)) return true
  const ext = extensionOf(name)
  if (ext === '') return true // extensionless and unknown: text is the safe guess
  if (TEXTISH_EXTENSIONS.has(ext)) return true
  return APP_REGISTRY.some(
    (app) =>
      (TEXT_APP_IDS as readonly string[]).includes(app.id) &&
      (app.opens ?? []).some((claim) => claim.toLowerCase() === ext)
  )
}

/** One app that can open a given file. */
export interface OpenCandidate {
  appId: string
  name: string
}

interface AssociationState {
  /** extension (or bare filename) → appId the user chose. */
  overrides: Record<string, string>
  setDefault: (extension: string, appId: string) => void
  clearDefault: (extension: string) => void
  clearAll: () => void
}

export const useAssociationStore = create<AssociationState>()(
  persist(
    (set) => ({
      overrides: {},
      setDefault: (extension, appId) =>
        set((s) => ({ overrides: { ...s.overrides, [extension]: appId } })),
      clearDefault: (extension) =>
        set((s) => {
          const { [extension]: _removed, ...rest } = s.overrides
          return { overrides: rest }
        }),
      clearAll: () => set({ overrides: {} }),
    }),
    {
      name: ASSOCIATIONS_KEY,
      /**
       * A dotfile (brief 49): "open `.md` in the code editor" is user config that
       * should follow the account, not a per-tab session choice.
       */
      storage: createJSONStorage(() => prefsStorage),
    }
  )
)

/** True when this app is available to open things right now. */
function isAvailable(appId: string): boolean {
  if (NON_DISABLEABLE.has(appId)) return true
  return !useAddonStore.getState().isDisabled(appId)
}

/**
 * Every app that declares it can open this file, in registry order.
 *
 * A **disabled** app is excluded (brief 46): offering to open a file with an app
 * the user has hidden would be an offer the OS cannot keep, and disabling the app
 * that owned an extension has to fall back rather than dead-end.
 */
export function candidatesFor(fileName: string): OpenCandidate[] {
  const ext = extensionOf(fileName)
  const name = fileName.toLowerCase()
  return APP_REGISTRY.filter((app) => {
    if (!app.opens || !isAvailable(app.id)) return false
    return app.opens.some((claim) => {
      const c = claim.toLowerCase()
      return c === ext || c === name
    })
  }).map((app) => ({ appId: app.id, name: app.name }))
}

/** Every app that could plausibly open anything — the "Open with…" long list. */
export function allOpenerCandidates(): OpenCandidate[] {
  return APP_REGISTRY.filter((app) => app.opens && app.opens.length > 0 && isAvailable(app.id)).map(
    (app) => ({ appId: app.id, name: app.name })
  )
}

export interface Resolution {
  appId: string
  /** Why this app: the user picked it, an app claims the type, or it is the fallback. */
  reason: 'override' | 'declared' | 'text-fallback' | 'none'
}

/**
 * Which app should open `fileName`. **Never returns nothing for a text-ish file.**
 *
 * `reason: 'none'` means genuinely unopenable — an unknown binary — and the caller
 * is expected to offer a chooser rather than silently doing nothing. That is the
 * one case where "we don't know" is the honest answer, and it still ends in a
 * dialog, not a dead click.
 */
export function resolveOpener(fileName: string): Resolution {
  const ext = extensionOf(fileName)
  const key = ext === '' ? fileName.toLowerCase() : ext
  const override = useAssociationStore.getState().overrides[key]
  if (override && isAvailable(override) && APP_REGISTRY.some((a) => a.id === override)) {
    return { appId: override, reason: 'override' }
  }

  const declared = candidatesFor(fileName)
  if (declared.length > 0) {
    const preferred = PREFERRED_DEFAULT[key]
    const winner =
      preferred && declared.some((c) => c.appId === preferred) ? preferred : declared[0].appId
    return { appId: winner, reason: 'declared' }
  }

  if (isTextish(fileName) && isAvailable(TEXT_FALLBACK_APP)) {
    return { appId: TEXT_FALLBACK_APP, reason: 'text-fallback' }
  }
  return { appId: '', reason: 'none' }
}

/** The association key a "always use this" choice should be stored under. */
export function associationKey(fileName: string): string {
  const ext = extensionOf(fileName)
  return ext === '' ? fileName.toLowerCase() : ext
}

/** An app's display name, for a label. Add-ons do not get the registry itself. */
export function openerName(appId: string): string | null {
  return APP_REGISTRY.find((a) => a.id === appId)?.name ?? null
}

/**
 * Every extension any app claims, sorted — the rows Settings shows.
 *
 * Built from the registry rather than a list, so a new app's types appear in
 * Default apps the moment it is added, with no second place to update.
 */
export function knownExtensions(): string[] {
  const seen = new Set<string>()
  for (const app of APP_REGISTRY) {
    for (const claim of app.opens ?? []) seen.add(claim.toLowerCase())
  }
  return [...seen].sort()
}
