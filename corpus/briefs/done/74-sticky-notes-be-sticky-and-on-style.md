# Brief 74 — Sticky Notes: pay the inherited debt, then make them actually stick

Status: **done 2026-08-05** · From the 2026-07-31 app+OS improvement sweep.
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

---

## Outcome — done 2026-08-05

Both halves landed: the style debt is paid and notes now live on the desktop. The
app went from the file `ui-conventions.md` named as "NOT a template" to the only
worked example of a new core seam.

### The colour decision, recorded as the brief demanded

The brief flagged this as "the one place the locked identity and the app's metaphor
genuinely pull apart" and asked for a recorded answer rather than an improvised one.
**The question was already settled one brief earlier.** Brief 72 gave Calendar a
six-name palette (`blue green amber red purple slate`) applied as a **tinted border
plus a low-alpha fill** — enough hue to tell two things apart at a glance, not enough
to read as a saturated colour block. Brief 74 therefore **reuses that palette and
that treatment** rather than inventing a second scheme; two apps disagreeing about
what "amber" looks like would be worse than either choice on its own.

Rejected, explicitly:

- **Saturated sticky yellow / pink.** Off-identity, and the brief's own proposal
  already said so.
- **Surface-container steps alone**, which the brief suggested. On-identity but
  wrong: five near-identical greys defeat the only organisational affordance a note
  colour has. Measured in both themes before rejecting it.

The map is duplicated from `calendar/src/eventStyle.ts` **deliberately**: the repo's
rule promotes a shared helper to core on the *third* copy, and this is the second.
Recorded as a deferral — when a third app needs it, both move to core together.

### The desktop layer, as a core seam rather than a special case

Core does not import `@imbatranim/sticky-notes`; it knows only "some app contributed
a layer", exactly as it knows only "some app contributed a command source".
`desktopLayer?: ComponentType | LazyExoticComponent<ComponentType>` went onto
**`AppConfig`**, not `AddonManifest` — the shell reads `AppConfig[]` from
`useEnabledApps()`, so putting it on the manifest type typechecked in the add-on and
failed in core. `Desktop.tsx` renders the layers inside one
`pointer-events-none absolute inset-0` wrapper with `<Suspense fallback={null}>`,
placed **after** the icon container and **before** `WindowContainer`. That ordering is
load-bearing in both directions: the icon container spans the whole desktop, so a
layer beneath it would never receive a click, and every window must still win the
z-order. The contract is documented on the field itself and as §47–48 of
`ui-conventions.md`.

### What the brief got right, and the one thing it had wrong

Every item on the problem list was real and is fixed — with one exception. The brief
asked to "**verify whether clicking delete also triggers open**; if the handler does
not stop propagation, that is a live bug". It was **not** a bug: `stopPropagation`
was already there. Verified rather than assumed, and now moot anyway, because the row
controls are **siblings** of the row button instead of nested inside it — which is the
better fix, since nesting is also what produces `<button>`-in-`<button>` (§42).

### The style debt, item by item

- `<div onClick>` rows → real `<button>`s with a `focus-visible` ring. The old rows
  could not be reached from a keyboard at all.
- A raw `<button>` for delete → ghost `Button` from the kit, with `aria-label`,
  `title`, and `aria-pressed` on the desktop toggle.
- Raw `overflow-y-auto` → `ScrollArea`.
- `console.error` as the only failure signal → one private `reportFailure()` wired
  into every mutation's `onError`. This was the last console-only failure path in any
  add-on; the two remaining `console.error` calls both sit beside a visible banner,
  which §23 allows.

`useConfirm` was already correct and stayed, as the brief asked.

### Persistence and the migration

`sticky_notes` gained `width`, `height`, `color`, `on_desktop`. `pos_x`/`pos_y` were
**reused** rather than replaced — they already held a position, and the old spawn
position becomes the desktop position in the same column, so the migration moves no
data. New columns carry defaults and existing notes default to **list-only**: placing
a note on the desktop is a user action, never something a migration decides. The
service moved to camelCase at the boundary (`x`/`y`, `onDesktop`) so no snake_case
reaches a React prop — the leak brief 71 named.

`color: null` is a real value, not "unset", so both the DTO and the optimistic cache
patch treat `undefined` and `null` differently; a plain spread would have made the
"clear colour" button do nothing.

### Gestures

Drag and resize use `setPointerCapture` in about twenty lines
(`usePointerDrag.ts`) rather than a new dependency — `framer-motion` and
`@use-gesture/react` are each a dependency of a *different* package, and neither
gives the thing that actually matters: **one write on release**, not a PATCH per
pointer move. Position and size are previewed locally during the gesture and
persisted once, optimistically, so a dropped note stays where it was dropped instead
of snapping back for the length of a round trip.

The clamp is a pure module (`noteGeometry.ts`) with its own tests, because it is the
one piece of this app that can *lose* data: a note dropped past the edge is
unreachable after a reload and no gesture brings it back. Horizontally a note-width
stays on screen; vertically the **header** does, since the drag handle is in it. Its
bounds match the DTO's, so a gesture can never produce a size the server would reject
— a 400 mid-drag would roll back and read as a broken drag.

### Found while probing, in no brief

- **The desktop layer changes when the notes query is warm**, and that is worth
  knowing for every future layer: the query now mounts at **page load** instead of
  when the window opens, so the cache lives for the whole session. That makes a stale
  cache reachable for the first time (a second tab, or brief 80's restore). Verified
  the failure is graceful: deleting a row whose id is already gone gets a 404, the
  user is told ("Could not delete that note."), and the list converges to the
  server's truth rather than showing a phantom row.
- It also invalidated an assumption in my own probes, which seeded data with raw
  `fetch` and then drove the UI. That used to be safe because the window mounted the
  query afterwards; now it leaves react-query holding pre-seed ids. The probes reload
  after seeding, and the reason is written into them — the next brief that adds a
  layer will hit this.

### Verified in a browser, against the production bundle on the real backend

```
PASS one Tab from the search field reaches a note row
PASS Enter alone opens that note, with the right content
PASS Delete confirms destructively and does NOT open the editor
PASS confirming deletes exactly that note, 3 -> 2, server agrees
PASS a stale delete (id removed out of band) notifies and self-corrects
PASS a note renders on the desktop with no window open, at 500,200
PASS all 23 desktop icons still lay out alongside it
PASS an icon still launches its app (Calculator)
PASS drag 500,200 -> 320,340 persists as one write
PASS resize 200x180 -> 280x240 persists as one write
PASS both survive a reload, along with text typed into the note
PASS a point inside an open window resolves to the window, not to a note
PASS the palette reads correctly in dark (muted) and light (pastel)
page errors: none
```

Tests: frontend vitest **811 → 828** (17 new in a package that had **zero** — the
desktop clamp and the palette/preview helpers), backend e2e **101 → 115** (14 new
covering auth on all four routes, the camelCase shape, the palette and size bounds,
`color: null`, place/unplace, and the migration of a pre-brief-74 row). Backend unit
unchanged at 208. All **100** turbo tasks green (the 100th is this package's new
`test`). Zero new dependencies.

`ui-conventions.md` was updated in the same pass: §45 rewritten from a defect list to
a fix record, the §35/§21/§23 citations repointed, the "NOT a template" line at the
top corrected, and §47–48 added for the desktop-layer contract.

Out of scope and untouched, as the brief specified: rich text, images in notes,
reminders, sharing, always-on-top, and the Trash mechanism itself — delete is still
permanent here and will route through Trash when that brief lands.
