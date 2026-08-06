# ImbatranimOS

A real little computer whose screen is a browser tab.

`docker run` one container and you get a real Alpine Linux userland — with
its own filesystem, its own shell, its own process table — and a React web
desktop as its display. Not a simulation, not a mockup of a terminal: the
Terminal app is a real shell running as an unprivileged user inside the
container, the Files app browses the container's actual home directory, and
the System Monitor shows the container's actual CPU, RAM, disk, and
processes. The browser is just the screen; the computer is the container.

It's also a small joke about aging (*„îmbătrânim"* — Romanian for "we're
getting old") that happens to be a fully working desktop environment.

## Quick start

You need Docker and Docker Compose. Everything else is built from source —
there is no image registry to trust, just this repo.

```bash
git clone https://github.com/gandolh/ImbatranimOS.git
cd ImbatranimOS
docker compose -f infrastructure/docker-compose.yml up imbatranimos
```

That builds the image (Alpine + Node, the desktop and the API baked into one
slim container) and starts it, publishing the desktop on `:8080` with your
files kept in a named Docker volume. Equivalently, without Compose:

```bash
docker run -p 8080:8080 -v imbatranim-home:/home/imbatranim imbatranimos
```

Open **http://localhost:8080**.

## First login

The first thing you see is a setup wizard, not a login screen — there is no
default password, ever. Pick a password (10 characters minimum) and you're
in. Every visit after that is a lock screen.

Two-factor auth (TOTP) is optional, off by default, and lives under
**Settings → Security** — enroll by scanning the QR code with any
authenticator app, and it's required at every login from then on.

## The apps

- **Terminal** — a real shell (via `node-pty`) on the container, over an
  authenticated WebSocket. Not xterm.js pointed at nothing; an actual PTY.
- **Files** — browses and edits the real `imbatranim` home directory.
- **System Monitor** — live CPU, RAM, disk, and process list, for real.
- **Sticky Notes, Todo, Bookmarks, Notepad** — the small stuff that makes a
  desktop feel like yours.
- **Settings** — theme, accent color, and the TOTP enrollment above.

All of it runs as the unprivileged `imbatranim` user — no sudo, by design.

## Deploying on a VPS with HTTPS

The container itself only ever speaks plain HTTP; TLS is meant to be
terminated by a reverse proxy in front of it (Caddy gets you automatic
Let's Encrypt certs in about four lines). The full recipe — the Caddyfile,
the env vars to flip (`COOKIE_SECURE`, `TRUST_PROXY`), and why built-in TLS
was rejected — lives in [infrastructure/README.md](infrastructure/README.md).
Don't expose the plain-HTTP port directly to the internet; put the proxy in
front of it first.

## Bare-metal kiosk ISO (experimental, post-v1)

Docker is the way to run ImbatranimOS — everything above is the supported
path. If you instead want it as an **appliance that boots straight into the
OS on real hardware or a VM**, there's a separate bootable Alpine-based ISO
under [`iso/`](iso/README.md). It boots with no desktop and no console —
just one fullscreen browser showing the same ImbatranimOS login, backed by
the same server running locally. Build it with `cd iso && cc -o build
build.c && ./build iso` (needs Docker). It's an occasional VM/bare-metal
extra; it changes nothing about the container workflow above and adds no new
prerequisites to it. See [`iso/README.md`](iso/README.md) for the build,
verification, and design decisions.

## Data & backup

Everything that makes the container "yours" — your password hash, your
notes, your files — lives under `/home/imbatranim` inside the
`imbatranim-home` named Docker volume, not inside the container's writable
layer. Delete and recreate the container as often as you like; the volume
is what persists.

**Back it up from inside the OS: Settings → Backup.** "Download backup" streams
the whole volume out as `imbatranim-home-YYYY-MM-DD.tar.gz` — the database
included as a consistent `VACUUM INTO` snapshot rather than a hot copy, the
Trash left behind. "Choose a backup file…" reads an archive, shows its date and
exactly which folders it would replace, and applies it only after you type
`RESTORE`; you are signed out afterwards, because the backup brings its own
password with it. This is the path to use — it is the only one available on the
kiosk ISO or on a hosted instance, where there is no host shell to run docker
from.

If you do have host access, the equivalent tarball is:

```bash
docker run --rm -v imbatranim-home:/home/imbatranim -v "$(pwd)":/backup \
  alpine tar czf /backup/imbatranim-home-backup.tar.gz -C / home/imbatranim
```

Restore it into a fresh volume the same way, in reverse (`tar xzf` instead of
`czf`, extracting into the mounted volume). Note that this copies `db.sqlite`
while the container is running, which the in-OS backup deliberately does not —
stop the container first if you take a backup this way.

## FAQ

**Is it safe to expose to the internet?**
It's designed for it: a single user, argon2id-hashed password, sessions in
an `httpOnly`/`SameSite=Lax` cookie, per-IP rate limiting with exponential
backoff on login, optional TOTP, and an Origin check on every state-changing
request. Put it behind the documented HTTPS reverse proxy (see above) — the
app itself never terminates TLS.

**What's the user / no-sudo story?**
Everything inside the container — the shell you get in Terminal, the
process that serves the desktop — runs as `imbatranim`, an unprivileged
user created in the image. There's no sudo available by default; the
container is not meant to be run as root.

**How do I reset my password if I forget it?**
There's currently no in-app "forgot password" flow — first-run setup is
one-time and intentionally refuses to run again while an account exists (no
silent password reset). If you're locked out, the honest path is: stop the
container, delete the database file inside the `imbatranim-home` volume
(or the whole volume, if you don't need what's in your home directory
either), and start it again — the setup wizard will run once more. Back the
volume up first if you want to keep your files (see Data & backup above).

## Screenshots

![Desktop](docs/screenshots/desktop.png)
![Terminal](docs/screenshots/terminal.png)
![Files](docs/screenshots/files.png)
![System Monitor](docs/screenshots/system-monitor.png)

*(Drop your own PNGs into `docs/screenshots/` with these filenames and
they'll show up here.)*

## Developing

The repo is an npm workspace with [Turborepo](https://turborepo.dev) as the
task runner — one install, one lockfile, one entry point for every task:

```
apps/
  backend/      NestJS API + PTY/FS/system endpoints (its own modules tree)
  core/         the desktop: shell, window manager, auth, settings (@imbatranim/core)
  add-ons/      one package per desktop app (@imbatranim/<name>)
```

```bash
npm install        # once, at the repo root — installs everything
npm run dev        # Nest watch (:3001) + Vite HMR (:5173), in parallel
npm run build      # builds backend + desktop (cached — a second run is instant)
npm run lint       # lints every package
npm run typecheck  # typechecks every package
npm run test       # backend test suite
npm run format:check
```

The same works containerized: the compose dev profile
(`docker compose -f infrastructure/docker-compose.yml --profile dev up`)
runs `turbo dev` inside the image with your `apps/` bind-mounted for HMR.

### Adding a desktop app (add-on)

Apps that open in a window are workspace packages under `apps/add-ons/`,
kept apart from the OS so they can be added/removed without touching core:

1. Create `apps/add-ons/<name>/` with a `package.json` (name it
   `@imbatranim/<name>`, copy an existing add-on's scripts/devDeps), a
   `tsconfig.json` extending `../tsconfig.base.json`, and an
   `eslint.config.js` (copy one — it carries the import-boundary rules).
2. Put your app in `src/`, importing anything it needs from
   `@imbatranim/core` only (UI kit, `api`, stores, `openApp` — the public
   surface in core's `src/index.ts`).
3. Export a `manifest: AddonManifest` from `src/index.ts` — id, name, icon,
   component, window sizes, plus optional `commandSources` for the command
   palette.
4. Register it in the ONE place core knows about add-ons:
   `apps/core/src/manifest.ts` (one import + one array entry), and
   `npm install` to link the workspace.

Nothing else in core changes; the boundary (add-ons → core only, core
imports add-ons only in `manifest.ts`) is enforced by eslint.

## Project knowledge

Architecture, locked decisions, and work briefs live in
[corpus/](corpus/index.md), including the pivot history from this repo's
earlier ISO-based era.

## License

ImbatranimOS is licensed under the **GNU Affero General Public License v3.0
only** (AGPL-3.0-only) — see [LICENSE](LICENSE). The Docs editor is built on
[SuperDoc](https://github.com/Harbour-Enterprises/SuperDoc), which is AGPL-3.0;
the whole repository adopts the same license so the combined work stays
compliant. In short: the source is public and stays public, and if you run a
modified version as a network service you must offer its source to users.
