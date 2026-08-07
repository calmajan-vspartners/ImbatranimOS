# Brief 102 — Async close guards + the themed unsaved-changes confirm

> **Outcome (2026-08-07): DONE.** Built as specced; `PROTOCOL_VERSION` 2. The
> guard type widened to `() => boolean | Promise<boolean>`; `closeWindow`
> keeps the same-tick boolean fast path byte-for-byte and adds a
> `pendingCloses` set (second close while the dialog is up = no-op; cleanup
> runs exactly once, only on a proceeding close; a REJECTING guard keeps the
> window open). Kit gained `UnsavedChangesDialog` (Save primary+autofocus /
> Don't Save destructive / Cancel; two-button form when `onSave` is absent);
> `useUnsavedGuard(isDirty, title, onSave?) → ReactNode` with re-entrant
> requests joining the same pending promise and unmount settling false. One
> trap the spec missed, found while building: the save-and-close verdict
> cannot be read right after `await onSave()` — the save's state updates have
> not re-rendered, so the stale dirty ref would abort every successful
> save-and-close; the verdict is read in an effect after the commit
> (ref-armed tick, no setState-in-effect). Site notes: notepad's save went
> `mutateAsync` so it is awaitable; code-editor's third button saves every
> dirty tab that has a home (a homeless untitled tab honestly aborts);
> image-viewer passes `saveRotation` only when the format can save in place,
> and its sibling-nav discard now rides kit `useConfirm`; norpdf's guard
> moved into an `<UnsavedCloseGuard/>` component inside `EditorProvider`
> (the controller cannot reach `saveToDisk` from outside). `window.confirm`
> greps to zero under apps/ + packages/ source; ui-conventions §43 rewritten.
> Verified: 6 new windowStore units + 5 SDK hook units (mounted through a
> real React root); Playwright 12/12 — themed dialog with the Terminal
> STREAMING behind it (10→13 ticks while open), Save-and-close wrote the
> bytes, Don't Save didn't, Cancel kept the dirty marker, no stacking — and
> 6/6 on image-viewer's rotate→arrow confirm. Deferred (already out of
> scope): window-scoped modal variant, beforeunload, save-all on log off.

Status: **done 2026-08-07** · From the 2026-08-07 research sweep. MEDIUM ·
PROTOCOL (`packages/ui/src/system.ts` — one member's signature widens,
`PROTOCOL_VERSION` 1→2) + SDK (`systemHooks.ts`, one new kit dialog) + CORE
(`windowStore.ts`) + the nine `useUnsavedGuard` call sites + image-viewer's
sibling confirm. No backend, no new deps, nothing stored. Independent of
brief 101; together they close the two ways unsaved work dies.

## Problem

1. **The one dialog every editor shows is browser chrome.** A dirty close runs
   `window.confirm` (`packages/ui/src/hooks/systemHooks.ts:62-64`) — a modal
   that names the host origin and, being native, **stalls all JS**: clocks
   stop, toasts freeze, terminal output halts, every other window is dead
   while it is up. It is the single hardest break left of the "this is an OS"
   illusion, and it is hit daily by anyone who edits anything.
2. **It is native because the protocol forces it to be.** The guard is typed
   synchronous end to end: `onCloseRequest(guard: () => boolean)`
   (`system.ts:158`), `closeGuards: Record<string, () => boolean>`
   (`windowStore.ts:293`), consulted inline by `closeWindow`
   (`windowStore.ts:448-449`). A themed dialog answers asynchronously, so no
   themed dialog can ever sit behind this signature. `system.ts` knows:
   its header names this "the one deliberate exception" to
   everything-survives-postMessage (`:18-22`), and the member's own note
   (`:153-156`) promises that close becomes a request/acknowledge exchange
   "with a version bump" when the contract is renegotiated. This brief is
   that renegotiation, ahead of any transport.
3. **Exactly two native confirms remain**: the guard above, and
   image-viewer's sibling-navigation discard (`ImageViewer.tsx:169-174`,
   whose comment says "same `window.confirm` spine"). `ui-conventions.md` §43
   forbids adding a third (its pointers have drifted — it still cites the
   pre-seam `hooks/useUnsavedGuard.ts:65` and `CodeEditor.tsx:250`, which
   brief 88 already fixed; the two sites here are the live ones).
4. **The real-OS third button is missing.** Every desktop asks
   Save / Don't Save / Cancel; ours only offers discard-or-stay, even though
   every editor demonstrably has a save function (`useSaveHotkey` sites).

## Proposed decisions (ungrilled)

- **Protocol: `onCloseRequest(guard: () => boolean | Promise<boolean>)`** —
  widening the return type of the existing member, no new member. It survives
  postMessage because it removes the one thing that didn't: a transport
  proxies the callback and awaits its settlement, and a settled boolean is
  pure data. The header's "one deliberate exception" note (`system.ts:18-22`)
  is deleted — after this brief the whole protocol is transport-safe.
  `PROTOCOL_VERSION` 1→2, exactly as the note at `:153-156` promised.
  Existing sync guards remain type-valid, so compatibility needs no app edits.
- **The dialog is app-side, not a new OS portal.** Rejected: a
  system-rendered confirm à la `pickOpen` — `system.ts`'s own rule ("if a
  thing can be done app-side with what is already here, it does not get a
  method") forbids it, and the message text is app content, not OS chrome.
- **`useUnsavedGuard` returns the dialog node**:
  `useUnsavedGuard(isDirty, title, onSave?) → ReactNode`, which apps render.
  A void hook cannot render, so the signature change is forced; all nine
  call sites are first-party and updated here. Rejected: a second React root
  inside the SDK (StrictMode/event forking); rejected: a module-level host
  singleton (the hidden global provider the kit's `useConfirm` deliberately
  avoids, `ConfirmDialog.tsx:68`).
- **Save-and-close trusts the dirty flag, not the save's return.** On the
  third button: `await onSave()`, then proceed **only if dirty actually
  cleared** — a failed save or a cancelled Save-As pick leaves the window
  open with its work. The dirty flag is already the single source of truth.
- **A new kit `UnsavedChangesDialog`** (Win7 phrasing: "Do you want to save
  changes to X?" — Save / Don't Save / Cancel), two buttons when `onSave` is
  absent. Rejected: warping `ConfirmDialog`'s boolean contract into a
  tri-state — every existing `await confirm(...)` site depends on it.
- **`closeWindow` stays `(id) => void`, async internally.** A sync `boolean`
  return closes in the same tick (today's behaviour, unchanged for guardless
  and clean windows); a `Promise` marks the id close-pending, awaits, then
  proceeds or aborts. A second close request for a pending id is a no-op —
  no stacked dialogs, no double-close. Rejected: making `closeWindow` return
  a Promise — every caller is fire-and-forget (`Window.tsx:221`,
  `Taskbar.tsx:220`, `useWindowHotkeys.ts:54`, `WindowContainer.tsx:121`,
  `createSystemHandle.ts:93`) and none should start caring.
- **Image-viewer rides along on kit `useConfirm`** (already exported,
  `ConfirmDialog.tsx:73-123`): `confirmDiscard` goes async, `goPrev`/`goNext`
  await it. After this brief, `window.confirm` greps to zero in `apps/` and
  `packages/` source.
- **Desktop-modal like every kit dialog, accepted.** Other windows are
  pointer-blocked while it is open, but their JS keeps running — clocks tick,
  terminals stream — which is the actual complaint against the native modal.
  Rejected for now: a window-scoped modal variant (new `Dialog` machinery).

## Fix

1. `packages/ui/src/system.ts`: widen the guard type at `:158`; rewrite the
   member note (transport proxies the guard and awaits settlement); delete
   the header exception at `:18-22`; `PROTOCOL_VERSION = 2` (`:29`).
2. `windowStore.ts`: widen `closeGuards` (`:293`); `closeWindow`
   (`:443-470`) — boolean fast path byte-identical, promise path adds a
   `pendingCloses` set consulted at entry; the cleanup block (`:450-468`)
   runs only when the close actually proceeds, exactly once.
3. `packages/ui/src/components/`: `UnsavedChangesDialog` on kit
   `Dialog`/`Button` — Save (primary, autofocus), Don't Save (destructive),
   Cancel; Esc and backdrop dismiss = Cancel.
4. `systemHooks.ts` `useUnsavedGuard` (`:45-67`): dirty guard returns a
   promise driven by the dialog; re-entrant requests return the same pending
   promise; unmount settles `false` (the `useConfirm` precedent,
   `ConfirmDialog.tsx:100-107`) so a pending `closeWindow` never hangs; hook
   returns the node; optional `onSave` wires the third button.
5. Update the nine call sites to render the node and pass their save
   function: `Sheets.tsx:51`, `Paint.tsx:488`, `ImageViewer.tsx:280`,
   `useReaderController.ts:99` (norpdf threads the node out through the
   controller's return), `Docs.tsx:67`, `NoteEditor.tsx:96`,
   `DiffTool.tsx:161`, `CodeEditor.tsx:114`, `MarkdownEditor.tsx:91`. A site
   without a sensible save keeps the two-button form by omitting `onSave`.
6. `ImageViewer.tsx:169-185`: `confirmDiscard` → `await confirm({...,
   destructive: true })`; render `confirmDialog`.
7. `createSystemHandle.ts`: no change — `:99-102` passes the guard through
   untyped-narrowed, and the windowless no-op (`:82-85`) is unaffected;
   verify apps see `protocolVersion === 2` (`:148`).
8. Corpus at close time: rewrite `ui-conventions.md` §43 (the rule becomes
   "there are no native dialogs; use the kit"), fixing its stale pointers.

## Must preserve (regression surface)

- "A guard that returns false aborts the close for every caller"
  (`windowStore.ts:444-447`) — now equally true of a settled-false promise;
  title-bar X, Ctrl+W, taskbar menu and `requestClose` all still funnel
  through the one `closeWindow` chokepoint.
- Guardless and clean-window closes stay same-tick synchronous —
  `windowStore.test.ts:76` ("closeWindow cleanup") and
  `workspaces.test.ts:132` depend on it.
- Intent + `preMaximizeStates`/`preSnapStates`/guard cleanup fires exactly
  once per closed window and **never** for an aborted close.
- One guard per window, replace-on-reregister (`system.ts:150-151`);
  unregister-on-unmount via the returned disposer.
- The dirty-title `•` suffix and Ctrl+S binding (`systemHooks.ts:54-57`,
  `useSaveHotkey`) unchanged.
- Browser tab close stays native `beforeunload` territory — this brief scopes
  to OS-window close only.
- Lightweight: the dialog is kit `Dialog` + `Button`; no new dependency.

## Verify bar

`turbo typecheck`, lint + format, `turbo test`, `turbo build` green. No
backend touched — no backend tests. New units: `windowStore` async guard
(sync-true closes same-tick; settled-false aborts with stores untouched;
pending id ignores a second close; cleanup exactly once) and the SDK hook
(clean close shows no dialog; save path aborts when dirty persists; unmount
settles false).

**Verified in a browser** (production bundle + real backend): make Notepad
dirty, Ctrl+W — a themed dialog appears with no browser-chrome origin string,
while a Terminal window behind it **keeps streaming output** (the freeze is
the probe's own check); Save and close writes the file and closes; Don't Save
closes without writing; Cancel/Esc keeps the window and its `•`; a second
Ctrl+W while the dialog is open neither stacks nor closes. In image-viewer,
rotate then arrow to a sibling — themed confirm, both outcomes honoured.
Grep gate: `window.confirm` has zero hits under `apps/` and `packages/`
source.

## Out of scope

Tab-close/`beforeunload` behaviour; save-all prompting on log off (brief 101
owns teardown semantics); a window-scoped (non-desktop-modal) dialog variant;
migrating dialogs that are already themed; any other `system.ts` member; the
postMessage transport itself.
