# ImbatranimOS corpus — index

Start here. Triage on the summary lines; open at most 2–3 pages.

- [CLAUDE.md](CLAUDE.md) — the rules and conventions for this corpus
- [routing.md](routing.md) — intent/knowledge routing for work-intake
- [log.md](log.md) — chronological record of meaningful changes

## Wiki

- [architecture](wiki/architecture.md) — Web-OS era stack — Alpine + NestJS container, one authed port, React/Vite desktop split into @imbatranim/core + add-on packages (npm workspaces + turbo), PTY/FS/monitor apps, volume-backed home.
- [backlog-2026-07-31](wiki/backlog-2026-07-31.md) — The 2026-07-31 improvement sweep backlog — briefs 52-86, one line each. 52-54 cross-cutting platform fixes, 55-78 one per app (all 24 registry apps), 79-86 real-OS parity. All ungrilled proposals from a research sweep; grill before building. Includes the dependency order and what was already fixed in-session.
- [decisions-iso-era](wiki/decisions-iso-era.md) — The ISO-era decisions that still bind the web-OS (build-from-source, no runtime package manager, the locked visual identity and more), plus the compressed record of the ones the 2026-07-16 pivot superseded. Split out of decisions.md, which has a 200-line cap.
- [decisions](wiki/decisions.md) — Locked choices of the web-OS era (2026-07-16 pivot grilling) plus the 2026-07-17 office-suite/post-v1 set, the 2026-07-18 REST-client SSRF stance, and a compressed record of the superseded ISO-era decisions — do not relitigate without an explicit revisit and a log entry.
- [norpdf](wiki/norpdf.md) — norPDF (the OS's PDF application, ~3900 LOC) and @pdfcore/engine (its isomorphic engine) — what each module owns, the platform-binding model, the save→reload cache contract, what the write path is proven to preserve, and what is deliberately not supported. Written 2026-08-03 for brief 66; before it, this existed only in the code.
- [open-questions](wiki/open-questions.md) — Web-OS era unknowns — app-install story without sudo, HTTPS in-app vs proxy, accent pick, image size reality, registry publishing, fork prune surprises.
- [os-layering](wiki/os-layering.md) — The OS-as-layers design (2026-07-19 grilling) — three layers (kernel/userland ↔ compositor/display ↔ apps), an injected `system` capability handle as the app↔OS protocol seam, the `@imbatranim/ui`-library vs capabilities bisection, and the kill-list of real-Linux daemons we deliberately do NOT build.
- [overview](wiki/overview.md) — What ImbatranimOS is after the 2026-07-16 pivot — a real Alpine container whose desktop is a React web app — plus the project's lineage and audience.
- [real-os-gaps](wiki/real-os-gaps.md) — Where the OS still stops feeling like an OS (2026-07-31 research) — the three places the illusion breaks first, the Tier-2 features worth doing later, and the standing rejection list (root-requiring features, a package manager, a services view, a global mixer, man pages, printing, a clipboard manager, screen recording, an SSH app) with the reason each is out, so they are not re-litigated.
- [status](wiki/status.md) — Dated snapshot — web-OS era; briefs 08–14 + 16–46 DONE. The 2026-07-18 full-auto daily-driver backlog (34–46) is COMPLETE: CORE notification center (34), Wave C's six light apps (35–40), Wave D's four heavy/backend apps (41–44: Monaco code-editor + git-gui + REST client + archive-manager, the backend three authed+jailed, adversarially security-reviewed + hardened), and Wave E's two CORE platform surfaces (45 global search launcher, 46 add-on manager). Desktop = 23 apps; 135 backend tests. Only human-gated items remain before v1.0: SEC-9 CSP + SEC-10 kiosk sandbox (browser/ISO-gated), brief 15's v1-release remainder, and per-brief human walkthroughs.
- [ui-conventions](wiki/ui-conventions.md) — The house UI style as enforceable rules, derived from the code 2026-07-31 (refreshed 2026-08-05 for briefs 74-75: sticky-notes citations, the desktop-layer contract, the Select-label fix, the secondary token aliases) — import rule and core export surface, the real token/accent names, type + density scale, in-window layout (incl. the unclamped-defaultSize trap), the one canonical answer for confirm/prompt/toast/empty/loading/context-menu/hotkey/save-spine, icon sizing, the accessibility floor, the anti-patterns to copy around, and a 14-item pre-flight checklist.

## Work

- Brief states live one-per-line in [wiki/status.md](wiki/status.md);
  specs in [briefs/](briefs/), captures in [todos/](todos/).
