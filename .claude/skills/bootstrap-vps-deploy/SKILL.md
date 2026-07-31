---
name: bootstrap-vps-deploy
description: Scaffold a repeatable, zero-dependency deploy into any repo for a Caddy VPS — a single deploy.ts (Node ≥22.6 type-stripping, no tsx/compile) with pre-deploy | deploy | server | all phases that ships a static client under a Caddy sub-path AND/OR a long-lived Node service under pm2, without disturbing other projects on a shared VPS. Use when the user says "bootstrap the deploy", "set up deploy for this repo", "add the deploy scaffold", "/bootstrap-vps-deploy", or wants a self-contained deploy/deploy.ts + Caddy-snippet + pm2 pattern dropped into a new project.
---

# Bootstrap a VPS Deploy (Caddy sub-path static + pm2 service)

Drop a proven, **zero-dependency** deploy scaffold into any repo. One file — `deploy/deploy.ts` — runs on Node ≥ 22.6's built-in type stripping (no `tsx`, no compile step) and shells out to `ssh` / `scp` / `rsync` you already have. It supports up to two deployable halves; include whichever the project needs:

1. **Static client** — a built bundle (Vite/Astro/plain HTML) served by **Caddy** under a sub-path (`/myapp/`). No remote Node runtime needed.
2. **Long-lived Node service** — a process supervised by **pm2** on a port, reverse-proxied by Caddy (e.g. `/myapp/api` or `/myapp/sim`).

Each project gets its **own Caddy snippet** under `/etc/caddy/sites/<app>.caddy`, so deploying one project never touches the main Caddyfile or other projects on a shared VPS.

> This is the single VPS-deploy skill — it both **scaffolds** the committed `deploy.ts` and **operates** it. It covers two shapes: the lightweight **static-only** case (build locally, upload to a Caddy sub-path, no remote Node — run just the `pre-deploy` + `deploy` phases) and the fuller **static + pm2 service** case (add the `server` phase). Whichever you need, the five hard-won SSH/sudo/sub-path rules below are the rationale. For a genuine one-off where you don't want a committed tool, you can still apply the same probe-first rules ad hoc — but prefer the scaffold so the next deploy is repeatable.

## When to use / not

- **Use:** a new repo (or one without a deploy story) targeting a Linux VPS behind Caddy, especially when there's both a static client and a Node service, or when you want a re-runnable in-repo tool rather than a one-off `scp`.
- **Don't use:** a platform with its own deploy (Vercel/Netlify/Cloudflare Pages/GitHub Pages — use its CLI), containers/Kubernetes, or a server-rendered app where the "static client" half doesn't apply (keep just the `server` leg).

## The five hard-won rules the scaffold encodes (do not relearn)

1. **Never rely on nvm / the login `PATH` over SSH.** `ssh host 'cmd'` is non-interactive and won't source `~/.bashrc`. Prefer build-local / upload-static; for the service leg, require system `node` + `pm2` and *verify* them (the scaffold bails with install instructions, never assumes).
2. **Never let local vars expand in a remote path.** `ssh host "mkdir $HOME/x"` expands `$HOME` **locally**. Single-quote remote-evaluated parts; the scaffold's `shq()` quotes every interpolated path.
3. **Never inline `sudo` over non-interactive SSH** — it hangs on the password prompt. The scaffold honors `SUDO_NOPASSWD`: when false (default) it **prints the exact command** and waits for confirmation.
4. **Thread the sub-path through the build.** A site at `/myapp/` must build with the framework `base` set to it; every root-absolute asset/link/fetch must be base-aware or it 404s. The scaffold passes `BASE_PATH` into the build env and `verifyBuild` asserts the emitted HTML references `<base>assets/` before uploading.
5. **rsync trailing-slash convention.** `rsync -a dist/ host:/path/` (source trailing slash) copies *contents*; `--delete` keeps an exact mirror and drops stale hashed assets. Be consistent.

## Procedure

### Phase 0 — Detect the project shape

Inspect the repo and decide which legs apply:
- **Static client?** Is there a build that emits a `dist/` (check `package.json` `build`, `vite.config`, `astro.config`)? Where does it emit (root `dist/` vs `packages/<x>/dist/` in a monorepo)? What's the framework's base-config env hook?
- **Node service?** Is there a long-lived server (an HTTP/WS entry, an `npm run server`/`start`)? Is it a workspace package needing `npm ci` on the box?
- **Sub-path or root?** Decide `BASE_PATH` (default `/myapp/`, leading + trailing slash). Use the repo name.

Report the shape and the chosen `BASE_PATH`/ports to the user before writing files.

### Phase 1 — Probe the remote (before generating the script)

```bash
ssh <user>@<host> 'bash -s' <<'PROBE'
echo "== whoami =="; whoami; echo "== HOME =="; echo "$HOME"
echo "== PATH (non-interactive) =="; echo "$PATH"
echo "== caddy =="; command -v caddy || echo "NO caddy"; ls -1 /etc/caddy/Caddyfile 2>/dev/null || echo "NO main Caddyfile"
echo "== node/pm2 (only needed for the service leg) =="; command -v node || echo "no node"; command -v pm2 || echo "no pm2"
echo "== sudo =="; sudo -n true 2>&1 && echo "passwordless-sudo: yes" || echo "passwordless-sudo: NO"
echo "== rsync =="; command -v rsync || echo "NO rsync"
echo "== web roots =="; ls -ld /var/www /srv 2>/dev/null || true
PROBE
```

Summarize: Caddy location, web-root choice, node/pm2 presence (for the service leg), sudo policy, the literal remote `$HOME`. **Ambiguous → ask, don't assume.**

### Phase 2 — Scaffold the files

Create under `deploy/`:

- **`deploy/deploy.ts`** — the tool. Use the canonical reference at `references/deploy.ts` in this skill as the starting point; adapt the project-specific bits: `DIST_DIR` (where the build emits), the `verifyBuild` artifact list (entry HTML + any runtime-fetched assets like wasm/atlas/json the framework can't rewrite), the build command + base env-var name, and whether to include the `server` phase at all. Keep the phases `pre-deploy | deploy | server | all` and the flags `--no-build` / `--skip-tests` / `--dry-run`.
- **`deploy/Caddyfile`** — a **per-project snippet** (not a full Caddyfile). For static-only:
  ```caddyfile
  redir /myapp /myapp/ permanent
  handle_path /myapp/* {
      root * /var/www/myapp
      encode gzip zstd
      file_server
      # Add `try_files {path} {path}/ /index.html` ONLY if the client has a router
      # (SPA deep-links). Omit it for single-screen apps so bogus paths honestly 404.
  }
  ```
  Add a service route **before** the static block (Caddy matches handles in order, so the proxy must win):
  ```caddyfile
  handle /myapp/api {
      uri strip_prefix /myapp/api
      reverse_proxy localhost:8787
  }
  ```
- **`deploy/.env.example`** — tracked template (see keys below). The real `deploy/.env` is **git-ignored**; add it to `.gitignore`.
- **`deploy/README.md`** — short doc mirroring the phases + one-time setup.
- **`package.json` scripts:**
  ```json
  "deploy:pre": "node deploy/deploy.ts pre-deploy",
  "deploy": "node deploy/deploy.ts deploy",
  "deploy:server": "node deploy/deploy.ts server",
  "deploy:all": "node deploy/deploy.ts all"
  ```

`.env.example` keys (drop the service ones if there's no service leg):

```
SSH_HOST=<ssh-alias>            # or SSH_USER + SSH_HOSTNAME (+ SSH_PORT / SSH_KEY)
BASE_PATH=/myapp/               # leading + trailing slash
REMOTE_DIR=/var/www/myapp       # rsync target for dist/, owned by the SSH user
PUBLIC_URL=https://host         # for the printed "Live at …" line
REMOTE_CADDYFILE=/etc/caddy/Caddyfile          # main file, validated never overwritten
REMOTE_CADDY_SNIPPET=/etc/caddy/sites/myapp.caddy
SUDO_NOPASSWD=false
# --- service leg only ---
SERVER_DIR=/srv/myapp
PM2_NAME=myapp
SERVER_PORT=8787
```

### Phase 3 — One-time server wiring (print for the user)

Make the **main** Caddyfile import the snippets dir from inside the relevant site block, then create the dir — this is why per-project deploys never collide:

```caddyfile
:80 {                      # or:  your-domain.example.com {
    import sites/*.caddy
}
```
```bash
ssh <host> 'sudo mkdir -p /etc/caddy/sites'
```

### Phase 4 — Dry run → provision → deploy → smoke test

1. `node deploy/deploy.ts pre-deploy --dry-run` — preview, get a go-ahead. Apply any printed sudo commands manually if `SUDO_NOPASSWD=false`.
2. `npm run deploy:pre` (first time / after editing the snippet), then `npm run deploy` (everyday), `npm run deploy:server` (service changes), or `npm run deploy:all`.
3. **Smoke test the live site** (where sub-path bugs surface):
   ```bash
   curl -sS -o /dev/null -w '%{http_code}\n' <PUBLIC_URL>/myapp/
   curl -sS <PUBLIC_URL>/myapp/ | grep -oE '(href|src)="[^"]+"' | sort -u   # paths must start with /myapp/
   ```
   If the `playwright` plugin is available, navigate the live sub-path, assert a clean console + no failed asset requests, confirm any proxied WS/API route connects, and screenshot.

## What each phase does (the scaffold's contract)

| Phase        | Actions |
| ------------ | ------- |
| `pre-deploy` | Check SSH → verify Caddy installed → ensure `REMOTE_DIR` exists (owned by SSH user, so deploys need no sudo) → scp the snippet → install it → `caddy validate` the main Caddyfile → `systemctl reload caddy`. Run on first deploy or after editing `deploy/Caddyfile`. |
| `deploy`     | Build the client **locally** with `BASE_PATH` baked in → `verifyBuild` asserts emitted HTML references `<base>assets/` and required runtime artifacts exist → refuse if `REMOTE_DIR` absent (run pre-deploy) → `rsync -avz --delete dist/ → REMOTE_DIR/` (exact mirror). |
| `server`     | Check SSH + `node` + `pm2` → ensure `SERVER_DIR` → `rsync -avzR --delete` the source the box needs to `npm ci` (in a monorepo: root manifests + `packages/` + `tools/`, excluding `node_modules` + `*.map`, keeping any committed runtime artifacts like wasm) → `npm ci` on the box → `pm2 reload PM2_NAME --update-env` if it exists else `pm2 start npm --name PM2_NAME -- run server` with `PORT=SERVER_PORT` → `pm2 save`. Omit this phase entirely if there's no service. |
| `all`        | `pre-deploy` → `deploy` → `server`. |

## Failure modes

- **Assets 404 under the sub-path** → `BASE_PATH` not threaded; `verifyBuild` should catch it. A `--no-build` upload can ship a stale bundle — rebuild without it.
- **"Remote dir … does not exist"** → never provisioned; run `pre-deploy`.
- **Deploy hangs** → inline sudo with `SUDO_NOPASSWD` mis-set (Rule 3).
- **Proxied route won't connect** → pm2 process down (`ssh host 'pm2 status'` / `pm2 logs`), wrong port vs the Caddy `reverse_proxy`, or the proxy `handle` sits *after* the static `handle_path` in the snippet.
- **`npm ci` fails on the box** → partial source tree (monorepo lockfile validates against the full workspace set — send all workspace dirs).
- **Other VPS projects affected** → impossible if the tool only writes the per-project snippet; if it happened, the main Caddyfile was hand-edited — revert.

## See Also

- `playwright` plugin — drives the Phase 4 live-site verification.
- `references/deploy.ts` (in this skill) — the canonical zero-dependency tool to copy and adapt.
