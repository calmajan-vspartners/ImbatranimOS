# Brief 79 — Trash: stop delete being forever

Status: **todo (ungrilled)** · From the 2026-07-31 real-OS parity research.
MEDIUM · backend `files` module + CORE + `apps/add-ons/file-manager`.
Standalone. **Highest-value parity item** — it is the only one that prevents
data loss rather than adding capability.

## Problem

Delete is immediate and irreversible. `FilesService.delete()` is
`fs.rm(..., { recursive: true })` (`files.service.ts:485-494`), and
`useDeleteFlow` batch-deletes an entire multi-selection behind a single confirm
(`useDeleteFlow.ts:47-56`). One mis-aimed confirm on a selected folder and the
work is gone: there is no bin, no undo, and — because the container's home is a
Docker volume most users never snapshot — usually no backup either.

Every desktop OS has a bin for exactly this reason, and this OS has a real
filesystem to put one on.

## Proposed decisions (ungrilled)

- **Follow the freedesktop Trash spec**, since the filesystem is real:
  `~/.local/share/Trash/{files,info}`, one `.trashinfo` per entry recording
  `Path=` and `DeletionDate=`. Using the real spec means the trash is
  intelligible from the Terminal too — on-soul, and free.
- **Delete becomes `fs.rename` into `Trash/files`.** Same filesystem, so it is
  atomic and instant regardless of size — unlike a copy, which would stall on a
  large folder and could half-fail.
- **`Delete` trashes; `Shift+Delete` keeps today's confirm-then-permanent.**
  The familiar contract, and it preserves a deliberate escape hatch.
- **Undo via the notification toast.** `notify()` already exists; a "Moved to
  Trash — Undo" toast makes recovery immediate for the common misclick, which is
  worth more than the Trash view itself.
- **`home` root only.** The `notes` root is a different directory
  (`files.service.ts:56`), so a cross-root rename would fail; `notes` keeps
  confirm-then-permanent. State this rather than silently having two behaviours.
- **Collisions get the spec's `-1`/`-2` suffixes.**
- **Trash is excluded from backup** (brief 80) and reported separately in
  Storage (brief 81's sibling) — a bin full of deleted files should not bloat an
  archive.
- **No auto-empty on a timer.** Silent deletion after N days is the same failure
  this brief exists to prevent. Show the size and let the user empty it.

## Fix

1. Backend: `DELETE /api/files?…&trash=1` renaming into the trash and writing the
   `.trashinfo`; `GET /api/files/trash` (list), `POST /api/files/trash/restore`,
   `DELETE /api/files/trash` (empty / delete one permanently). All behind the
   existing session guard, every path through `resolveSafe`.
2. Restore returns the entry to its recorded original path, re-validated through
   `resolveSafe` — **the recorded path is untrusted data**, since a crafted
   `.trashinfo` could otherwise write anywhere.
3. Frontend: a Trash node at the bottom of the folder tree and a desktop icon;
   inside, Restore / Delete permanently / Empty, showing each entry's original
   location.
4. `useDeleteFlow` routes to trash by default; Shift+Delete keeps the permanent
   path; success emits the Undo toast.

## Must preserve (regression surface)

- The FS jail: trash operations cannot escape the home root, and a hand-crafted
  `.trashinfo` cannot cause a write outside it.
- Batch delete still works and reports partial failure honestly.
- Deleting inside `notes` still behaves as today.
- No change to upload/download/move/copy semantics.

## Verify bar

`turbo typecheck`, lint + format green, `turbo build` ok. Backend tests:
trash→restore round-trip; collision suffixes; a `.trashinfo` with a traversal
path is refused on restore; empty removes everything; `notes` root unaffected.

**Security review before commit** — the reviewer will try a `.trashinfo`
containing `../`, an absolute path, and a symlink in the trash directory.

**Verified in a browser**: delete a file and undo from the toast; delete a
folder, find it in Trash with its original path, restore it; Shift+Delete for
permanent with a confirm; empty the Trash.

## Out of scope

Auto-empty policies, per-file version history, trash quotas, and restoring to a
different location.

## Outcome — 2026-07-31 (done)

Shipped. Backend `TrashService` + `TrashController` following the freedesktop
spec (`~/.local/share/Trash/{files,info}`, `.trashinfo` per entry), trashing by
`rename` so it is atomic regardless of size. `DELETE /api/files?trash=1` routes
to it for the `home` root only; `notes` and Shift+Delete keep the permanent
path. File Manager gains a Trash toolbar button and dialog (Restore / Delete
permanently / Empty), and the confirm copy now changes with the outcome —
claiming "cannot be undone" for a reversible move would train the user to
ignore the warning that matters.

**Security**: restore treats the recorded original path as untrusted, because a
`.trashinfo` is ordinary content inside the user's home — writable through the
normal files API and present in any archive they extract. It goes through
`resolveSafe` plus an explicit containment check. 20 tests including the
adversarial set: `../` traversal refused with the payload left in the trash, an
absolute path contained inside the jail rather than written to `/etc`,
percent-encoded traversal refused, and non-plain trash ids (`../x`, `a/b`,
`..`, `.`, empty) rejected on both restore and remove.

**Verified end to end in a browser**: DELETE ?trash=1 → 204, entry appears in
the Trash with its original path, disappears from home, the dialog lists it,
Restore puts it back, the trash empties, and both toasts fire.

**Deviations from the brief, deliberate**:

- **No Undo button in the toast.** `notify()` has no action/button support, so
  this would mean growing a shared core surface every app uses. Recovery is via
  the Trash dialog instead. Undo-in-toast is worth doing but should be a
  decision about the notification store, not smuggled in here.
- **Trash is a toolbar button + dialog, not a node in the folder tree** and not
  a desktop icon. The dialog delivers restore, which is the data-safety win; the
  tree node is presentation and can follow.

**Not done**: the desktop Trash icon, and the Storage/Backup integrations
(briefs 83 and 80 exclude and report it — they are not written yet).
