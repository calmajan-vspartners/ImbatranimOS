# Brief 84 — A system log and a security audit trail

Status: **done 2026-08-06** · From the 2026-07-31 real-OS parity research.
MEDIUM · new backend `logging` module + a new `logs` add-on + Settings.
Land after brief 47, so a caught app crash has somewhere to land.

## Problem

**The machine has no memory of itself.** `/var/log` is empty — no syslogd runs,
and `entrypoint.sh:14` `exec`s node as PID 1, so the Nest logger writes to stdout
and only `docker logs` ever sees it. From inside the OS — and on the kiosk ISO,
where there is no host shell at all — none of the following can be reviewed after
the fact:

- failed logins and throttle lockouts (`throttle.service.ts`),
- TOTP enrolment, enablement or removal,
- process kills, file deletions,
- backend errors and, once brief 47 lands, app crashes caught by an error
  boundary.

For a single-user OS the README recommends exposing to the internet, "was anyone
trying to log in as me last week?" is a question the product cannot answer. That
is a genuine hole, not a nice-to-have.

Note this brief deliberately does **not** try to make `/var/log` real. The
kill-list refuses a syslog daemon, and adding one to a single-process container
would be cargo-culting Linux rather than borrowing from it.

## Proposed decisions (ungrilled)

- **A logger transport inside the existing process, not a daemon.** A Nest logger
  transport writing JSONL to `~/.imbatranim/logs/system.log`. No new process, no
  supervisor — which keeps the kill-list intact.
- **Size-capped rotation with no dependency**: two files of ~2 MB. Logs must
  never be the thing that fills the volume (brief 83).
- **Explicit `audit(event, meta)` calls at the security-relevant sites** — auth
  success/failure, throttle lockout, TOTP change, password change (brief 57),
  process kill, permanent delete, restore (brief 80). An audit trail assembled
  from incidental log lines is not a trail; the call sites should be deliberate.
- **Never log secrets.** No passwords, no TOTP codes or secrets, no session
  tokens, no file *contents*. Log the event and the outcome. This needs saying
  in the code, because a log written by the app that also handles credentials is
  exactly where a secret leaks.
- **The read endpoint is tail-oriented** — last N lines with level and text
  filters — so the app never loads a whole file into memory.
- **A `Logs` add-on**: level chips, text filter, a "Follow" toggle polling the
  tail, click a row to expand its JSON. Plus **Settings → Security gains "Recent
  sign-ins"** built from the same events, which is where a user would actually
  look.
- **Rejected — a syslog daemon or a systemd-journal analogue.** Kill-list, and
  there is one process to log.
- **Rejected — shipping logs anywhere.** No remote collector, no telemetry. The
  logs stay in the volume, and they are covered by brief 80's backup.

## Fix

1. Backend `logging` module: JSONL transport + rotation; `audit()` helper;
   wire the call sites listed above.
2. `GET /api/logs?level=&q=&limit=` reading the tail, authed and owner-scoped.
3. New add-on `apps/add-ons/logs` consuming it — virtualized list (`useVirtualList`),
   level chips, filter, Follow toggle.
4. Settings → Security: "Recent sign-ins" from the auth events.
5. Once brief 47 exists, its error boundary writes an audit event on catch.

## Must preserve (regression surface)

- No secret ever reaches the log — assert it in tests for the auth paths
  specifically.
- Rotation is bounded: a flood cannot exceed the cap, and log writes must not
  block or crash a request path if the disk is full.
- The read route is authed; log content is as sensitive as the events it
  records.
- Nest's existing stdout logging keeps working for `docker logs`.
- No new process, no supervisor.

## Verify bar

`turbo typecheck`, lint + format green, `turbo build` ok. Backend tests:
rotation at the cap; a failed login writes an audit event and does **not**
record the attempted password; the read endpoint filters and never returns more
than `limit`; a write failure does not break the request that triggered it.

**Verified in a browser**: fail a login three times, then open Logs and see the
failures and the lockout; kill a process and see the audit entry; check Settings
→ Security shows recent sign-ins; leave Follow on and watch new entries arrive.

## Out of scope

A syslog daemon, remote log shipping, telemetry, structured metrics, log
retention policies beyond the size cap, and making `/var/log` real.

## Outcome — done 2026-08-06

Shipped, with the brief's central proposal **overruled using the brief's own
argument** and everything else built as specified.

### Not a logger transport — an audit log with deliberate call sites

The brief proposes "a Nest logger transport writing JSONL". Two paragraphs
earlier it says the thing that rules that out: *"an audit trail assembled from
incidental log lines is not a trail"*. A transport would pour every
`RouterExplorer` mapping line into the file, pushing the events that matter out
of the 2 MB rotation window faster, and swapping the global logger puts the
stdout path this brief asks to preserve at risk for no gain.

So: **Nest's logging is untouched**, and `LogService.record()` is called on
purpose at the sites that matter — sign-in success and failure, lockout (per-IP
and app-wide), password change and refusal, TOTP on and off, machine claim,
process kill, permanent delete, Trash emptied, backup taken and restored. Backend
errors arrive through an exception filter that records **only 5xx**: a 404 or a
400 is the system working, and logging refusals would bury real incidents inside
minutes. The filter extends `BaseExceptionFilter` and delegates, so no response
changes — an audit trail that alters behaviour is a liability, not a record.

No daemon, no supervisor, no second process. `/var/log` stays empty, as the brief
directs.

### Never logging a secret, enforced rather than promised

Redaction happens **in `record()`**, not at the call sites: a rule applied in one
place is a rule; a rule each caller must remember is a leak waiting for the one
caller who forgets. Deny-by-key-name, erring towards dropping — `pass`, `secret`,
`token`, `otp`, `code`, `cookie`, `authorization`, `credential`, `salt`,
`session`, `*key`, and **`hash`**, because an argon2 hash is the input to an
offline cracking attempt and a log file is far easier to end up in a bug report
than a database is.

The failed-login site goes further and never hands the DTO to the logger at all —
the safest secret is the one the logger never sees. **Verified against the real
server**: three refused sign-ins are in the file, and neither the attempted
password nor the real one appears anywhere in it.

Also bounded, because a log line must never be the thing that breaks: strings
truncate at 512 chars, an entry caps at 8 KB with its metadata dropped rather
than the event, cycles and unserialisable values are described instead of thrown,
and `JSON.stringify` escapes newlines so one entry can never split into two
unparseable ones.

### Rotation, and a write that cannot break a request

Two files at 2 MB, rotated by `rename` (atomic, and free regardless of size).
Writes are **fire and forget** through a serialising queue: nothing awaits them,
so a full disk cannot fail the request that triggered it, and the failure is
reported once to stdout and then swallowed. A login must not stop working because
the audit log cannot be written — that turns a disk problem into a lockout.

### Reading the tail without reading the file

`GET /api/logs?level=&q=&limit=` walks **backwards in 64 KB chunks**, filters on
the raw line before paying for a JSON parse, and stops the moment `limit` matches
are in hand — continuing into the rotated file only if the current one runs
short. A size cap is pointless if reading it needs the whole file in the heap. A
torn line from a crash mid-append is skipped, so one damaged record cannot make
the rest unreadable.

Both routes are authed. That is not boilerplate: **log content is as sensitive as
the events it records** — it names the addresses that tried to sign in and the
files that were deleted, so an unauthenticated read would be a reconnaissance
endpoint for the exact attacker the log exists to catch.

### The one path a client can write to disk

Brief 47's boundary now reports crashes here, which makes the browser a writer.
It is handled as such: a DTO with an app id and a 300-character message and
**nothing else** — no free-form metadata, because a client-controlled object in a
log file is log injection with no upside — a per-process budget so a render loop
cannot fill the volume, the same 5s per-app gate the toast uses, and the entry is
tagged `source: 'client'` so it can never be read as something the server saw for
itself. Verified: a request that also sends `source: 'server'` and
`event: 'auth.login.ok'` has both fields ignored by the whitelisting pipe.

### The dependency the framework caught

`LogsModule` is `@Global`, and that was **not enough** — the e2e suites build
partial module graphs, and a global module that was never imported does not
exist, so every one of them failed to boot. Modules whose providers *require* the
logger now import it explicitly as well. Services that unit tests construct with
`new` take it `@Optional()` instead, so rate limiting and process listing do not
stop working because nothing is listening.

Core's eslint caught the other one: `RecentSignIns` imported `toSignIns` from the
add-on, inverting the dependency the composition root exists to keep one-way. The
log's **shape is a backend contract**, so `LogEntry`/`SignIn`/`toSignIns` moved
into core and the add-on imports them from there; the presentation — event
labels, relative times, row summaries — stays in the add-on.

### The app, and the panel people will actually look at

`System Log`: virtualized rows, level chips, a debounced text filter, a Follow
toggle polling the tail every 3s, and click-to-expand for the raw JSON. Filtering
is **server-side** — pulling the whole log down to filter here would undo the
point of a capped tail. Dotted event names are shown as English ("Sign-in
failed"), with the raw event still in the expanded record.

And **Settings → Security → Recent sign-ins**, first in that section, because
"has anyone been trying to get in?" is the question people open Security to
answer. Failures are shown beside successes; a run of refusals from an address
that is not yours is the single most useful thing the trail can say.

### Verified in a browser, against the real backend

```
PASS 401 on GET /api/logs and POST /api/logs/client-error without a session
PASS three refused sign-ins, then one success, all recorded
PASS THE ATTEMPTED PASSWORD IS NOWHERE IN THE FILE (nor is the real one)
PASS every line in the file is valid JSON
PASS the tail returns newest-first, honours limit, and 400s an absurd one
PASS level and text filters both narrow correctly
PASS a search term is not accumulated in the log
PASS a permanent delete is recorded as a WARNING, with the original path
PASS a client crash is tagged source=client; forged source/event are ignored
PASS an over-long client message is refused by the DTO, not silently truncated
PASS the app renders rows with human event names and a count
PASS the level chips filter, and a row expands to its raw record
PASS Settings shows recent sign-ins, refusals included
page errors: none
```

Tests: backend unit **356 → 385** (29 new). Frontend vitest **1032 → 1044** (12 new,
in a package that did not exist). Backend e2e unchanged at 138. All 107 turbo
tasks green. Zero new dependencies.

Out of scope and untouched, as specified: a syslog daemon, remote log shipping,
telemetry, structured metrics, retention beyond the size cap, and making
`/var/log` real.
