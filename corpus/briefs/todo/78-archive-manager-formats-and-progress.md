# Brief 78 — Archive Manager: browse before extracting, and show progress

Status: **todo (ungrilled)** · From the 2026-07-31 app+OS improvement sweep.
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
