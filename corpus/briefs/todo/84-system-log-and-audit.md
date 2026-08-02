# Brief 84 — A system log and a security audit trail

Status: **todo (ungrilled)** · From the 2026-07-31 real-OS parity research.
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
