# Brief 74 — Sticky Notes: pay the inherited debt, then make them actually stick

Status: **todo (ungrilled)** · From the 2026-07-31 app+OS improvement sweep.
MEDIUM · add-on `apps/add-ons/sticky-notes` (355 LOC) + the backend
`sticky-notes` module. The desktop-surface half depends on brief 53 (desktop
icon layout) touching the same layer.

## Problem

**1. It is the OS's worst-behaved app, and it is the template people copy.**
`wiki/ui-conventions.md` §45 names it explicitly as "NOT a template". Verified in
the source:

- **Rows are `<div onClick>`** (`StickyNotes.tsx:204-206`), so a note cannot be
  opened from the keyboard at all — a straight violation of the accessibility
  floor (§35).
- **A raw `<button>` where a ghost `Button` belongs** (`:212-219`), so it misses
  the kit's focus ring and hover semantics.
- **Raw `overflow-y-auto`** (`:172`) instead of `ScrollArea`, so it shows the
  browser's scrollbar rather than the themed one.
- **`console.error` as the only failure signal** (`:142`): creating a note can
  fail and the user is told nothing, though `notify()` shipped in brief 34.
- The delete button sits inside the clickable row — **verify whether clicking
  delete also triggers open**; if the handler does not stop propagation, that is
  a live bug, not just a style issue.

It does use `useConfirm` for deletion (`:122`), which is correct and should stay.

**2. They are not sticky notes.** The app is a list of notes inside one window.
The name promises the thing every desktop means by it: small coloured notes that
sit **on the desktop**, are moved around, and are visible without opening an app.
That is the whole point of the metaphor, and it is the app's only real reason to
exist next to Notepad and Todo.

**3. Missing the basics of the metaphor**: no colours, no per-note size or
position, no pinning, no search, and delete is permanent with no archive.

Storage is fine — it persists through the backend (`/sticky-notes`), so unlike
Calendar the data is in the container.

## Proposed decisions (ungrilled)

- **Fix the style debt first, as its own commit.** It is small, it removes the
  bad template from the repo, and it makes the feature work reviewable on its
  own. Rows become buttons (or get `role`/`tabIndex`/key handling), the raw
  button becomes a ghost `Button`, `ScrollArea` replaces `overflow-y-auto`, and
  every failure path calls `notify({ appId: 'sticky-notes' })`.
- **Then make notes render on the desktop**, as a desktop layer alongside icons —
  draggable, resizable, with a persisted position, size and colour. This is the
  brief's actual value and the reason to keep the app.
- **The window becomes the manager**, not the only surface: the list view stays
  for search, bulk actions, and notes you have not placed.
- **Colours from the token set, not arbitrary hex.** The identity is B&W plus one
  accent (`ui-conventions.md` §5-8), so "sticky yellow" is off-identity. Use a
  small set of surface-container steps plus the accent, distinguished by border
  and header treatment rather than saturated fills. **Grill this** — it is the
  one place the locked identity and the app's metaphor genuinely pull apart, and
  the answer should be recorded rather than improvised.
- **Delete goes to the Trash** once that brief lands, rather than this app
  inventing its own archive.
- **Rejected — rich text / markdown in notes.** A sticky note is a scrap; the OS
  has two editors for anything more.
- **Rejected — notes floating above all windows.** They live on the desktop
  layer, below windows. Always-on-top scraps would fight the compositor's z-order
  and the window manager owns that.

## Fix

1. Style pass: rows → real buttons with focus rings; ghost `Button` for delete;
   `ScrollArea`; `notify()` on every catch; verify/fix delete-vs-open event
   propagation.
2. Backend: add `x`, `y`, `width`, `height`, `color`, `onDesktop` to the note
   model with a migration defaulting existing notes to list-only.
3. Desktop surface: a sticky layer rendered by core's desktop (the same layer
   brief 53 is reworking), drag to move, resize handle, colour picker in the
   note header; positions persisted through the backend.
4. Window view: search, and a "place on desktop" / "remove from desktop" toggle.

## Must preserve (regression surface)

- Existing notes survive the migration and remain editable.
- `useConfirm` on delete stays.
- The backend routes stay authed and owner-scoped.
- Desktop notes must not break icon layout, drag, or double-click-to-open
  (brief 53), and must not intercept clicks meant for the desktop.
- Notes stay below windows in z-order.

## Verify bar

`turbo typecheck`, add-on + core lint/format green, `turbo build` ok. Backend
tests for the new fields and the migration.

**Verified in a browser**: tab to a note row and open it with Enter; delete a
note and confirm it does not also open; place a note on the desktop, move and
resize it, reload, and confirm it is where you left it; confirm desktop icons
still lay out and launch correctly alongside notes; check both themes.

## Out of scope

Rich text, images in notes, reminders on notes, sharing, always-on-top, and the
Trash mechanism itself.
