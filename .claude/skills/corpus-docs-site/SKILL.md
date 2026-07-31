---
name: corpus-docs-site
description: Scaffold a light-themed Starlight documentation site into a corpus-flow project — the NARRATIVE (architecture, decisions, status, roadmap) rendered from the corpus/ wiki, and the API REFERENCE generated from the TypeScript (Compodoc for a NestJS backend, TypeDoc for a package's public barrel), wired as one monorepo task so both stay current. Use when the user says "write docs for this project", "build a docs site", "docs from the corpus", "generate API docs", "reproduce the ImbatranimOS docs", "a docs site like the OS one", or "/corpus-docs-site". Assumes a corpus/ (see corpus-flow) and a TypeScript codebase; adapts the reference half to whatever exists.
---

# Corpus Docs Site (Starlight + generated reference)

Drop a documentation site into any **corpus-flow** project. Two halves, kept
honest by construction:

- **Narrative → rendered.** Architecture, decisions, status, roadmap already
  live as markdown in `corpus/wiki/` (+ `status.md`, `log.md`). A sync script
  renders them into the site. Design intent is *authored*, never
  reverse-engineered from code.
- **Reference → generated.** Module/route/DI graphs and the public API surface
  are *in the code*. Generators emit them on every build so they can't drift:
  **Compodoc** for a NestJS backend, **TypeDoc** for a TypeScript package's
  public barrel.

The house style is **light-theme-only, short, and graphic** (stat tiles, card
grids, small diagram components) — the look validated on the ImbatranimOS docs.

This maps to "Solution B + C" of the docs-tooling decision: generate reference
from code (B), compose it with a Starlight site over the corpus (C). The
throwaway single-file HTML render (Solution A) is intentionally *not* what this
builds.

## When to use / not

- **Use:** a project that already has a `corpus/` (or will — bootstrap it with
  `corpus-flow` first) and TypeScript source, and wants a browsable docs site
  that regenerates from source. Ideal for the corpus-flow + monorepo shape
  (npm workspaces + turbo/nx), with a NestJS backend and/or a shared TS package.
- **Don't use:** a project with no corpus (use `corpus-flow` to create one, or
  just write a README); a non-TypeScript codebase (the reference half won't
  apply — you can still do the narrative half); or when the user explicitly
  wants a single throwaway HTML file (that's Solution A — hand-render one page,
  don't scaffold a framework).

## Prerequisites (verify first)

- **Node ≥ 20.19 / 22.12 / 24** (Compodoc 2.x and Astro 5+/7 require it).
- A `corpus/` at the repo root with a `wiki/` directory (and usually
  `status.md`, `log.md`). If absent, run `corpus-flow` first — this skill
  *renders* a corpus, it doesn't invent one.
- The task runner in use (turbo, nx, or plain npm workspaces) and the
  workspace globs in the root `package.json`.

Confirm tool/TS compatibility before installing (versions move): the current
**TypeDoc supports the repo's TypeScript major**, and **Compodoc's engines
allow the repo's Node**. Check with `npm view typedoc peerDependencies` and
`npm view @compodoc/compodoc engines`.

## Procedure

### Phase 0 — Detect the project shape (report before writing)

Inspect and decide:
- **Corpus pages:** list `corpus/wiki/*.md` + whether `status.md`/`log.md`
  exist. These become the narrative pages (the sync script auto-discovers them).
- **Backend reference?** Is there a NestJS app (a `nest-cli.json`, `@nestjs/*`
  deps, a `tsconfig.json`)? → Compodoc applies. Note its path + tsconfig.
- **Package reference?** Is there a TS package with a deliberate *public barrel*
  (e.g. `apps/core/src/index.ts`, a `exports`/`types` entry)? → TypeDoc applies.
  Note the entry point + the tsconfig that compiles it (`tsconfig.app.json` for
  a Vite app, else `tsconfig.json`).
- **Where the site lives:** a new workspace package, conventionally
  `apps/docs/`. **Check existing workspace package names for a collision**
  before naming it — see Gotchas.
- **Accent color + title** for the light theme.

Tell the user the detected shape (which reference generators apply, the site
path, the accent) before scaffolding.

### Phase 1 — Scaffold the site package

Create `apps/docs/` (adjust path to the repo). Copy the reference files:

| From `references/` | To |
|---|---|
| `sync-corpus.mjs` | `apps/docs/scripts/sync-corpus.mjs` |
| `ThemeProvider.astro` | `apps/docs/src/components/ThemeProvider.astro` |
| `ThemeSelect.astro` | `apps/docs/src/components/ThemeSelect.astro` |
| `Metrics.astro` | `apps/docs/src/components/Metrics.astro` |
| `theme.css` | `apps/docs/src/styles/theme.css` |
| `typedoc.json` | `apps/docs/typedoc.json` (only if TypeDoc applies) |

Then edit the placeholders: `GITHUB_BLOB_BASE` in `sync-corpus.mjs`, the accent
in `theme.css` / `Metrics.astro`, and `entryPoints`/`tsconfig`/`name` in
`typedoc.json`.

**`apps/docs/package.json`** — name it to avoid a collision (Gotchas), and
include only the generators that apply:

```jsonc
{
  "name": "@scope/docs-site",
  "version": "1.0.0", "private": true, "type": "module",
  "scripts": {
    "sync-corpus": "node scripts/sync-corpus.mjs",
    "ref:core": "typedoc",
    "ref:backend": "compodoc -p ../backend/tsconfig.json -d public/reference/backend -n \"Backend API\" --hideGenerator --coverageTest 35 --theme material",
    "ref": "npm run ref:core && npm run ref:backend",
    "predev": "npm run sync-corpus",
    "dev": "astro dev",
    "docs": "npm run sync-corpus && npm run ref && astro build",
    "preview": "astro preview"
  },
  "devDependencies": {
    "@astrojs/starlight": "^0.41.0",
    "@compodoc/compodoc": "^2.0.0",
    "astro": "^7.0.0",
    "sharp": "^0.34.0",
    "typedoc": "^0.28.0"
  }
}
```

**`apps/docs/tsconfig.json`:**
```json
{ "extends": "astro/tsconfigs/strict", "include": [".astro/types.d.ts", "**/*"], "exclude": ["dist", "public/reference"] }
```

**`apps/docs/src/content.config.ts`:**
```ts
import { defineCollection } from 'astro:content'
import { docsLoader } from '@astrojs/starlight/loaders'
import { docsSchema } from '@astrojs/starlight/schema'
export const collections = { docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }) }
```

**`apps/docs/astro.config.mjs`** — Starlight with the light-only overrides and a
sidebar. Auto-discovered corpus pages live under `/wiki/<slug>/`; add sidebar
entries for the ones worth surfacing:
```js
import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'
export default defineConfig({
  integrations: [starlight({
    title: 'PROJECT',
    customCss: ['./src/styles/theme.css'],
    components: {
      ThemeProvider: './src/components/ThemeProvider.astro', // light-only
      ThemeSelect: './src/components/ThemeSelect.astro',     // remove toggle
    },
    social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/OWNER/REPO' }],
    sidebar: [
      { label: 'Start here', items: [ { label: 'Overview', link: '/' }, { label: 'Architecture', link: '/architecture/' } ] },
      { label: 'Design & architecture', items: [
        { label: 'Architecture', link: '/wiki/architecture/' },
        { label: 'Decisions', link: '/wiki/decisions/' },
      ] },
      { label: 'Status & roadmap', items: [ { label: 'Status', link: '/wiki/status/' }, { label: 'Change log', link: '/wiki/log/' } ] },
      { label: 'API reference', items: [
        { label: 'How it is generated', link: '/reference/' },
        { label: 'Backend (Compodoc) ↗', link: '/reference/backend/', attrs: { target: '_blank' } },
        { label: 'Core (TypeDoc) ↗', link: '/reference/core/', attrs: { target: '_blank' } },
      ] },
    ],
  })],
})
```

### Phase 2 — Author the few hand-written pages (short + graphic)

Keep these punchy — the deep prose is the synced corpus. Write in `.mdx`:
- **`src/content/docs/index.mdx`** — `template: splash` hero + a `<Metrics>` row
  + a `<CardGrid>` of 3–4 "core ideas" (short) + a two-card "docs in two halves"
  block. Import components with a **relative** path
  (`../../components/Metrics.astro`).
- **`src/content/docs/architecture.mdx`** — one-line thesis + a small **diagram
  component** (write a bespoke `LayerStack.astro`-style component per project;
  use literal light colors, see Gotchas) + card grids for the key concepts +
  `<Aside>` links into the synced `/wiki/` pages for depth.
- **`src/content/docs/reference.mdx`** — two cards linking to
  `/reference/backend/` and `/reference/core/`, the regenerate command, and one
  `<Aside>` on the coverage gate.

Use Starlight's built-in components for "graphic" without new deps: `Card`,
`CardGrid`, `Steps`, `Aside`, `Badge`, `Tabs`. Reserve custom `.astro`
components (with **scoped** `<style>`) for diagrams and stat tiles.

### Phase 3 — Wire the monorepo + gitignore

- Add the site to the root `package.json` `workspaces` (e.g. `"apps/docs"`).
- Add a root script. **turbo:** `"docs": "turbo run docs"` (note `run` — see
  Gotchas) and a `docs` task in `turbo.json` with `inputs` covering
  `src/**`, `scripts/**`, `astro.config.mjs`, `typedoc.json`, the referenced
  `../<pkg>/src/**`, and `../../corpus/**`; `outputs` = `dist/**`,
  `public/reference/**`. **nx/npm:** add an equivalent target.
- **Gitignore the generated artifacts** (they rebuild): `apps/docs/dist/`,
  `apps/docs/.astro/`, `apps/docs/public/reference/`,
  `apps/docs/src/content/docs/wiki/`, plus Compodoc's stray `.compodoc/` /
  `documentation/` if they appear.
- Add an `apps/docs/README.md` stating the two-halves contract and "edit the
  corpus, not `src/content/docs/wiki/`".

### Phase 4 — Install, run, verify

```bash
npm install                 # from repo root (registers the new workspace)
cd apps/docs && npm run docs   # sync + generate reference + astro build
```
Then **verify visually** — this house style is a visual deliverable:
```bash
npm run preview             # serve dist/ (note the printed port)
```
Open the landing + architecture pages in a browser and screenshot. Check:
white background, no theme toggle in the header, stat tiles render **white with
dark numbers** (not black — see Gotchas), diagram legible, `/reference/backend`
and `/reference/core` load. Confirm the root `npm run docs` is green too.

## Gotchas (hard-won — do not relearn)

1. **Package-name collision.** Corpus projects often already have a doc-editor
   or `docs` add-on. Naming the site package `@scope/docs` fails npm install
   with `EDUPLICATEWORKSPACE`. Use `@scope/docs-site`. Check existing names
   first: `grep -r '"name"' apps/*/package.json`.
2. **Starlight's `--sl-color-white` / `--sl-color-black` are contrast-relative**,
   not literal. In light mode `--sl-color-white` resolves to near-**black**. In
   custom light-only components use **literal** colors (`#fff` background,
   `#17171a` text) — the shipped `Metrics.astro` already does. (Symptom: stat
   tiles render black on a white page.)
3. **`turbo docs` is ambiguous** — turbo reads `docs` as a subcommand and errors
   (`required arguments: <QUERY>`). Use **`turbo run docs`**.
4. **Compodoc has no `--disableCoverage=false` flag.** Coverage is on by
   default; just set `--coverageTest <n>`. And set the threshold **just below
   the current coverage** (run once, read the reported %, set a hair under it) —
   a threshold above current fails the first build. Ratchet it up over time.
5. **TypeDoc rejects unknown config keys.** Don't add a `comment`/notes field to
   `typedoc.json`; it throws. Put rationale in the README.
6. **TypeDoc coverage is warnings, not a gate, by default.** `validation.
   notDocumented: true` surfaces undocumented exports as build **warnings**
   (non-fatal). To hard-fail CI, flip `treatWarningsAsErrors: true` — but only
   once the barrel is actually documented, or the first build breaks.
7. **Corpus frontmatter ≠ Starlight schema.** Corpus pages use
   `summary:`/`updated:`; Starlight needs `title:`. The sync script derives
   `title` from the first `# H1` (and strips it to avoid a duplicate heading)
   and maps `summary` → `description`. Don't point Starlight's `docsLoader` at
   `corpus/` directly — it will fail schema validation.
8. **Never edit `src/content/docs/wiki/*`** — it's overwritten every sync. The
   source is `corpus/`.
9. **Sitemap warning is benign.** `@astrojs/sitemap` wants a `site` URL; set
   `site`/`base` in `astro.config.mjs` when deploying under a path (e.g. a Caddy
   `/docs` route), otherwise ignore.
10. **The generated reference sub-sites have their own theming.** Compodoc's
    `material` theme is light; **TypeDoc follows the visitor's OS preference**.
    For strict light-only across `/reference/`, inject a small custom CSS via
    TypeDoc's `customCss` option that forces its light variables. Mention this
    trade-off to the user rather than silently leaving a dark-mode escape.

## Deliverables checklist

- [ ] `apps/docs/` scaffolded; workspace + root `docs` script + turbo/nx task.
- [ ] `sync-corpus.mjs` renders every `corpus/wiki/*` (+ status/log); links
      remapped; generated dir gitignored.
- [ ] Reference generated for each half that applies (Compodoc / TypeDoc) into
      `public/reference/`; coverage threshold set just under current.
- [ ] Light-only enforced (both component overrides), no theme toggle.
- [ ] Landing + architecture + reference pages authored, short and graphic.
- [ ] `npm run docs` green from root; verified in a browser (white, tiles
      correct, reference loads).
