# Brief 80 — Back up and restore the home volume, from inside the OS

Status: **done 2026-08-06** · From the 2026-07-31 real-OS parity research.
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

## Outcome — done 2026-08-06

Shipped, with every proposed decision either implemented or overruled in writing.
The README's `docker run` is no longer the answer; **Settings → Backup** is, and the
README now says so and explains why the host-shell route is worse (it copies
`db.sqlite` hot).

### The format question again, and again answered by reading the source

Brief 78 established the habit; this brief needed it twice more, and **both answers
changed the design**:

1. **`-C` is single-valued on busybox.** GNU tar's idiom — several `-C` interleaved
   with paths, so a manifest from one directory joins a tree from another — silently
   does something else on Alpine. busybox parses `C:` into one `base_dir` and calls
   `xchdir(base_dir)` **once, after option parsing** (`archival/tar.c`). Had this been
   assumed, the container would have produced an archive with the wrong root and
   nobody would have noticed until a restore. The manifest and the snapshot therefore
   live *inside* the tree being archived, at `.imbatranim/backup-staging/`.
2. **`--exclude` is unanchored in both tars**, matching at every `/` boundary. A bare
   `.imbatranim/db.sqlite` would also have eaten a user's own
   `Documents/.imbatranim/db.sqlite` — silently, which is the worst way for a backup
   to be wrong. Every pattern is written `./`-prefixed, which anchors it, because
   member names keep their `./`: measured on GNU tar 1.35, and read out of busybox's
   `exclude_file` plus `libbb`'s `strip_unsafe_prefix`, which strips a leading `/` and
   `../` but deliberately **not** `./`. There is a test that plants exactly that file
   and asserts it survives.

### The database is snapshotted, not copied

`db.sqlite` sits inside the volume being tarred, in WAL mode. Tarring it hot gives a
torn file *and* omits the `-wal`, so the archive would look fine and restore to a
database missing its most recent writes — or refusing to open at all. `VACUUM INTO`
(bound as a parameter, never interpolated) builds a checkpointed single-file copy from
a read transaction; the live trio is excluded and the snapshot rides along instead. A
test extracts it, opens it read-only, and reads back a row written moments before.

### Restore reuses the extractor by *splitting* it, not by copying it

`extractTar` became `stageTarExtraction()` + `mergeTree()`. Restore calls the staging
half — list, jail-check **every** declared member, fresh temp dir, `--no-same-owner`,
then the realpath walk with the symlink and hardlink guards — and does its own swap.
A second copy of a traversal check is a second place for it to rot.

**One resource bound moves and it is stated:** the 512 MB zip-bomb cap is right for an
archive a user found somewhere and wrong for a home volume, so restore passes a cap
derived from actual free disk. Traversal, symlink, hardlink, entry-count and
`--no-same-owner` are untouched.

### The swap is per-entry, with a real inverse

The home root cannot be renamed — it is the volume mount point — so the swap moves one
top-level entry at a time: park the live one, move the new one in. **The undo list
records one entry per completed rename, not one per name**, which is the difference
between a working rollback and a broken one: a failure *between* parking the old entry
and moving the new one leaves that name missing entirely, and a per-name record would
not know to put it back.

**Restore replaces what the backup declares and deletes nothing else.** Making home
exactly match the archive would mean deleting files created since — a bigger blast
radius than the word "restore" implies, and not what the confirmation asked about. The
UI says so in a sentence.

### Refusal before staging, not after

An archive without our manifest is not a backup. `inspect` lists the tarball, finds
`.imbatranim/backup-staging/manifest.json`, extracts **only** that member, and demands
positive identification — `product`, a `manifestVersion` this build understands, a
parseable date. The database snapshot is confirmed present in the staged tree *before*
anything moves: discovering it missing after the swap would leave a restored tree whose
database is not at the path the process reopens, i.e. an OS booting into its setup
screen with the user's data present but unreachable.

### Free space checked with a real number

`tar -tzv` gives the exact uncompressed total (parsed with brief 78's
`parseTarListLine`, reused), so the preview says `fits: false` before the user commits
and `apply` refuses with both figures rather than filling the volume and dying halfway.
`ENOSPC`/`EDQUOT` still translate to brief 83's sentence.

### Two decisions about who is allowed to do this

- **No password re-prompt on the download**, even though it is the most sensitive route
  in the OS. It grants nothing the session lacks: `db.sqlite`, password hash and TOTP
  secret included, is inside the home volume and already readable through `/api/files`.
  A prompt would be theatre.
- **A typed `RESTORE`, enforced on the server** (`@Equals`), not only in the UI. A UI
  check is not a guarantee, and a stray POST to this route replaces a home directory.

### Progress: the browser's, not ours

The download is an ordinary browser download, not a `fetch`. Drawing our own byte
counter would mean holding the whole volume in the tab's heap before a byte reaches
disk — precisely the failure the streaming backend exists to avoid. The panel adds the
number the browser cannot know instead: how big the backup will be, and what is left
out of it. If tar fails after headers are sent the socket is destroyed, so the client
gets a truncated gzip that fails its own CRC — a partial backup can never look complete.

### Verified in a browser, against the real backend and real hostile archives

```
PASS info names the exclusions rather than silently dropping them
PASS the browser downloaded imbatranim-home-2026-08-06.tar.gz (306 members)
PASS the live database is excluded; the manifest and snapshot are present
PASS the snapshot opens as SQLite with all 13 tables
PASS INSPECTING CHANGED NOTHING (directory snapshot identical before and after)
PASS an apply with no confirmation, or the wrong one, is refused with the word to type
PASS an unrelated tarball is refused, naming the missing manifest
PASS a plain file called .tar.gz is refused
PASS a crafted archive declaring ../ESCAPED.txt is refused; nothing escaped anywhere
PASS a crafted archive with a symlink to /etc is refused; no link was planted
PASS all four routes 401 without a session
PASS delete a file → restore → THE FILE IS BACK, byte for byte
PASS the staging dir is cleaned out and no scratch dirs are left behind
PASS the old session no longer authenticates, and auth/status agrees
PASS signing in again works and the restored file is listed
page errors: none
```

Tests: backend unit **319 → 356** (37 new). Frontend vitest unchanged at 1022; e2e
unchanged at 138. All 103 turbo tasks green. Zero new dependencies.

Out of scope and untouched, as specified: scheduled backups, remote destinations,
incremental/differential backups, per-app selective restore, and encrypting the archive.
