# Brief 111 — File Manager keyboard parity: every verb without the mouse

Status: **todo (ungrilled)** · From the 2026-08-07 research sweep. MEDIUM ·
`file-manager` only, plus two documented-shortcut rows in core `App.tsx`
(the brief-86 registry — no protocol change, `packages/ui/src/system.ts`
untouched). No backend, no new store, no dotfile. Interacts with brief 105
(the kit ContextMenu supplies in-menu keyboard nav; this brief only *opens*
the menu from the keyboard) — no hard dependency in either direction.

## Problem

The flagship app's only app-level hotkey is Ctrl+H
(`FileManager.tsx:541-548`); `useListKeyboardNav.ts:45-87` handles
arrows + Enter. Every verb — Rename, Copy, Cut, Delete, Properties, Open
with, Compress (`lib/buildMenuItems.tsx:101-235`) — is right-click-only, and
a repo-wide grep finds zero Shift+F10/menu-key handling, so the menu itself
is keyboard-unreachable. `FileList.tsx:117` supports ctrl-click toggle but
no shift-range (`useFileSelection.ts:7-9` says so out loud: "There is no
shift-range/anchor selection in this app"). The preview-pane splitter is a
bare `<div onMouseDown>` (`FileManager.tsx:821-827`, `usePaneResize.ts:42-63`)
while markdown-editor's `SplitDivider.tsx:62-93` is the house-correct
`role="separator"` with arrow keys — the same widget, mouse-only in one app
and accessible in the other. This violates ui-conventions §41 ("anything the
mouse can do the keyboard must do") in the app users live in, and it breaks
the muscle memory the Win7-classic identity invites: F2 and Delete are
reflexes, and today they do nothing.

## Proposed decisions (ungrilled)

- **Bind the selection verbs on the list wrapper's existing keydown path**
  (the `tabIndex={0}` div at `FileManager.tsx:751-758` that already hosts
  `handleListKeyDown`), not globally and not via `useTopWindowKeydown`: same
  focus scope the arrows already have, and the kit dialogs portal to body so
  their keys never reach it. Rejected: a window-level listener — Delete
  while a confirm dialog's button has focus would fire twice-removed from
  what the user is looking at.
- **F2 renames the sole selection; Delete/Shift+Delete ride the existing
  flows.** `useDeleteFlow.ts:48-60` already takes `forcePermanent` (the
  toolbar passes `e.shiftKey` at `FileManager.tsx:622`), so Shift+Delete is
  wiring, not new semantics; the same ConfirmDialog with the same honest
  Trash-vs-permanent copy appears. Rejected: a keyboard-only unconfirmed
  delete — the confirm is the contract.
- **Ctrl+C/X/V/A, with the clipboard going multi-entry.** The clipboard is
  single-entry today (`useFileClipboard.ts:5-8`); Ctrl+C on a 5-item
  selection silently copying one is a trap. Extend to `entries: FsEntry[]`;
  paste loops with `Promise.allSettled` + partial-failure reporting,
  mirroring the batch-delete contract (`useDeleteFlow.ts:64-97`).
  Context-menu Copy/Cut on a selected row take the whole selection — the
  `onCompress` precedent (`FileManager.tsx:424-437`). Rejected: keeping the
  clipboard single-entry and gating Ctrl+C on `selected.size === 1`.
- **Shift-click + Shift+Arrow range select via an anchor ref, not a store
  change.** The anchor (last plain/ctrl selection target) lives in a ref in
  `FileManager`; ranges are computed over `orderedEntries` (the single
  source of order, `FileManager.tsx:452-453`); `useFileSelection` keeps its
  Set semantics untouched. Row handlers pass a mode
  (`'replace' | 'toggle' | 'range'`) derived from modifiers instead of
  today's boolean (`FileList.tsx:112-118` and the FileGrid twin). Rejected:
  anchor state inside the selection hook — it is transient interaction
  state, not selection state.
- **Menu key / Shift+F10 opens the context menu on the selection, anchored
  to the row's rect** — rows carry `data-entry-path` (`FileList.tsx:110`);
  `scrollToIndex` first so the row is mounted, then `setMenu` with
  rect-derived x/y. No selection → the background menu. The menu's *inside*
  stays as it is — arrow nav within it is brief 105's kit contract, and the
  open API (`{menu && <ContextMenu x y items onClose/>}`) survives 105's
  migration unchanged. Rejected: hand-rolling roving focus here, a fourth
  menu dialect the day before 105 deletes the other three.
- **The splitter gets the SplitDivider treatment in place**: `role="separator"`,
  `aria-orientation`/`valuemin`/`valuemax`/`valuenow` (the store's real
  clamp: 220/480, `previewPaneStore.ts:15-16`), `tabIndex={0}`, arrows nudge
  the width, double-click/Home recentres. This is the *second* copy of the
  pattern — the promote-on-third rule has not fired. Rejected: promoting
  SplitDivider into `@imbatranim/ui` now.
- **Keys provably inert during rename and dialogs**: the `renamingPath`
  guard exists (`useListKeyboardNav.ts:55`); add the input/textarea target
  check (the Ctrl+H precedent, `FileManager.tsx:544-545`) and a test per
  surface (rename input, New Folder, Open With, Properties, Trash,
  confirm/prompt, open context menu).
- **Registry: document, don't re-bind.** Rows go in core `App.tsx`'s
  `useDocumentedShortcuts` block (the `files.toggle-hidden` precedent,
  `App.tsx:73-82`, scope `Editing`, note "Only while a File Manager window
  has focus") so the ?-overlay lists them without flickering as windows
  open/close. Rejected: `useRegisteredHotkeys` — global binding is the wrong
  scope, as the Ctrl+H comment already explains.

## Fix

1. `hooks/useFileSelection.ts` + `FileManager.tsx`: anchor ref, a
   `selectRange(toPath)` helper over `orderedEntries`; row/tile click
   handlers pass the modifier-derived mode (`FileList.tsx`, `FileGrid.tsx`).
2. `hooks/useListKeyboardNav.ts`: Shift+Arrow extends the range from the
   anchor; plain arrows reset it. Keep the Icons-grid `columns` math intact.
3. New `hooks/useFileVerbKeys.ts` (or extend the wrapper handler): F2,
   Delete, Shift+Delete, Ctrl+C/X/V/A, ContextMenu/Shift+F10, with the
   inertness guards; `preventDefault` only on keys actually handled.
4. `hooks/useFileClipboard.ts`: multi-entry; `Promise.allSettled` paste with
   partial-failure `onError`; toolbar Paste badge and status bar show counts
   (`FileManager.tsx:601-615`, `:838-846`); `buildMenuItems` Copy/Cut become
   selection-aware.
5. Menu-key anchoring in `FileManager.tsx` (`setMenu` from the row rect).
6. Splitter a11y in `FileManager.tsx:821-827` + a keyboard path in
   `usePaneResize.ts` calling `previewPane.setWidth` directly.
7. Core `App.tsx`: documented rows for the verb set and the range keys.
8. Vitest: range math, multi-paste partial failure, guard inertness.

## Must preserve (regression surface)

- Plain-click replace/clear and ctrl-click toggle semantics byte-for-byte
  when Shift is not held (`useFileSelection.ts:18-33`).
- Trash routing: Delete trashes only on the `home` root (`trashEnabled`,
  `FileManager.tsx:178-179`); `notes` stays confirm-then-permanent; the
  dialog copy keeps matching what actually happens (`:922-941`).
- Ctrl+H, arrows + Enter, and the Icons-grid navigation exactly as they are.
- Right-click still selects the row it opened on (`FileList.tsx:120-131`).
- The cut-clears-only-after-success paste contract (`useFileClipboard.ts:45-53`,
  the M3 fix) survives the multi-entry rewrite.
- No new dependency; `system.ts` untouched; eslint import boundary intact.

## Verify bar

`turbo typecheck`, lint + format, `turbo test`, `turbo build` green. No
backend touched — no backend tests. New vitest units per Fix 8.

**Verified in a browser** (production bundle + real backend): select a file,
F2 → inline rename commits; click `a.txt`, shift-click `e.txt` → 5 selected
and the status bar agrees; Shift+ArrowDown grows the range; Ctrl+A selects
all; Ctrl+C, navigate into a subfolder, Ctrl+V → every file lands; Ctrl+X +
Ctrl+V moves; Delete shows "Move to Trash" and the toast follows;
Shift+Delete shows "Delete permanently"; menu key opens the context menu on
the selected row (not at the cursor's stale position); Tab reaches the
splitter, arrows resize the preview pane and `aria-valuenow` tracks; every
verb key is dead while the rename input or the New Folder dialog is open;
the ? overlay lists the new rows. Console clean (§14).

## Out of scope

Keyboard nav *inside* the menu (brief 105), drag-move (133), the desktop
marquee (106), shortcut rebinding (parked), type-to-seek/first-letter jump,
and any change to code-editor or other apps' keys.
