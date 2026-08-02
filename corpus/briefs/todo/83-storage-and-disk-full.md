# Brief 83 — Storage: say what is using the disk, and behave when it fills

Status: **todo (ungrilled)** · From the 2026-07-31 real-OS parity research.
MEDIUM · backend (`files` + `system`) + CORE Settings. Land after brief 79 so
the Trash can be reported as its own line.

## Problem

`getDiskStats()` already knows the volume is, say, 89% full
(`system.service.ts:158-182`, and the Tray shows it), but **nothing can say
why**, and nothing does anything about it:

1. **No breakdown.** There is no way to find what is consuming the volume — no
   per-directory sizes anywhere in the OS, and the file manager has no folder
   size (brief 55 adds Properties, which wants the same backend capability).
2. **No `ENOSPC` handling.** Nothing in `files.service.ts` distinguishes a
   full-disk write failure, so a full volume surfaces as a raw 500. The user is
   told "something went wrong" while saving, with no hint that the disk is full
   and no way to find out.
3. **No warning before it happens.** The Tray polls the percentage already, so
   the data to warn on is being fetched every 1.5s and thrown away.

A container volume filling up is a *likely* failure mode for this product — one
big download, one large archive extract, or an accumulating Trash — and today it
presents as random unexplained save failures. That is the worst kind of bug: it
looks like the OS is broken rather than out of space.

## Proposed decisions (ungrilled)

- **Compute directory sizes in Node, not by shelling out to `du`.** Same lesson
  as the `ps` fix: do not depend on which userland the image happens to have.
  Reuse the bounded-walk idiom from `searchBounds()`
  (`files.service.ts:214-231`) for entry, depth and time caps, so a size query
  cannot become an unbounded walk.
- **Map `ENOSPC` and `EDQUOT` to a real error** with a human message
  ("The disk is full — free some space and try again"), surfaced through
  `notify()` so a save failing in a background window is visible. This is a small
  change with outsized value.
- **Warn at a threshold off the existing Tray poll** (90%, once per session, not
  every 1.5s), rather than adding a second poller.
- **Settings → Storage**: the volume bar, a top-level breakdown (Documents,
  Pictures, Trash, `.imbatranim`, …) and drill-down.
- **Rejected — real-time usage watching.** Recomputing sizes continuously on a
  large tree is expensive for a number that changes slowly. Compute on demand,
  cache briefly, and let the user refresh.
- **Rejected — quotas.** There is one user; a quota would only ever be a
  self-imposed limit, and enforcing it means intercepting every write.

## Fix

1. Backend: `GET /api/files/size?path=…` returning a recursive size with the
   bounded-walk caps and a `truncated` flag when a cap was hit — an honest
   partial number beats a hang. Authed and jailed like every files route.
2. Backend: wrap write paths so `ENOSPC`/`EDQUOT` become a typed error the
   controller maps to a clear response.
3. Frontend: Settings → Storage section (bar, breakdown, drill-down, refresh);
   the 90% warning fired once per session from the existing stats query; a Trash
   line linking to brief 79's view.
4. File manager Properties (brief 55) consumes the same size endpoint — one
   implementation, two consumers.

## Must preserve (regression surface)

- The size walk is bounded and cannot be turned into a DoS by pointing it at a
  huge tree; it never follows symlinks out of the jail.
- Existing `/api/system/stats` shape stays backward-compatible.
- Normal write errors (permissions, too-large upload) keep their current
  distinct messages — `ENOSPC` handling must not swallow them.
- The Tray's existing poll is reused, not duplicated.

## Verify bar

`turbo typecheck`, lint + format green, `turbo build` ok. Backend tests: size of
a known tree; the `truncated` flag when a cap is hit; symlink-out-of-jail not
followed; an `ENOSPC` (mocked) produces the typed error rather than a 500.

**Verified in a browser**: Settings → Storage shows a breakdown that roughly
matches `du` in the Terminal; drill into the largest directory; fill the volume
(a large `dd` in the Terminal against a scratch file) and confirm a save now
reports a full disk clearly and a warning toast appears — then delete the file
and confirm recovery.

## Out of scope

Quotas, real-time watching, a dedicated disk-usage-analyzer app, per-app storage
attribution, and automatic cleanup.
