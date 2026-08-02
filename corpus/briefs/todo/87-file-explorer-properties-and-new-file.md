# Brief 87 — File Explorer: Properties, and New File with any extension

Status: **todo (user-requested 2026-08-02)** · EASY/MEDIUM ·
add-on `apps/add-ons/file-manager`. Standalone. Consumes brief 83's
`/api/files/size`. Overlaps brief 55 (which also lists Properties) — **this
brief owns Properties; 55 keeps sorting, view modes and the hidden toggle.**

## Problem

The user asked for a right-click menu that can create, rename and show
properties. Two of the three already exist and shipped some time ago, which is
worth stating plainly rather than rebuilding:

- **Rename** — exists (`lib/buildMenuItems.tsx:143`).
- **Create** — partially: the empty-space menu offers *New Folder*, *New
  Spreadsheet* and *New Document* (`:77-87`). There is **no generic "New File"**,
  so a `.txt`, `.js`, `.env` or any other extension cannot be created from the
  file manager at all.
- **Properties** — **absent entirely.** Nothing anywhere in the OS reports a
  file's size, type, permissions or timestamps, and a folder's recursive size
  had no backend until brief 83 added `/api/files/size`.

So the real gaps are Properties and an arbitrary-extension New File.

## Decisions

- **Properties dialog** from the context menu and `Alt+Enter`: name, full path,
  type, size (bytes + human), created/modified, and POSIX permissions. Folder
  size uses `/api/files/size`, which is bounded — show the `+` and the "walk hit
  its bound" caveat exactly as Settings → Storage does, rather than a number
  that is quietly a floor.
- **Folder size is computed on demand**, not on open — a recursive walk on a
  large tree is slow, and Properties must appear instantly.
- **New File… prompts for a full filename including extension**, using the
  existing `usePrompt`. The extension then drives `openWith`, so a new `.md`
  opens in Markdown Editor and a new `.ts` in Code Editor with no extra wiring.
- **Keep the existing typed shortcuts** (New Folder / Spreadsheet / Document) —
  they are faster for the common cases; New File is the escape hatch.
- **Refuse a name that is not a bare filename** (`/`, `\`, `..`, NUL) client-side
  with a clear message, and rely on `resolveSafe` server-side regardless.
- **Rejected — an editable permissions UI.** Displaying the mode is useful;
  changing it needs `chmod` semantics, and a single-user container with no sudo
  has almost no case for it.

## Fix

1. `PropertiesDialog.tsx` — core `Dialog`; a definition list; folder rows fetch
   `/files/size` on mount with a "Calculating…" state and the truncation caveat.
2. Backend: extend the existing entry shape (or add a `stat` endpoint) so
   Properties can show `mode`, `createdAt`. Prefer extending `toEntry` — one
   listing already returns most of it.
3. `buildMenuItems.tsx`: add **Properties** to the entry menu (bottom, above
   Delete) and **New File…** to the empty-space menu beside New Folder.
4. `Alt+Enter` on the selected entry opens Properties, registered through the
   brief-86 shortcut registry so it is discoverable.

## Must preserve (regression surface)

- The existing context-menu items keep working, including Extract/Compress and
  the Trash-aware Delete from brief 79.
- The FS jail: a typed filename never reaches disk without `resolveSafe`.
- Properties on a huge folder must not block the UI or hang — bounded walk only.

## Verify bar

`turbo typecheck`, lint + format green, `turbo build` ok. Backend test for any
new stat field. **Verified in a browser**: right-click a file → Properties shows
real size/permissions; right-click a folder → size resolves and a truncated walk
is marked; New File… → type `notes.md` → it appears and opens in Markdown
Editor; a name containing `/` is refused.

## Out of scope

Editing permissions, sorting/view modes/hidden toggle (brief 55), multi-select
Properties, and file previews inside the dialog.
