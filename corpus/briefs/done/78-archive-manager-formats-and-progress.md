# Brief 78 — Archive Manager: browse before extracting, and show progress

Status: **done 2026-08-05** · From the 2026-07-31 app+OS improvement sweep.
MEDIUM · add-on `apps/add-ons/archive-manager` (353 LOC) + backend
`apps/backend/src/modules/archive/`. Standalone.

## Problem

The backend is the most defensively written module in the repo: zip via
`fflate`, tar.gz via `execFile('tar', …)` — never a shell — every entry
re-validated through `resolveSafe` so zip-slip is structurally impossible,
extraction into a fresh jailed temp dir with a realpath walk before anything is
moved, ratio-bounded caps against amplification DoS, a hardlink guard,
`--no-same-owner`, and 13 tests. It was security-reviewed and hardened. Keep all
of it.

(Verified 2026-07-31: busybox `tar` does support `--no-same-owner` and the
`-czf`/`-tzf` forms used here, so unlike the `ps` and `git` cases this module is
**not** broken by the Alpine userland.)

The gaps are in what the user can do:

1. **You cannot look inside an archive without extracting it.** The service
   already lists entries (`tar -tzf`, and the zip central directory) to validate
   them — so the data exists; it just is not offered as a browsing view. Being
   able to see what is in a zip, and pull out one file, is most of what an
   archive manager is for.
2. **No selective extraction.** It is all-or-nothing.
3. **No progress.** A large archive extracts with no feedback, which is
   indistinguishable from a hang — and the module's own timeout and caps mean a
   big job can also fail after a long silence.
4. **Limited formats.** `zip` and `tar.gz` only. `.tar` and `.tgz` are trivial
   variants of code already present. `.tar.bz2` / `.tar.xz` depend on whether
   busybox tar in the shipped image supports them (**check the image before
   promising** — this is exactly the class of assumption that broke `ps` and
   `git`). `.7z` and `.rar` need new binaries or libraries and should be
   rejected unless there is a strong reason.
5. **No add-to-existing-archive**, and no password-protected zip support.
6. **Non-UTF8 entry names** (legacy Windows zips) will mangle; decide and state
   the behaviour.
7. **Error surfacing** should go through `notify()` — a failure during a long
   background extract must not be silent.

## Proposed decisions (ungrilled)

- **Browse-inside is the headline.** A read-only entry listing — name, size,
  compressed size, modified — from the existing listing path, with extract-
  selected as the natural follow-on. It reuses validation that already exists.
- **Selective extraction re-validates every chosen entry** through the same
  `resolveSafe` path as a full extract. The selection comes from the client and
  must be treated as untrusted input: an attacker-chosen entry name is exactly
  the zip-slip vector the module was hardened against.
- **Progress via polling a job, not a new transport.** Extraction becomes a job
  with an id; the client polls status/percent. This avoids adding a WebSocket
  for one feature, and it also gives long jobs somewhere to report failure.
- **Formats: add `.tar` and `.tgz` now** (already-present code paths).
  **Verify `.tar.bz2`/`.tar.xz` against the actual image before committing to
  them** — if busybox tar lacks them, either add the applet deliberately with a
  measured size delta or decline. **Reject `.7z` and `.rar`**: new binaries or
  libraries, licence questions for rar, for formats a Linux-oriented single-user
  OS meets rarely.
- **Password-protected zips: read-only support only if `fflate` can do it
  without a new dependency; otherwise decline clearly** rather than failing
  cryptically.
- **Non-UTF8 entry names: decode as UTF-8, replace invalid sequences, and warn.**
  Never write a filename the jail check cannot reason about.
- **Rejected — extracting into arbitrary paths chosen by the archive.** Already
  the case; restated because selective extraction is where it would creep back.

## Fix

1. Backend: a `list` endpoint returning validated entry metadata (reusing the
   existing listing + `verifyExtractedTree` idioms), authed and jailed.
2. Backend: `extract` accepting an optional entry subset, each re-validated;
   job-id + status endpoints for progress.
3. Frontend: entry browser with selection, extract-selected, and a progress
   indicator driven by the job status; `notify()` on completion and failure.
4. Add `.tar` / `.tgz`; probe the image for bz2/xz support and record the answer
   in the outcome either way.
5. Non-UTF8 handling + warning; clear refusal for encrypted zips if unsupported.
6. Add-to-existing-archive, if it can be done without weakening the temp-dir +
   realpath flow — if it cannot, drop it and say why.

## Must preserve (regression surface)

- **Zip-slip impossibility.** Every entry — including a user-selected subset —
  goes through `resolveSafe`; extraction still lands in a fresh jailed temp dir
  and is verified by a realpath walk before being moved into place.
- Ratio-bounded caps (the amplification-DoS fix), entry/size caps, the hardlink
  guard, `--no-same-owner`, and the tar timeout/maxBuffer.
- `execFile` only — never `exec`, never `shell: true`, array args.
- Routes stay authed; no `@Public()`.
- The file-manager context-menu integration keeps working.

## Verify bar

`turbo typecheck`, lint + format green, `turbo build` ok, backend tests green
including new cases for selective extraction.

**Security review before commit** — the reviewer will try: a selected entry name
containing `../`, an absolute path, a symlink entry pointing outside the jail, a
hardlink entry, a zip bomb against the ratio cap, a non-UTF8 name that decodes
into a traversal, and a job-id belonging to another request.

**Verified in a browser**: open a zip and read its contents without extracting;
extract two files out of a large archive; watch progress on a big extract;
compress a folder and re-open the result; confirm a malicious test archive is
still refused.

## Out of scope

`.7z`, `.rar`, creating encrypted archives, split/multi-volume archives,
repairing corrupt archives, and streaming extraction to the browser.

---

## Outcome — done 2026-08-05

Every gap addressed. The hardened module is unchanged in shape — same `execFile`,
same jail, same caps, same temp-dir-then-realpath-walk flow — and the new surface was
built to route *through* those guards rather than around them.

### The format question, answered by checking rather than guessing

The brief is explicit: **check the image before promising**, because this is the class
of assumption that broke `ps` and `git`. Docker pulls are blocked from this
environment, so it was checked the way brief 68 cleared `--no-same-owner` — from
busybox's own source and Alpine's build config
(`aports@3.22-stable main/busybox/busyboxconfig`, cross-checked on `3.21-stable`).

**The answer is asymmetric, which is exactly why a guess would have been wrong:**

| format          | read / list | create |
|-----------------|-------------|--------|
| `.tar`          | yes         | yes    |
| `.tar.gz`/`.tgz`| yes         | yes    |
| `.tar.bz2`      | yes         | yes    |
| `.tar.xz`       | **yes**     | **no** |

Reading uses busybox's *built-in* decompressors — `CONFIG_FEATURE_SEAMLESS_GZ`,
`_BZ2`, `_XZ` and `_LZMA` are all `=y`. Creating is a different mechanism: busybox tar
`vfork`s and `execlp`s a **separate compressor applet** (`archival/tar.c:573-621`), and
Alpine sets `CONFIG_GZIP=y` and `CONFIG_BZIP2=y` but **`# CONFIG_XZ is not set`** —
only `unxz`/`xzcat` exist. A `tar -cJf` would therefore die at exec time with a message
about `xz` that says nothing about the real cause.

So `.tar.xz` is offered for **extraction only**. `.tar.bz2` creation *would* work but is
not offered either: gzip and zip already cover the cases, and each extra creatable
format is another combination to keep tested for no user gain. `.7z` and `.rar` are
rejected as the brief directed.

**Also already true, and the brief was half-wrong about it:** `.tar` and `.tgz` were
*already* in `detectFormat`. The item asked to "add" them; they were there.

### Browse-inside, the headline

`GET /api/archive/list` returns names, sizes, dates and directory flags **without
extracting anything** — a zip is read from its central directory only, a tar via
`tar -tv`. The listing is proved inert by a test that snapshots the directory before
and after.

The load-bearing choice: **a refused entry is reported, not hidden.** Every declared
name goes through the same `resolveEntry` jail a real extraction uses, and one that
fails appears in `refused` with its reason. A listing that silently dropped the
dangerous entries would be a listing that lies about the file — and the UI turns that
into a banner naming them, so the user learns the archive is hostile *before* pressing
anything.

### Selective extraction, treated as the attack surface it is

A selection is client input, which makes it a new road to the zip-slip machinery. Three
guards, all tested:

1. Each chosen name goes through `resolveEntry` exactly as a full extract would.
2. A name the archive **does not declare** is refused outright, rather than passed to
   tar and hoped over — that is a client inventing a path.
3. **Every** declared entry is still jail-checked, not just the selected ones. Otherwise
   a selection would be a way to sneak past the check by simply not selecting the bad
   entry. Verified: a zip containing one safe file and one `../` entry is refused *even
   when only the safe file is selected*.

For tar, chosen members are appended after `--`, so a member named `-rf.txt` cannot be
read as an option. Tested with a real archive containing exactly that.

### Progress by polling, not a new transport

Extraction can start as a job and return an id. A WebSocket for one feature would be a
second realtime channel to secure; an id plus a status endpoint reuses the guard that
already exists. The id is a **CSPRNG UUID, not a counter** — it is the only thing naming
a result, so it must not be guessable by another request — and jobs expire and are
capped so the map cannot grow.

The failure path matters as much as the progress: a job that dies minutes in reports
`state: 'failed'` with the service's own sentence ("Refusing archive entry that escapes
the destination: …") instead of ending in silence.

### Non-UTF8 names, decided and stated

**Decode as UTF-8, replace invalid sequences, and flag the row as repaired.** Not a
CP437 guess: the "names are UTF-8" flag is frequently wrong in the wild, and a
mis-guessed codepage produces a *different* wrong name with no warning attached. A
replacement character is visibly wrong, which is the honest failure, and the UI marks
the row so the user knows the extracted filename will differ. The replacement is also
slash- and NUL-free, so a repaired name cannot become a traversal the raw bytes were
not.

### Encrypted zips, declined clearly

Detected from the general-purpose bit and surfaced as a banner with the reason.
`fflate` cannot decrypt, and adding a crypto dependency for legacy ZipCrypto — broken
anyway — is not a trade worth making. Extract is disabled rather than failing
cryptically part-way through.

### Add-to-existing-archive: dropped, with the reason

The brief allowed dropping it if it could not be done without weakening the
temp-dir + realpath flow. It cannot, cleanly: appending means either rewriting the
archive (read everything, re-pack — which is "compress" with extra steps and the same
caps) or `tar -r`, which does not work on a compressed tar at all, and for zip means
mutating a file in place with no staging copy to verify before committing. Both give up
the property that a failed operation leaves the original untouched. Not worth it for a
verb the user can reach by extracting and re-compressing.

### Verified in a browser, against real archives and a real malicious one

```
PASS a 43-entry zip lists its entries, with sizes, dates and directory flags
PASS listing extracted NOTHING (directory snapshot identical before and after)
PASS a .tar.bz2 lists, with sizes and dates — the verified read format
PASS the malicious zip's ../../ESCAPED.txt is REPORTED as refused, with its reason
PASS extracting that archive is refused (400) and nothing escaped anywhere
PASS a selected entry of ../../etc/passwd, /etc/passwd or an invented name is refused
PASS extracting 2 chosen files out of 43 writes exactly those 2
PASS the other 41, including the 40 padding files, are NOT written
PASS a job returns a UUID id, reaches done at 100%, and carries its result
PASS a failing job reports state=failed WITH the human reason
PASS an unknown job id 404s
PASS compressing a folder and re-opening the result lists all 43 entries
PASS all three new routes 401 without a session
page errors: none
```

Tests: backend unit **287 → 319** (32 new — listing, selective extraction and its three
attack cases, jobs, the format matrix including a real `.tar.xz` round trip, and the
pure helpers for name repair, DOS timestamps and `tar -tv` parsing). Frontend vitest
unchanged at 1022; backend e2e unchanged at 138. All 103 turbo tasks green. Zero new
dependencies.

Out of scope and untouched, as specified: `.7z`, `.rar`, creating encrypted archives,
split/multi-volume archives, repairing corrupt archives, and streaming extraction to
the browser.
