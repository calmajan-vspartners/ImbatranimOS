# Task 93 — Code-health sweep: fixes, optimizations, hardening (2026-08-06 audit)

> **Ungrilled research findings**, like the 2026-07-31 backlog: a six-lane deep
> audit (backend, core shell, heavy add-ons, light add-ons, @pdfcore/engine,
> infra/build) run 2026-08-06 at commit `aaa128b`. Grill before building; the
> tiers below are a proposed order, not a locked plan. Every item was verified
> against the code (file:line quoted); items marked **[proven]** were
> additionally demonstrated by an executed repro or a turbo hash/npm-install
> simulation during the audit.

## Context

Baseline at audit time: **all gates green** — 26 typecheck tasks, 23 test
tasks (backend 287, engine 82, core 60, plus per-app suites). None of the
findings below are caught by existing gates, which is itself finding T3-7
(strictness inversion) and the test-gap list at the bottom.

The audit deliberately excluded everything already tracked: open briefs 15,
47–51, 78, 80–82, 84–85, the todos (CSP connect-src, drag-selection,
install-from-github, kiosk sandbox, TOTP recovery), the `uuid` audit findings,
and the rejection list in [real-os-gaps](../../wiki/real-os-gaps.md).

Audited-and-clean (worth recording so it isn't re-audited): PTY lifecycle +
backpressure, git exec seam + `assertRefName`, HTTP-proxy redirect/credential
handling, archive jail (zip-slip/ratio caps), all sqlite multi-statement
transactions, sheets worker request-id correlation, docs SuperDoc lifecycle,
timer/stopwatch timestamp model, sticky-notes clamp/pointer-capture,
system-monitor ring buffer, file-manager sort/virtualizer unification,
`useElementSize`, `useConfirm`/`usePrompt`, notification store bounds,
pdf-viewer's pdf.js teardown (correct — which is how the engine's missing
teardown stood out).

## Files you OWN

Everything the items below name under `apps/backend/`, `apps/core/`,
`apps/add-ons/*/`, `packages/pdfcore-engine/`, `infrastructure/`, `iso/`,
`turbo.json`, root `package.json`, and the workspace `tsconfig` files.

## Files you must NOT touch

`corpus/briefs/done/**`, `corpus/briefs/superseded/**` (immutable);
`apps/docs/**` (docs pipeline, separate concern); no dependency **additions**
without a grill (fix-in-place only).

---

## Tier 0 — Ship-blockers: broken build, silent data corruption

| # | Where | Defect | Fix sketch |
|---|---|---|---|
| T0-1 **[proven]** | `infrastructure/Dockerfile:20-26,34,51-55` | **Prod image cannot build**: no stage copies `packages/`, so `@pdfcore/engine` (hard dep of norpdf, imported by `core/src/manifest.ts`) is a dangling workspace link; `npm ci` leaves a broken symlink and `turbo build` fails. ISO escapes only because it copies a full `git archive`. | `COPY --parents packages/*/package.json ./` in deps+proddeps; `COPY packages ./packages` in builder. |
| T0-2 **[proven]** | `packages/pdfcore-engine/src/adapters/pdf-lib/pages.ts:51,69-74` | pdf-lib 1.17.1's `removePage` never invalidates its `pageCache` (`insertPage` does). Executed repro: delete page 2 → save → reorder → save yields `[THREE, ONE]` — **the deleted page resurrects and a kept page vanishes**. Same root cause: `pageSizes()` returns stale count after delete; `annotate.add` after delete attaches to the removed page object → annotation silently absent from the save. User-reachable from OrganizeView (delete, then drag-reorder). | After every `removePage`, call `pageCache.invalidate()` (cast); regression test interleaving delete with reorder/annotate/pageSizes on one doc instance. |
| T0-3 | `apps/add-ons/sheets/src/engine/xlsxMapping.ts:193` | `if (v instanceof Date) return { v: v.toISOString() }` — **every Excel date cell becomes literal ISO text** on open→save; the date `numFmt` stays applied to text; sorts/formulas on dates break in Excel. `xlsxScan` has no `dates` feature and `fidelity.test.ts` has zero date tests. | Map `Date` → Excel serial number (keep `numFmt`); add a fidelity test. |
| T0-4 | `apps/backend/src/main.ts` (absence) | Express's default **100 KB JSON body cap** was never raised: Notepad `PUT /files/content` saves >~100 KB 413 before the controller; HTTP-proxy DTO advertises 10 MB body / 14 MB `bodyBase64` (`dto/http-proxy.dto.ts:53,71`) but dies at ~75 KB; `git apply` patches (1 MB DTO cap) same. Office apps escape via multipart `uploadFileBytes`. Unit tests call services directly, so never caught. | `app.use(json({ limit: '16mb' }))` sized to the largest DTO cap; e2e test posting a 1 MB body. |
| T0-5 **[proven]** | `packages/pdfcore-engine/src/adapters/native/annotate.ts:70-72,292-293,333` | Annotation text via `PDFString.of` — **no escaping**. Executed repro: contents `"smile :) done"` → unparseable object, annotation gone on reload (strict viewers may reject the file); `"C:\temp"` → tab-mangled; `"日本語メモ"` → mojibake (>255 char codes truncated). | Use `PDFHexString.fromText()` for `/Contents`/`/T`; keep `/DA` ASCII; non-ASCII freeText appearance needs a guard (WinAnsi Helvetica). |

## Tier 1 — Data loss & user-facing correctness

| # | Where | Defect | Fix sketch |
|---|---|---|---|
| T1-1 | `apps/add-ons/norpdf/src/useReaderController.ts:112-124`, `NorPdf.tsx` | **norPDF never writes back to the opened file** — Save is a browser download (`a.download`); no `uploadFileBytes`, no `useUnsavedGuard` (every other editor has one). Annotations/form values/structural edits lost silently on close; `log.md`'s claim that norPDF saves via `FilesService.uploadFile` is false. | Track dirty, wire `useUnsavedGuard`, save via `uploadFileBytes(source.root, source.path, await doc.save())`; keep download as secondary export. |
| T1-2 | `apps/add-ons/norpdf/src/app/useReaderController.ts:108-128`, `editor/PageAnnotateLayer.tsx:90` | Ctrl+S violates the app's own save→reload contract: no `reloadDocument()`, `addedIds` not cleared → after zoom the baked mark + SVG overlay double-render; deleting then hits the overlay-only branch so the delete "fails". | Route Save through the same reload+clear path as `syncRaster`. |
| T1-3 | `apps/core/src/shared/components/files/FilePicker.tsx:202-218` | **Save As has no overwrite confirmation** (affects code-editor, slides, image-viewer, calendar, bookmarks): save mode even fills an existing file's name on click, then `onPick` uploads over it atomically. | In save mode, check `entries` for a name match → confirm before `onPick`. |
| T1-4 | `apps/add-ons/sheets/src/engine/csv.ts:151-159`, `Sheets.tsx:130-136` | CSV save of a multi-sheet workbook silently writes only sheet 1. The code comment says "the caller warns — see Sheets.tsx"; **the warning was never built** (`sheetOrder` has zero matches in Sheets.tsx). | In `handleSave`'s CSV branch, warn/offer save-as-xlsx when `sheetOrder.length > 1`. |
| T1-5 **[proven]** | `apps/add-ons/calendar/src/recurrence.ts:219-240` | `MAX_OCCURRENCES = 750` counts from the **series start**, before the visible range: a daily no-end event created 751+ days ago expands to zero occurrences — invisible in every view and reminders never fire. Repro test executed: 800-day-old daily rule, current month → `out.length === 0`. | Fast-forward arithmetically to the first instant ≥ `rangeStart` (O(1) per frequency), or cap on `out.length` when neither `count` nor `until` set. |
| T1-6 **[proven]** | `apps/add-ons/calendar/src/seriesEdit.ts:91,111,128` | `recurrence: edited.recurrence ?? event.recurrence` — the dialog sends `null` for "Does not repeat", `??` treats it as absent → **turning repeat off silently keeps the series repeating** (all three scopes). Repro executed. Also `:128`: "this and following" overwrites a just-set end date with the original `until`. | Distinguish `undefined` (untouched) from `null` (cleared); only carry the old `until` when the rule wasn't edited. |
| T1-7 | `apps/add-ons/clock/src/alarmSchedule.ts:85` | Alarm fires only if a tick lands in the exact minute (`alarm.time !== currentHHmm(now)`); hidden-tab throttling / OS sleep across that minute ⇒ **alarm never rings** and stays armed. Timers and snoozes in the same app catch up correctly — only alarms miss. | Fire when `now >= scheduledInstant` within a bounded catch-up window, keyed by instant (the pattern reminders already use). |
| T1-8 | `apps/add-ons/rest-api-client/src/api/collectionsApi.ts:48-59` | Load `catch { return EMPTY_DATA }` treats **any** failure (500/timeout) as first-run; the next mutation persists the whole document → **one backend hiccup at open erases all collections, history, environments**. | Distinguish 404 from other errors; on non-404 go read-only + notify instead of adopting `EMPTY_DATA`. |
| T1-9 | `apps/add-ons/notepad/src/Notepad.tsx:166-171` | "Start a new file in a new window" opens `untitled.txt` that nothing creates → backend 404 → dead-end error screen. | Create via the existing `useCreateFileMutation` first, or treat 404 as an empty draft for the new-file path. |
| T1-10 | `packages/pdfcore-engine/src/adapters/pdf-lib/annotate.ts:76-89,154-210` | Editing a seeded (third-party) annotation deletes it and re-emits from a 15-field snapshot — `/M`, `/NM`, `/RC`, `/F`, `/Popup`, `/IRT`, `/CreationDate` etc. silently dropped; orphaned `/Popup` left behind. `#refs` keyed by load-time pageIndex (only "works" due to T0-2's frozen cache — fix together). | Patch the existing `PDFDict` in place for engine-owned keys; key `#refs` by page `PDFRef`. |
| T1-11 **[proven]** | `packages/pdfcore-engine/src/adapters/pdf-lib/document.ts:24,71-73` | (a) Load runs pdf-lib's `updateMetadata` default → **`/Producer` and `/ModDate` overwritten on every open**, even a no-edit save (repro: Producer became "pdf-lib (…)"). (b) Every save is a full rewrite → **existing digital signatures silently invalidated**, undetected and undocumented. | `PDFDocument.load(bytes, { updateMetadata: false })`; detect `/Sig` fields at load and surface a warning; extend `preservation.node.test.ts` to all metadata fields. |
| T1-12 | `packages/pdfcore-engine/package.json:7-12` | `exports` routes **every** consumer to `index.browser.ts`; the documented `node` condition and `./node`/`./browser` subpaths don't exist — Node consumers get the browser platform that throws at import (tests dodge via relative import). | Real conditional exports: `"node"` → `index.node.ts`, `"default"` → browser, plus the subpaths. |
| T1-13 | `apps/add-ons/media-player/src/components/TrackStage.tsx:116-123`, `lib/resume.ts:40-44` | `shouldResume` — written and unit-tested exactly for "stored position past the end" — is **never called in production**; `clampSeek` clamps a stale resume to `duration` → track "ends" instantly and auto-advance skips it. | Gate the resume seek on `shouldResume(target, el.duration)`. |

## Tier 2 — Platform/shell correctness & performance

| # | Where | Defect | Fix sketch |
|---|---|---|---|
| T2-1 | `apps/core/src/shared/hooks/useGlobalHotkeys.ts:85-98` + `media-player/TrackStage.tsx:319,354,375` + docs `Docs.tsx:227`, norpdf `TopBar.tsx:81`/`Reader.tsx:139-197`, slides `Slides.tsx:183-219` | Global hotkeys have **no text-entry guard and no top-window scoping**: Media Player's bare `space`/`m`/`f` swallow typing OS-wide (`preventDefault` unconditional, minimized windows stay mounted); docs/norpdf/slides listen window-globally so Space scrolls a background PDF *and* advances a background deck. `isTextEntry` exists in `shortcutRegistry.ts:82`; `isTopWindow` exists in `useSaveHotkey.ts:25` — neither is applied. | In `useGlobalHotkeys`: skip unmodified/shift-only bindings when `isTextEntry(e.target)`; export an `isTopWindow`/`useTopWindowKeydown` from core and apply in all four apps. |
| T2-2 | `apps/core/src/shared/components/window/WindowContainer.tsx:14,32-58`, `windowStore.ts:368-374` | `React.memo(Window)` is fully defeated: container subscribes to the whole `windows` array and rebuilds `children` inline → **every drag frame re-renders every window and reconciles every app subtree** (Monaco, Sheets, xterm). `focusWindow` has no already-topmost guard, so every click mints a new array + a debounced localStorage write. Taskbar over-subscribes the same way. | Render apps from primitives inside `Window` (or custom `propsAreEqual` ignoring `children`); projected+shallow selectors in container/taskbar; no-op guard in `focusWindow`. |
| T2-3 | `windowStore.ts:209,250-256,368-374` vs `ui/Dialog.tsx:31` (z-50), `Select.tsx:69`, `Tooltip.tsx`, `Tray.tsx` | Window `zIndex` grows unbounded (persisted; every click bumps it — see T2-2) while all portaled overlays sit at `z-50`/`z-auto` in the same stacking context → **after minutes of use, dialogs/selects/tooltips open behind windows** (backdrop dims, dialog invisible). Taskbar survives only via `z-[9000]`. | Isolate windows in their own stacking layer (`isolation: isolate`), band overlays above it; compact `nextZIndex` past a threshold. |
| T2-4 | `apps/core/src/shared/intents/openApp.ts:32-40`, `useOpenIntent.ts:35-43` | Re-delivering a payload to an already-open single-instance app writes a **dead-letter intent** — all consumers drain exactly once behind a `useRef`. Repro path: extract archive A, then "extract B" from File Manager → window focuses, nothing happens. Intent + opened-file maps also never cleaned on window close (unbounded growth over a kiosk session). | Make `useOpenIntent` subscribe reactively to `intents.get(windowId)`; clear both maps in `closeWindow`. |
| T2-5 | `windowStore.ts:344-366,476-481` | `restoreLayout` wipes `preMaximizeStates`, and `restoreWindow` is a silent no-op without one → **a maximized window restored after reload/lock can never be un-maximized**. | Fall back to a centered `clampToDesktop(defaultSize)` when no pre-max state exists. |
| T2-6 | `WindowContainer.tsx:28,42` vs `Taskbar.tsx:25-29`, `useSaveHotkey.ts:5-9` | Two definitions of "focused window" (all windows vs visible only): minimize the focused window and **no window shows focused chrome while Ctrl+S targets one the user didn't pick**. | One shared `topVisibleWindowId` selector. |
| T2-7 | `apps/core/src/shared/components/CommandPalette.tsx:63-82` | Debounce cancels timers but not in-flight `searchAllSources` — a slow earlier search overwrites newer results; Enter activates the wrong item. | Request-id/query check before `setItems`. |
| T2-8 | `apps/core/src/shared/components/desktop/DesktopIcon.tsx:41-51` | Drag-end persists the raw pointer offset, not the clamped position → an icon dragged past the edge is stored out of bounds, **pinned into the clipped zone, unrecoverable** without clearing storage. | Clamp the stored position against container bounds. |
| T2-9 | `useGlobalHotkeys.ts:83-98`, `useRegisteredHotkeys.ts:47-52` | Handlers frozen at first render for a given key-set (memo on `bindingsKey` only) — any add-on passing state-closing handlers invokes mount-time closures forever. Core survives only via `getState()` discipline. | Latest-bindings ref (the `useSaveHotkey` pattern). |
| T2-10 | `packages/pdfcore-engine` render/text/outline adapters; `api/PdfDoc.ts:134-137`; norpdf `useReaderController.ts:60-80` | **No pdf.js document is ever destroyed** engine-wide (`grep destroy` → text-layer DOM only): three separate `getDocument` parses per generation, three byte copies, and every `save()`/`adopt()` drops proxies without `destroy()` → worker memory grows with every annotation bake until the tab dies. `Forms.primeGeometry` also serializes the whole doc per call. | Share one proxy across read adapters; `destroy()` old proxies in `save()`; add `PdfDoc.dispose()`, call from norpdf on re-open/unmount. |
| T2-11 | `apps/backend/src/modules/archive/archive.service.ts:139,481` | `unzipSync`/`zipSync` on the main thread — a legitimate 150 MB zip freezes **all** HTTP + every PTY for seconds and can spike ~1 GB RSS (input+output in heap). Tar path already shells out. | fflate async API or a `worker_threads` worker; stream entries to disk. |
| T2-12 | `apps/backend/src/main.ts` + `infrastructure/Dockerfile:105-106` | No `enableShutdownHooks()` and node runs as PID 1 with no init → **every `docker stop` is a 10 s hang + SIGKILL**; `PtyGateway.onModuleDestroy` (child reaping, clean WS closes) is dead code in prod; sqlite never closed (`DbService` has no destroy). | `app.enableShutdownHooks()`; `onModuleDestroy → db.close()`; compose `init: true`. |
| T2-13 | `apps/backend/src/modules/files/files.controller.ts:120,125` | Downloads use bare `.pipe(res)`: a source-stream error is an **unhandled `'error'` event → backend crash**; client aborts leak the fd. Line 125 also re-resolves+stats redundantly. | `stream.pipeline(src, res, cb)` on both paths; reuse the resolved `abs`. |
| T2-14 | `files.service.ts:259-262,226` vs `:518-521` | `list()`'s per-entry `lstat` is unguarded while `uploadFile` **stages a transient `.part` file in the same directory** → refreshing a folder during any save can 500 the whole listing. | Catch ENOENT per entry, filter nulls (as `dirSize` already does). |

## Tier 3 — Build, image size, dependency & config hygiene

| # | Where | Defect | Fix sketch |
|---|---|---|---|
| T3-1 **[proven]** | `apps/core/package.json` + `turbo.json:5-11` | Core declares **zero** of the 23 `@imbatranim/*` add-ons it imports; `build`/`typecheck`/`test`/`lint` have no `dependsOn` → hash-proven stale caches: editing an add-on does **not** change core's build hash — a warm cache ships a desktop bundle without the change. | Declare workspace deps in core; `"dependsOn": ["^build"]`-style wiring for all four tasks. |
| T3-2 | `infrastructure/Dockerfile:91-93` | `chown -R … /app` after COPY duplicates the whole payload (~250 MB measured) into an extra layer — directly against the ≤400 MB identity. | `COPY --chown=` on the copy lines; leave `/app` root-owned read-only. |
| T3-3 **[proven]** | `Dockerfile:63-67` vs `iso/scripts/build-payload.sh:61-68` | 58 MB of win32/darwin node-pty prebuilds ship in the prod image; the ISO already strips them — pipeline drift. Also `typescript` (23 MB) leaks through `npm ci --omit=dev --workspace=backend` (verify on npm 11, then strip/guard). | Copy the ISO's prebuild-prune loop into proddeps; `rm -rf node_modules/typescript` + a `test !-d` guard. |
| T3-4 | `infrastructure/docker-compose.yml:31-33` | `TRUST_PROXY=true` hard-enabled while :8080 is published directly — contradicts the README and the commented block below it; a brute-forcer rotates `X-Forwarded-For` and **defeats login rate-limiting**. | Remove it from the active block (it already lives in the commented HTTPS one). |
| T3-5 | `Dockerfile` prod stage / compose | No `HEALTHCHECK` despite the purpose-built `/health` — a hung event loop keeps the container "Up" forever under `restart: unless-stopped`. | `HEALTHCHECK CMD wget -qO- http://127.0.0.1:8080/health \|\| exit 1`. |
| T3-6 | `iso/Dockerfile:25-30`, `APKBUILD:26` vs root `package.json:7-10` | ISO runs the app on Alpine's Node 22 while engines demand ≥24.14.1 — the shipped appliance runs a runtime no other environment exercises. | Pin a Node 24 apk or formally lower the engines floor and record the decision. |
| T3-7 | `apps/add-ons/tsconfig.base.json`, `apps/core/tsconfig.app.json`, `apps/backend/tsconfig.json` | Strictness inverted: the 23 add-ons + core typecheck **without `strict`** (backend also `noImplicitAny: false`) while the smallest package is strictest — "typecheck green" means least where the most code ships. | `"strict": true` in the two frontend bases; burn down backend `noImplicitAny`. |
| T3-8 | `apps/backend/package.json` vs all others | Toolchain split (TS 5.9/eslint 9 vs TS 6.0/eslint 10) → 25 nested `node_modules` copies and per-package compiler divergence; dev-compose anonymous volumes cover only 7 of 23 add-ons, silently shadowing the rest. | Align backend to TS 6/eslint 10; generate the compose volume list or mount only `src`. |
| T3-9 | `apps/backend/src/security-headers.ts:36-37` | CSP whitelists Google Fonts — a hard external fetch that fails on the offline kiosk/air-gapped LAN (the product's pitch) and leaks visitor IPs. | Self-host the woff2 files; collapse `font-src`/`style-src` to `'self'`. |
| T3-10 | root `package.json:31-40`; backend deps | `allowScripts` is inert (no lavamoat anywhere; `npm ci` runs all scripts) and drifted (`fsevents` unlisted); `strip-ansi` declared but unused; `@types/multer`/`@types/ws` in prod deps; `@types/uuid@10` shadowing `uuid@14`'s own types; `fflate ^0.4.8` (2021) in four workspaces. | Wire up or delete `allowScripts`; prune the dead/misplaced deps; bump or comment fflate. |
| T3-11 | `iso/scripts/run-mkimage.sh:15-17,30-33`, `APKBUILD:21`, `iso/build.c:53` | ISO reproducibility: aports pinned to a moving branch + unpinned apk fetches (same commit → different ISO); `license="UNLICENSED"` vs AGPL; `mkdir` return ignored; `build-payload.sh`'s `(cd … && … \|\| true)` swallows the whole strip chain. | Pin an aports SHA, record resolved apk versions; fix the license string; check returns. |

## Tier 4 — App-level mediums & lows (batch by app)

**file-manager** — cut/paste invalidates only the destination dir (source stays
stale 30 s; ghost entries) and clears the clipboard before the move resolves
with no `onError` → a refused paste silently discards the cut
(`queries/filesQueries.ts:105-113`, `hooks/useFileClipboard.ts:28-38`); rename
has no slash/duplicate validation and no error surface (`FileManager.tsx:217-230`
— `handleNewFile` at `:252-259` shows the right pattern); upload/drag-drop
silently overwrites existing names with no confirm (`:284-299`).

**backend (files/auth/todos)** — broken symlinks undeletable and out-of-jail
symlinks neither deletable nor trashable (`files.service.ts:581-590` stats the
target; operate on the link via parent-resolve + lstat); `fullyDecode`
percent-decodes up to 6× so legit `%`-named files are unaddressable
(`:135-148`); upload temp file leaks when `root` is missing
(`files.controller.ts:144-146`); `copy()` lacks `withDiskSpaceCheck` and
move-into-self is a raw 500 (`:550-579`); TOTP codes replayable within the
window — store last-accepted step (`auth.service.ts:88-98`); malformed cookie
in the fallback parser throws `URIError` → every response 500s until cookies
cleared (`auth.constants.ts:31`); invalid `listId` silently widens
clear-completed to **all** lists (`todos.controller.ts:100-104`);
`purgeExpired()` dead code — sessions/recent_files grow forever
(`session.service.ts:85-90`, `notes.service.ts:15-24`); `.trashinfo`
`DeletionDate` violates the freedesktop format it claims (`trash.service.ts:128`).

**calendar/todo/clock** — WeekView positions events by elapsed minutes on a
fixed 24-slot grid → one-hour misplacement on DST days (`dateUtils.ts:40-43`);
todo reminders' hand-rolled `dueAt - 86_399_999` is DST-wrong (`reminders.ts:51`
— `due.ts` has the correct helper); todo bulk delete/complete acts on a
selection hidden by a later filter/list switch (`Todo.tsx:50-57,164-181`);
clock: failed alarm PATCH re-rings every tick for the minute
(`useClockNotifications.ts:38-42`), snooze/patch failures roll back silently
(`clockQueries.ts:102-120`), 3 `Intl.DateTimeFormat` constructions per world
clock per second (`format.ts:51-78` — cache per zone).

**sticky-notes/bookmarks/image-viewer/notepad/calculator** — debounced note
edits are **cancelled, not flushed**, on unmount → last ≤800 ms of typing lost
on close (`DesktopNote.tsx:84-89`, `StickyNotes.tsx:80-84`); bookmarks folders
in a `parentId` cycle vanish from the tree silently (`tree.ts:35-56` — append
unvisited groups to root); image-viewer shows a *different* image when the
opened file is missing from the listing (`ImageViewer.tsx:118-120`); ICS export
folds by UTF-16 chars not octets, can split surrogate pairs (`ics.ts:66-76`);
notepad Replace one/all destroys the textarea undo stack (`NoteEditor.tsx:148-174`
— markdown-editor's `execCommand` spine solves this); calculator `-(2+3)`
throws (`engine/evaluate.ts:170-179`).

**heavy apps** — Terminal notifies with appId `'repl-interpreter'` but the
registry id is `'terminal'` → clicking the toast throws (`Terminal.tsx:203,218`);
curl `-F` import lands multipart parts in the *text* body with a bogus
content-type (`curl.ts:305-311` + `RestApiClient.tsx:380`); snipping-tool
captures scrolled containers from their top with no lossy notice
(html-to-image copies no scroll offsets) and commits annotations inside
setState updaters → duplicates under StrictMode (`AnnotationStage.tsx:244-264`);
git-gui remembers repos that failed to open (`GitGui.tsx:126-131`) and drops
binary files with spaces from diffs (`diffModel.ts:96`); code-editor freezes
theme at mount, ignoring the OS appearance store (`CodeEditor.tsx:115-121`);
sheets never terminates a hung xlsx worker — one wedge strands all future
opens (`xlsxBridge.ts:96-105`); norpdf: unhandled rejections on every
structural op (`OrganizeView.tsx:94-98` — no catch/notify), "Merge PDF…" still
uses a native host-file input (the exact brief-65 sin, `OrganizeView.tsx:168-177`),
drag-drop open has no generation token (slow A can replace newer B,
`useReaderController.ts:82-106`), reload re-runs search inside a `setSearch`
updater (`:257-260`).

**pdfcore-engine (beyond Tier 0/1)** — `coords/` accepts `rotation` and ignores
it → annotations mis-land on `/Rotate` pages (`coords/index.ts:65-99`; also no
MediaBox-origin handling); `Forms`: `getForm()` **creates** `/AcroForm` on a
read, `updateFieldAppearances` runs twice per save and throws on non-WinAnsi
values → whole save fails (`forms.ts:101,123,139-141`); encrypted PDFs refused
at *view* time with a raw pdf-lib error leaking through the "no backend errors"
contract (`api/PdfDoc.ts:85-88`); `AnnotationPatch` collapses to the 5 common
fields — geometry edits are a compile error (`capabilities/Annotate.ts:113`);
`Pages.reorder` is 0-based while every sibling is 1-based.

**core a11y/quality** — Start menu declares `role="menu"` with none of the
keyboard contract (`StartMenu.tsx:21-96`); desktop icons focusable but not
keyboard-activatable, focus ring suppressed (`DesktopIcon.tsx:53-57`); minimized
windows keep polling full-rate (System Monitor 1.5 s forever — expose
`isVisible` via the contract); dead exit animation in `Window`; dead Vite
template CSS/assets; `TASKBAR_HEIGHT` defined in three places.

## Test gaps to close alongside the fixes

1. pdfcore fixtures are 100% pdf-lib-authored — no foreign-producer, rotated,
   incremental-update, signed, encrypted, or non-ASCII fixture; no
   cross-capability interleaving (would have caught T0-2, T1-10, T1-11).
2. Sheets fidelity has zero date tests (T0-3).
3. No e2e posts a large JSON body (T0-4).
4. `seriesEdit.test.ts` never removes a rule from a recurring event (T1-6).
5. No test builds the prod Docker image or asserts the workspace COPY set (T0-1).

## Acceptance

- Tier 0 fixed first; each Tier 0/1 fix lands with the regression test named
  in its row (or the test-gaps list).
- `docker compose -f infrastructure/docker-compose.yml build imbatranimos`
  succeeds; image stays ≤400 MB (T3-2/3 should take it **down** ~280 MB).
- `docker stop` completes in <2 s with the PTY teardown path exercised.
- All existing gates stay green: turbo typecheck, test, lint, format:check.
- A turbo cache warm-run after editing any add-on rebuilds core (T3-1
  verifiable by the hash check in the audit).
- Ungrilled items that turn out to be by-design get a one-line rejection note
  here at completion time rather than silent omission.
