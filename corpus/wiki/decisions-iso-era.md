---
summary: The ISO-era decisions that still bind the web-OS (build-from-source, no runtime package manager, the locked visual identity and more), plus the compressed record of the ones the 2026-07-16 pivot superseded. Split out of decisions.md, which has a 200-line cap.
updated: 2026-08-03
---

# Decisions inherited from the ISO era

Split out of [decisions.md](decisions.md) on 2026-08-03 when that page passed its
200-line cap. Nothing here changed in the move; the live web-OS decisions stayed
behind.

## Carried over from the ISO era (still binding)

- **Identity: Windows-7-classic layout** (taskbar, start button + compact
  menu, tray, desktop icons) rendered **modern flat, classy black & white
  with parameterized accent colors** (accent picked from mockups during the
  reskin work). Name stays ImbatranimOS.
- **Versioning: semantic.** v1.0 = the friend-run bar met.
- **Finish line: friend-run bar** (adapted from friend-install): a friend
  with Docker runs one documented command, logs in, and uses
  terminal/files/notes unaided.
- **Distribution: build-from-source** (clone + docker build/compose);
  registry publishing is an open question, not a promise.
- **Lightweight as identity** — REVISED 2026-07-16 after brief 09 measured
  the prod image at 364 MB. The old "~150 MB image target / 200 MB tripwire"
  is retired as unrealistic for Node+Nest (floor ~300 MB). New target:
  **image ≤ ~400 MB**, and "lightweight" is measured primarily by
  **cold-start time and idle RAM** (recorded in brief 15), not image bytes.
  NestJS is kept — the fork reuse it enabled (terminal/files/system/all
  apps) is worth far more than image bytes for a run-once container.
- **REST-client backend proxy — SSRF stance** (2026-07-18, brief 43). The REST
  API client sends outbound HTTP through an authed backend proxy (`POST
  /api/http/request`) because the SPA's CSP (`connect-src` same-origin) + CORS
  block direct browser fetches. It sits behind the global `SessionAuthGuard` —
  **only the single logged-in owner can call it; that owner-auth is the primary
  control.** It is the owner's own `curl`, not an open relay, so it **MAY reach
  LAN/localhost/private ranges by design** — we deliberately do NOT hard-block
  private IP ranges (that would gut the tool, and the caller is already trusted).
  The guardrails that bound blast radius (NOT a public-safe SSRF filter):
  (1) scheme allowlist http/https only, re-checked on every redirect hop, never
  downgrading to a non-http(s) scheme; (2) response caps — 10 MB streamed body
  (aborts + `truncated`) and a 30 s timeout; (3) redirect cap 5, manual, scheme
  re-validated per hop; (4) header hygiene — hop-by-hop + `proxy-*` stripped,
  only user-set headers sent, and the user's own Authorization/Cookie dropped on
  a cross-host redirect; (5) no credential reflection — the OS session cookie /
  Authorization are never forwarded (outbound headers built solely from user
  input); CRLF rejected in URL + header values. Enforced in
  `apps/backend/src/modules/http-proxy/http-proxy.service.ts`; 13 unit tests +
  an adversarial security review confirmed it. Backend git/archive modules from
  the same wave (42/44) reuse `FilesService.resolveSafe` for their FS jail and
  run subprocesses with array args / no shell.

## Superseded (ISO era, 2026-07-16 — record only)

Ubuntu 26.04 + LXQt/X11 install-on-hardware distro; hand-rolled
debootstrap→chroot→squashfs→xorriso pipeline driven by build.c on tsoding's
nob.h with .sh chroot steps; privileged-Docker-on-WSL2 build host (smoke
test PASSED — durable finding: debootstrap/chroot/mksquashfs work fine in
privileged Docker on WSL2); Calamares, Secure Boot shim, dual-boot, SDDM,
PipeWire, VLC, Fluent-fork theming, QML welcome app, 2GB-with-zram floor.
Full detail: superseded briefs 01–07 and log.md entries of 2026-07-16.
