# Brief 80 — Back up and restore the home volume, from inside the OS

Status: **todo (ungrilled)** · From the 2026-07-31 real-OS parity research.
MEDIUM · backend (`archive` + a backup controller) + CORE Settings. Land after
brief 79 so the Trash can be excluded.

## Problem

The only backup path the product offers is a host shell command in the README:
stop thinking about the OS, run `docker run --rm -v imbatranim-home:… alpine tar
czf …` (`README.md:90-95`). That is a workaround, not a feature, and it is
**impossible for two of the product's own audiences**: anyone using the kiosk
ISO (brief 18) has no host shell at all, and anyone handed a running instance on
a VPS has no reason to have docker access.

Meanwhile the OS holds the user's entire life — files, notes, todos, sticky
notes, bookmarks, calendar, credentials — in one volume, and the README's own
answer to a forgotten password is "delete the volume". A product that tells you
to delete your data as a recovery step should be able to back it up first.

## Proposed decisions (ungrilled)

- **Stream the archive to the HTTP response.** Do not write a tarball into the
  tree being archived — that is both a recursion trap and a disk-space trap on a
  volume that may already be near full. Reuse `archive.service`'s compression
  path but pipe it out.
- **Snapshot SQLite properly.** `db.sqlite` must not be tarred while open — a hot
  copy can be torn. Use `VACUUM INTO` through the db service to produce a
  consistent snapshot, and archive that.
- **Exclude the Trash** (brief 79) and any temp/scratch directories.
- **Restore reuses the hardened extractor.** `extractTar` + `verifyExtractedTree`
  (`archive.service.ts:262,322`) already do traversal-safe extraction with caps —
  restore must go through them, not a new path.
- **Restore is explicitly destructive.** It overwrites the home directory, so:
  show what will be replaced, require a typed confirmation, and force
  re-authentication afterwards (the credential store itself is being replaced).
- **Verify the archive before applying it.** Check it is a plausible ImbatranimOS
  backup (expected top-level layout, a manifest with version and date) and refuse
  an arbitrary tarball. Restoring an unrelated archive over `$HOME` would be a
  spectacular footgun.
- **Rejected — scheduled/automatic backups in this brief.** They need the cron
  work (Tier 2) and a destination, and "nightly backup" only becomes meaningful
  once manual backup exists. Sequence it after.
- **Rejected — backing up to a remote destination.** Credentials and egress; out
  of scope for a single-user local OS. The download is the transport.

## Fix

1. Backend `backup` controller, owner-authed: `GET /api/backup` streams
   `imbatranim-home-YYYY-MM-DD.tar.gz` with a manifest; `POST /api/backup/restore`
   accepts an upload and applies it through the hardened extractor.
2. SQLite snapshot via `VACUUM INTO` into a temp path, archived, temp removed.
3. Settings → **Backup** section: "Back up now" with a live byte counter, and
   "Restore from file…" showing the manifest's date and contents, then a typed
   confirm, then a forced logout.
4. Handle a full volume during restore (`ENOSPC`) with a real message rather than
   a 500.

## Must preserve (regression surface)

- The extractor's guarantees on restore: traversal-safe, ratio-capped, hardlink
  guard, `--no-same-owner`, fresh temp dir + realpath verification.
- Both routes owner-authed; no `@Public()`. A backup endpoint is a full data
  exfiltration path if it is ever unauthenticated — this is the single most
  security-sensitive route in the OS.
- Streaming must not buffer the whole archive in memory.
- A failed or aborted restore must not leave the home directory half-replaced —
  stage, verify, then swap.

## Verify bar

`turbo typecheck`, lint + format green, `turbo build` ok. Backend tests: backup
round-trips through restore with files intact; the db snapshot is a valid
SQLite file; an unrelated tarball is refused; auth is required on both routes; a
traversal entry in a crafted backup is refused.

**Security review before commit** — the reviewer will try an unauthenticated
backup download, a crafted archive with `../` entries, a symlink to `/etc`, and
a zip-bomb ratio.

**Verified in a browser**: take a backup, download it, delete a file, restore,
confirm the file returns and you are asked to sign in again. Take a backup on a
near-full volume and read a sane error.

## Out of scope

Scheduled backups, remote destinations, incremental/differential backups,
per-app selective restore, and encryption of the archive.
