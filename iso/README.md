# ImbatranimOS kiosk ISO

A bare-metal, **post-v1** variant of ImbatranimOS: a bootable Alpine-based
ISO whose entire visible interface is **one fullscreen browser**. It boots
straight into chromium showing the ImbatranimOS login — no desktop
environment, no window manager chrome, no console, no shell flash. The same
NestJS backend that the Docker product ships runs locally on the booted
machine and serves the same React desktop + API on `localhost:8080`; the
browser is just its screen.

> The Docker container remains the headline product and the primary dev/test
> loop (see the repo root README + `infrastructure/`). This ISO is the
> occasional VM/bare-metal appliance. It changes nothing about the container.

## Build it

Requires **Docker** and a C compiler. From this directory:

```sh
cc -o build build.c      # one-time bootstrap of the nob driver
./build iso              # -> out/imbatranimos-1.0.0-x86_64.iso (+ .sha256/.sha512)
./build clean            # remove out/ and the toolbox image
```

`./build iso`:

1. Exports a **pristine `git archive HEAD` snapshot** to `iso/.cleanrepo` — the
   ISO is always built from committed sources, never from an in-progress
   working tree.
2. Builds the Alpine 3.22 toolbox image (`iso/Dockerfile`).
3. Runs the whole pipeline **unprivileged** inside that container
   (`scripts/run-mkimage.sh`): builds the web app from source (`npm ci` +
   `turbo build`), packages the payload `.apk`, fetches pinned aports, and
   invokes the official `aports/scripts/mkimage.sh` with our custom profile.

Everything runs from RAM at boot (Alpine **diskless** mode) — no installer,
storage untouched.

## Verify it (in a VM)

The build is CI-friendly and self-contained; **boot** verification needs a
VM and is human-gated (no VM hypervisor is available in the build/CI
environment). To check it yourself:

```sh
qemu-system-x86_64 -m 2048 -cdrom out/imbatranimos-1.0.0-x86_64.iso -boot d
# UEFI: add  -bios /usr/share/ovmf/OVMF.fd
```

Expect: quiet boot straight into fullscreen chromium showing the
ImbatranimOS login (no console, no cursor). Set a password (first run), then
use terminal / files / monitor against the local backend. Also smoke-test
VirtualBox or Hyper-V (BIOS + UEFI).

## Layout

```
iso/
  build.c        nob driver: ./build iso | clean
  nob.h          vendored, pinned tsoding/nob.h v3.10.0 (c54fde9)
  Dockerfile     Alpine 3.22 toolbox (mkimage tooling + node build tools)
  scripts/
    run-mkimage.sh            in-container orchestrator (payload -> mkimage)
    build-payload.sh          assemble payload + build the signed .apk
    mkimg.imbatranim.sh       mkimage profile (lts kernel, iso, our world)
    genapkovl-imbatranim.sh   the /etc overlay (world + OpenRC wiring)
    apkbuild/
      APKBUILD                imbatranim-os package (payload + deps)
      imbatranim-os.post-install   creates the imbatranim/greetd users
    rootfs/                   files the .apk installs
      etc/init.d/imbatranim-backend   backend OpenRC service (imbatranim user)
      etc/greetd/config.toml          autologin -> kiosk launcher
      usr/local/bin/imbatranim-kiosk  cage + chromium --kiosk launcher
```

## How it boots

Alpine **diskless**: the initramfs applies the apkovl (our `/etc` overlay) to
a tmpfs root, then installs the packages listed in `/etc/apk/world` from the
package cache on the ISO media. Our `world` is just `alpine-base` +
`imbatranim-os`; the `imbatranim-os` package's `depends=` drags in the whole
kiosk stack (nodejs, chromium, cage, seatd, greetd, eudev, dbus, fonts).
OpenRC then starts `dbus`, `seatd`, the backend, and `greetd`. greetd's
`initial_session` autologins the `imbatranim` user straight into the kiosk
launcher — `cage` (a one-app Wayland compositor) running
`chromium --kiosk http://localhost:8080`.

## Design decisions (this brief's open questions, resolved)

### App delivery: a custom signed `.apk` (chosen over tarball-in-overlay)

The payload — built backend, desktop statics, and the production
`node_modules` (with `better-sqlite3` / `node-pty` / `argon2` compiled for
Alpine's musl + nodejs ABI) — ships as an `imbatranim-os` Alpine package,
served to `mkimage` from a local signed repo.

- **Why .apk:** the apkovl stays tiny (only `/etc` config + OpenRC wiring),
  which matters because the apkovl is loaded into RAM early in diskless boot —
  a fat overlay is the anti-pattern. The payload is fetched from the media
  cache like any other package, consistent with how chromium/cage/nodejs
  arrive, and its `depends=` cleanly encode the whole runtime graph so the
  world is two lines.
- **ABI correctness:** the native addons are compiled inside the same Alpine
  3.22 toolbox whose `nodejs` the ISO installs at boot, so the ABI matches.
- **No network at boot:** everything is baked; no `npm` ever runs on the
  device.
- The APKBUILD packages a **pre-staged tree** (assembled by
  `build-payload.sh`) rather than running `npm ci` inside abuild's
  network-restricted sandbox — deterministic and simple. This was feasible,
  so the tarball-in-overlay fallback was not needed.

### Autologin: greetd (chosen over agetty + profile)

`greetd`'s `initial_session` execs the kiosk launcher as `imbatranim` with **no
greeter UI and no getty on any VT**. That satisfies the "no console, no
cursor flash to a shell" acceptance more cleanly than the agetty-autologin +
`~/.profile` `startx`-style hack, and it is the combination the researched
cage-kiosk recipe uses (with seatd for seat management). The inittab we ship
has **no getty lines at all** — greetd owns vt1 and is the only thing on the
screen. Seat access uses **seatd** directly (imbatranim is in the `seat`
group); we set `XDG_RUNTIME_DIR` ourselves in the launcher rather than pull
in elogind, keeping it lighter. The X11 route
(`xf86-video-vesa` + `chromium --kiosk`) remains the documented plan B if
cage/wlroots misbehaves on some target GPU.

### Kernel: `lts` (not `virt`)

`lts` covers real hardware **and** VMs; `virt` is smaller but VM-only. A slim
virt profile variant can come later.

### State: stateless (tmpfs), login/setup every boot

The diskless root is tmpfs, so the SQLite DB and home are recreated on every
boot — the appliance is stateless and you set the password on each boot.
This is invariant-clean (auth every boot, no default password ever persisted)
and the simplest v1. Device-local persistence (an `lbu`-committed apkovl) is
the deliberate later path if wanted.

### Browser knob (future)

The chromium/firefox switch, when the expansion comes, will live as a profile
variable feeding the `imbatranim-os` `depends=` and the launcher command.
chromium is the confirmed lighter default (~263 MiB installed vs firefox's
reported ~1 GB storage / ~1 GB idle RAM).

## Reproducibility / pins

- `nob.h` vendored at **v3.10.0** (commit `c54fde9`).
- Toolbox base **`alpine:3.22`**; runtime packages from the `v3.22` main +
  community repos.
- **Node 24**: both the build toolbox and the shipped appliance use
  `nodejs-current` (the Node 24 series on `v3.22`, from the community repo), not
  Alpine's main `nodejs` (22.x). This matches the Docker image's
  `node:24.14.1-alpine` and the root `package.json` engines floor
  (`node >=24.14.1`); `nodejs-current` `provides` `nodejs`, so `npm` resolves
  against it with no LTS pulled in.
- aports pinned via `ISO_APORTS_SHA` (an exact commit, for byte-reproducible
  builds) with `ISO_APORTS_REF` (default branch `3.22-stable`) as the moving
  fallback. Each build writes `out/imbatranimos-<version>.manifest.txt`
  recording the resolved aports commit, repo coordinates, and the resolved apk
  versions of the ISO world.
- ISO version via `ISO_VERSION` (default `1.0.0`), producing
  `imbatranimos-<version>-x86_64.iso`.

The ISO is a hybrid **BIOS + UEFI** image out of the box (syslinux/isolinux +
grub-efi), per mkimage's x86_64 defaults.
