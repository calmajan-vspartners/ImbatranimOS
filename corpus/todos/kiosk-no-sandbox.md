---
title: Chromium kiosk runs with --no-sandbox
created: 2026-07-17
status: captured
tags: [security, iso]
---

# Kiosk Chromium launches with --no-sandbox

Found in the 2026-07-17 review pass (SEC-10). The ISO's kiosk launcher
starts Chromium with `--no-sandbox`
(`iso/scripts/rootfs/usr/local/bin/imbatranim-kiosk`, flagged in a nearby
comment). That removes the renderer sandbox — a key containment layer, so
a renderer compromise is no longer boxed in.

Deferred because the flag is documented and justified in the current
appliance model: a single-purpose kiosk running as an unprivileged user,
serving only localhost content. The Chromium sandbox typically needs
privileged user-namespace support that the minimal Alpine rootfs does not
enable by default, which is why `--no-sandbox` is there.

Suggested approach: enable unprivileged user namespaces in the Alpine ISO
build and drop `--no-sandbox` if that proves feasible; otherwise keep the
flag with its documented rationale recorded alongside it.

Rated informational — the appliance is unprivileged and localhost-only,
which is why it is not urgent. Relates to the ISO build work; see
[scaffold-iso-build.md](promoted/scaffold-iso-build.md).
