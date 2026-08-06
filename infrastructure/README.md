# ImbatranimOS — infrastructure & deployment

One container is the computer: Alpine + Node, NestJS serves the built React
desktop **and** the API on a single port (`8080` in prod). This document
covers running it and the **HTTPS / auth exposure** story (Brief 10).

## Run it

```bash
# Prod (the friend-run experience): desktop + API on :8080
docker compose -f infrastructure/docker-compose.yml up imbatranimos

# Dev (HMR): Nest watch + Vite, two ports (3001 API, 5173 desktop)
npm run dev     # = docker compose --profile dev watch
```

First visit forces a password (no default password ever exists). After that
it is a lock screen. TOTP is opt-in from **Settings → Security**.

## Developing (contained — brief 51)

`npm run dev` runs **`docker compose … --profile dev watch`**: install, build,
watch and serve all happen in the container, and compose `watch` syncs your
edits from `apps/` and `packages/` into the container's own filesystem
(node_modules excluded — the container owns its deps). Dependency changes
(`package-lock.json`, root `package.json`, `turbo.json`, the Dockerfile)
trigger an image rebuild instead of a sync. There are no bind mounts and no
per-add-on volume list to keep in sync — adding an add-on needs no
infrastructure edit.

The host needs **Docker plus Node/npm for editor IntelliSense only**:

```bash
npm run install:tooling   # npm install --ignore-scripts — no python3/make/g++
```

`--ignore-scripts` skips the native compilation of `better-sqlite3`/`node-pty`,
so the host never needs a C toolchain; all JS and `.d.ts` still install, which
is what the editor, eslint and tsc read. Caveat: host-run paths that _execute_
those modules (`npm run dev:local`, `backend`'s tests) need the real compile
— `install:tooling` is editor-only. `npm run dev:local` (`turbo dev` on the
host) remains as the escape hatch for a host with the full toolchain.

## HTTPS decision: reverse-proxy TLS (not built-in)

**Decision: terminate TLS in a reverse proxy (Caddy recommended), not in the
app.** Rationale:

- Keeps the single-container story simple — no cert storage, ACME client,
  renewal cron, or privileged :443 bind inside a container that runs as the
  unprivileged `imbatranim` user (no sudo, invariant of the project).
- Caddy does automatic Let's Encrypt certs + renewal in ~4 lines and is the
  natural front door for an internet-exposed box.
- The app stays plain-HTTP internally, so **LAN / localhost use needs no TLS
  at all** — you just open `http://<host>:8080`.

Built-in TLS was considered and rejected: it would drag a cert lifecycle and
either a root-capable bind or extra capabilities into the runtime image, for
no benefit over a 4-line proxy.

### Caddy recipe

See [`Caddyfile.example`](./Caddyfile.example). Minimal form:

```caddyfile
os.example.com {
    reverse_proxy imbatranimos:8080
}
```

Caddy provisions and renews the certificate automatically. Point it at the
container (same Docker network) or at `localhost:8080`.

### Env switches when fronted by HTTPS

The app defaults to **plain-HTTP-safe** settings so LAN use works with zero
config. When a TLS proxy fronts it, set two env vars on the `imbatranimos`
service (see the commented block in `docker-compose.yml`):

| Env var         | Default | Set behind an HTTPS proxy | Effect |
|-----------------|---------|---------------------------|--------|
| `COOKIE_SECURE` | `false` | `true`                    | Marks the session cookie `Secure` (browsers require this over HTTPS; setting it on plain HTTP would silently drop the cookie). |
| `TRUST_PROXY`   | `false` | `true`                    | Trusts `X-Forwarded-*` so `req.ip` (rate-limit key) and protocol reflect the real client, not the proxy. |

`SESSION_TTL_HOURS` (default `168` = 7 days) tunes session lifetime.

> Do **not** set `COOKIE_SECURE=true` without HTTPS in front — the browser
> will refuse to store the cookie and login will appear to "not stick".

## Auth model (what ships)

- **Single user**, credential stored in SQLite (`auth_user`), password hashed
  with **argon2id**. No default password — first run creates it.
- **Sessions**: opaque random token in an `httpOnly`, `SameSite=Lax` cookie
  (`imb_session`); only its SHA-256 is stored server-side.
- **CSRF stance**: `SameSite=Lax` cookie **plus** an Origin check on all
  state-changing requests (POST/PUT/PATCH/DELETE). A present `Origin` must
  match the request host or the configured `FRONTEND_URL`; absent Origin
  (same-origin GET, non-browser clients) is allowed. No CSRF token is used —
  Lax + Origin is the chosen, sufficient stance for a single-origin app.
- **Rate limiting**: in-memory, per-IP. First 5 failures are free, then
  exponential backoff (1 min doubling, capped at 15 min). Resets on a
  successful login and on container restart (an attacker cannot restart it).
- **TOTP** (optional): enroll via QR in Settings; once enabled it is required
  at login.
- **Every** API route requires a valid session except `POST /api/auth/setup`,
  `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/status`, the
  `/health` check, and the static desktop assets.

## Native modules note

`argon2` (like `better-sqlite3` and `node-pty`) is a native addon. It is
compiled in the `deps` / `proddeps` stages, which already carry
`python3 make g++`; the generic `*.o` / `obj.target` strip in `proddeps` also
cleans argon2's build intermediates. No Dockerfile build-dep change was
required — the final prod image ships the compiled `.node` binaries and no
compiler.
