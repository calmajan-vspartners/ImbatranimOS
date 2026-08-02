---
title: Scaffold the ISO build system
created: 2026-07-16
status: promoted
---

> Promoted 2026-07-16 → [brief 01](../../briefs/superseded/01-build-scaffold.md)
> (since superseded by the web-OS pivot).

# Scaffold the ISO build system

Create the build skeleton that produces the first bootable ImbatranimOS ISO:
a pinned Docker build image, `build.c` (nob.h driver) orchestrating
debootstrap → chroot `.sh` steps → mksquashfs → xorriso, and package lists
(minimal Ubuntu 26.04 base + LXQt 2.3 + Flatpak, snapd excluded).

## Context

First milestone toward the friend-install bar — an unbranded ISO that boots
to LXQt counts. All tech choices are locked in
[decisions](../../wiki/decisions.md); the pipeline shape is in
[architecture](../../wiki/architecture.md). First task inside this work: smoke-
test debootstrap + chroot + mksquashfs inside privileged Docker on WSL2
early (see [open-questions](../../wiki/open-questions.md)), with the Hyper-V
VM fallback if it misbehaves. Vendor a pinned nob.h into the repo.

## Acceptance

`./build` (compiled from `build.c`) run in the Docker build container
produces an ISO that boots to an LXQt desktop in VirtualBox/Hyper-V on the
Windows side, with network and audio working.
