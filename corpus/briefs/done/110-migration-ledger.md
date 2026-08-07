# Brief 110 — Migration ledger: PRAGMA user_version, expected-skip vs real failure

> **Outcome (2026-08-07): DONE.** `migrate()` is now an ordered list of six
> numbered steps (baseline, sticky-note columns, todo columns, bookmark shape,
> totp_last_step, backfills) carved out of the old 280-line body **verbatim**,
> driven by `PRAGMA user_version`; each step and its stamp share a transaction,
> so a throwing step leaves the stamp where it was and the next boot resumes at
> exactly that step. A current database now boots on one PRAGMA read. The six
> bare `catch {}` blocks became narrow expected-skips through one shared
> `isAlreadyApplied(err, pattern)` — `/duplicate column name/` for ADD COLUMN,
> `/no such column/` for the href→url rename — so SQLITE_FULL/IOERR/READONLY
> surface instead of reading as "column already exists". A failure is state,
> not a crash: `migrationFailure` is set, `db.migrate.failed` is recorded via
> an `@Optional()` LogService plus stdout, boot continues, a new
> `StorageHealthGuard` (APP_GUARD in DbModule) answers every API request with
> 503 naming the failed step, and `/health` reports `degraded` **at 200**.
>
> Two things the fixtures taught, worth recording: `chmod 444` cannot simulate
> a write failure here because the container runs as root, so the failure test
> obstructs the schema instead (a VIEW named `sticky_notes`, which slips past
> `CREATE TABLE IF NOT EXISTS` and fails step 2's ALTER with a plain
> SQLITE_ERROR — precisely the class the old catch swallowed); and any column
> that exists only in the baseline CREATE is never backfilled onto an older
> table, so **new columns must always ship as their own step**, which the
> ledger now makes safe (steps added after this brief get no catch at all).
>
> Every spec that replays `migrate()` to exercise a historical repair now
> resets the stamp first — one unit spec and three e2e suites — which is the
> honest way to say "simulate an old database".
>
> Verified: a new 5-case `db.service.spec` (fresh stamps at 6; an old-shape DB
> migrates to a schema byte-identical to a fresh one with its rows intact; a
> pre-ledger DB converts then runs zero steps; a real failure records, refuses
> to stamp past the step and 503s, then recovers; a `VACUUM INTO` snapshot
> carries the stamp so brief-80 restores stay current). turbo 120/120, backend
> 431 unit + 141 e2e. Against a running instance: an obstructed database gave
> `/health {"status":"degraded", reason…}` at 200 and `/api/auth/status` 503
> naming the step, with `[db] migration 2 …` on stdout; clearing it and
> rebooting returned `ok`. And the live dev database — a genuine in-use
> pre-ledger DB at version 0 — converted in place on boot: 14 tables before,
> 14 after, stamped 6.

Status: **done 2026-08-07** · From the 2026-08-07 research sweep. EASY
(backend-only; the fixture tests are most of the work) · BACKEND
(`db/db.service.ts`, `db/db.module.ts`, one guard, `main.ts` `/health`).
Uses brief 84's `LogService.record` for surfacing; must keep brief 80's
restore path (`replaceWith` → `migrate`, `db.service.ts:70`) bringing old
backups forward. No new deps.

## Problem

1. **Real failures read as "column already exists".**
   `migrate()` guards its historical ALTERs with six bare `try/catch` blocks
   (`db.service.ts:290-301, 306-322, 330-334, 336-349, 350-356, 366-370`)
   whose catch-all swallows SQLITE_FULL, SQLITE_IOERR and SQLITE_READONLY the
   same as a duplicate column. A disk-full boot — the exact condition brief
   83 exists for — leaves the schema silently half-migrated; every later
   INSERT naming the missing column 500s, and the `AuditExceptionFilter`
   dutifully records `server.error` lines that point nowhere near the cause.
2. **All of history replays every boot.** `migrate()` is ~280 lines
   (`db.service.ts:96-375`) re-running a `table_info` probe, six ALTER
   attempts and three backfill scans (`:372-374`) on every start — and it has
   grown with every storage brief (71, 72, 73, 74, 75, 84, 93, 94). Each new
   step makes the swallow surface bigger.
3. **Nothing is honest afterwards.** `/health` says `ok` unconditionally
   (`main.ts:42-47`); the user experiences a half-working Todo/Calendar with
   cryptic errors instead of one sentence saying storage needs attention.

## Proposed decisions (ungrilled)

- **`PRAGMA user_version` is the ledger.** `migrate()` becomes an ordered
  list of numbered steps; on boot it reads the stamp, runs only steps above
  it, and stamps after each. A current database boots on one PRAGMA read.
  Rejected: a migrations *table* (a second thing to migrate; `user_version`
  is SQLite-native, and VACUUM preserves it, so brief-80 snapshots made with
  `VACUUM INTO` carry their version).
- **Replay-history model stays.** Fresh databases run all steps from 0; the
  baseline `CREATE TABLE IF NOT EXISTS` block remains step one, and the
  historical ALTERs remain later steps — carved out verbatim, not rewritten.
  Rejected: folding the final shape into the baseline CREATEs (two schema
  sources that drift; migrated and fresh databases must be byte-comparable).
- **Never blind-stamp a version-0 database.** A pre-ledger database that is
  fully migrated and a restored 2026-01 backup are *both* `user_version = 0`;
  only running the steps tells them apart. So the conversion is: run every
  step with **narrow** expected-skip catches — `/duplicate column name/` for
  the ADD COLUMNs, `/no such column/` for the `href`→`url` rename — and
  rethrow everything else. Rejected: "probe the schema once and stamp
  current" (skips needed steps on exactly the restored-old-backup case the
  backlog row warns about).
- **Steps added after this brief get no catch at all.** The ledger guarantees
  once-only execution, so an error is always real and always surfaces.
- **A real failure is state, not a crash.** `migrate()` catches a failed
  step, records `db.migrate.failed` (step number, SQLite code, message) via
  brief 84's `LogService.record` (`log.service.ts:131`) plus Nest's stdout
  logger, sets `DbService.migrationFailure`, and lets boot continue.
  Rejected: throwing out of `onModuleInit` — a restart-looping container
  with no UI, and on the kiosk ISO no host shell to read why, which is brief
  84's founding rationale.
- **Honest 503 while degraded.** A small guard registered via `APP_GUARD`
  (precedent: `auth.module.ts:26`, `logs.module.ts:22`) rejects API requests
  with `ServiceUnavailableException('System storage needs attention: …')`
  while `migrationFailure` is set. `/health` reports
  `{ status: 'degraded', reason }` **at HTTP 200** — a compose healthcheck
  restart cannot fix a half-migrated disk, and flapping the container hides
  the message. Rejected: letting reads through and 503ing writes only (a
  half-schema serving "most" routes is how data gets corrupted confidently).
- **The backfills become steps** (`backfillTodoPositions`,
  `backfillBookmarkPositions`, `adoptOrphanedBookmarkLinks`) and run once:
  each was a one-time repair whose recurring cause is fixed at the service
  layer; the ledger retires their every-boot scans. Their self-guards stay
  in the step body (harmless, and correct during the 0→N conversion).

## Fix

1. `db/db.service.ts`: `const MIGRATIONS: { toVersion: number; name: string;
   run(db: Database): void }[]` — the current body carved into steps in
   exact current order: baseline schema; `recent_files` shape probe + drop
   (`:103-108`); `todo_lists`; sticky-notes columns; todos columns;
   bookmarks rename + columns + index; `totp_last_step`; the three
   backfills. `migrate()` = read `user_version`, run pending steps (each
   step + stamp in a transaction), top-level catch → `migrationFailure` +
   audit record + stdout.
2. Historical steps keep only the narrow expected-skip matchers (decision
   above), via one shared `isAlreadyApplied(err, pattern)` helper so the
   discrimination is a rule, not six copies.
3. `LogService` arrives as an `@Optional()` constructor argument — the many
   specs doing `new DbService(config)` stay one-argument, and partial e2e
   graphs without `LogsModule` resolve it to undefined (the stdout line
   still fires). Note: `record()` drops lines before `LogService` is ready;
   the builder verifies init order or records on the guard's first block —
   either way the flag and stdout carry the truth.
4. New guard (in `db/`), registered via `APP_GUARD` in `DbModule`; `main.ts`
   `/health` handler reads `app.get(DbService).migrationFailure`.
5. `recent.service.spec.ts:58-76` re-runs `migrate()` after recreating the
   pre-94 table — it must now also reset the stamp
   (`db.db.pragma('user_version = 0')`) to simulate an old database; same
   for any other spec that replays migration.
6. New `db/db.service.spec.ts` with fixture builders, both directions:
   **(a) forward** — a script-built old-shape DB (pre-94 `recent_files`,
   pre-73 `todos` without `position`, `href` not yet `url`, version 0)
   migrates to a schema identical to a fresh one (compare `sqlite_master` +
   `table_info` dumps) with the stamp set; **(b) current** — an
   already-migrated pre-ledger DB (version 0, all columns present) converts
   cleanly via the expected-skips and re-running `migrate()` afterwards
   executes zero steps; **(c) failure** — a DB opened `{ readonly: true }`
   (or a step forced to throw SQLITE_FULL) sets `migrationFailure`, does not
   stamp past the failed step, and the guard 503s; a later successful
   `migrate()` resumes from the stamp and clears the flag.

## Must preserve (regression surface)

- `migrate()` stays public and re-callable on a live connection (specs
  depend on it; `:memory:` databases are per-connection —
  `db.service.ts:89-95`).
- `replaceWith` still runs `migrate()` after the swap (`:56-72`), and the
  reopen-no-matter-what `finally` contract holds; brief 80's restore of an
  old backup ends fully migrated (extend `backup.brief80.spec.ts` if it
  doesn't already prove this).
- `snapshotTo`'s `VACUUM INTO` output carries the stamp — assert
  `user_version` in the snapshot equals the source's.
- Final schema is unchanged, table by table — the fixture comparison in Fix
  6a is the pin.
- WAL mode, the single-user auth schema, and every service's `this.db.db`
  call-time access pattern untouched.
- No `@Public()` anywhere new; `/health` stays outside the API prefix and
  keeps returning 200.

## Verify bar

`turbo typecheck`, lint + format, `backend#test` (the new db.service spec +
the adjusted recent.service spec + backup e2e still green), `turbo build`.

**Verified against a running instance**: with a deliberately failed
migration (readonly DB file), `curl /health` shows
`{ status: 'degraded', reason: … }`, any `/api/*` request returns 503 whose
body names the failed step, and the audit log (or stdout) carries
`db.migrate.failed`; a browser probe shows the sign-in attempt surfacing a
visible storage error rather than a spinner or silence. With the file
writable again, the next boot resumes from the stamp and everything serves.

## Out of scope

A frontend "storage needs attention" screen beyond what the 503 body already
yields (grill decides if it earns a brief); down-migrations (restore-a-backup
is the rollback story, brief 80); enabling `PRAGMA foreign_keys` (its
absence is documented and load-bearing at `:312-315,336-341`); moving
migrations to files or a framework; touching any module's own queries.
