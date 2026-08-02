# syntax=docker/dockerfile:1-labs
# ImbatranimOS — one dual-mode image. Build context is the REPO ROOT
# (npm workspace: one root lockfile covers apps/backend, apps/core and the
# apps/add-ons/* packages).
#
#   prod (default):  slim, Nest serves the built desktop + API on one port
#   dev:             Nest (watch) + Vite (HMR) via `turbo dev`, two ports
#
# Native modules (better-sqlite3, node-pty) are compiled in stages that
# carry build tools; the final prod image copies the built node_modules and
# ships without a compiler.

# ---------------------------------------------------------------------------
# deps — full workspace install (dev + prod), with native build toolchain
# ---------------------------------------------------------------------------
FROM node:24.14.1-alpine AS deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
# Manifests first for layer caching: one root lockfile, one npm ci.
COPY package.json package-lock.json turbo.json ./
COPY apps/backend/package.json ./apps/backend/
COPY apps/core/package.json ./apps/core/
# ALL add-on manifests (--parents preserves each add-on's dir), so `npm ci`
# links every workspace core/src/manifest.ts imports. Globbed so newly-added
# add-ons are picked up automatically — no per-add-on COPY line to keep in sync.
COPY --parents apps/add-ons/*/package.json ./
RUN npm ci

# ---------------------------------------------------------------------------
# builder — compile backend (nest) and the desktop (core vite build, which
# bundles the add-on packages via workspace resolution)
# ---------------------------------------------------------------------------
FROM deps AS builder
COPY apps ./apps
# Sub-path build args. Default to root / same-origin (the standalone container
# reached at its own port). A Caddy sub-path deploy passes
# VITE_BASE=/imbatranim-os/ + VITE_API_URL=/imbatranim-os/api so the desktop's
# assets, REST (axios), and pty WebSocket all resolve under the prefix; Caddy's
# handle_path strips it back to the container's native / and /api. The backend
# ignores VITE_* — it serves whatever static files the build emitted.
ARG VITE_BASE=/
ARG VITE_API_URL=/api
RUN VITE_BASE=$VITE_BASE VITE_API_URL=$VITE_API_URL npx turbo build

# ---------------------------------------------------------------------------
# proddeps — production-only node_modules (native modules compiled here)
# ---------------------------------------------------------------------------
FROM node:24.14.1-alpine AS proddeps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/backend/package.json ./apps/backend/
COPY apps/core/package.json ./apps/core/
# All add-on manifests (see the deps stage) so the workspace tree resolves.
COPY --parents apps/add-ons/*/package.json ./
# Backend runtime deps only — the desktop is prebuilt to static files, so
# none of its packages (react etc.) may reach the prod image.
RUN npm ci --omit=dev --workspace=backend
# Strip native build intermediates now that the .node binaries are compiled:
# object files, gyp obj.target dirs, and the C sources for node-pty +
# better-sqlite3 (~60MB). The runtime only needs build/Release/*.node.
# Hoisting puts everything in /app/node_modules.
RUN cd node_modules \
 && find . -name '*.o' -delete \
 && find . -type d -name obj.target -prune -exec rm -rf {} + \
 && rm -rf better-sqlite3/deps better-sqlite3/src node-pty/src node-pty/deps \
 && mkdir -p /app/apps/backend/node_modules

# ---------------------------------------------------------------------------
# prod — slim runtime: no compiler, runs as the unprivileged imbatranim user
# ---------------------------------------------------------------------------
FROM node:24.14.1-alpine AS prod
LABEL org.opencontainers.image.title="ImbatranimOS" \
      org.opencontainers.image.version="1.0.0"
# git is a RUNTIME dependency, not a build one: the Git app's backend spawns
# `git` (modules/git/git.service.ts). node:alpine does not ship it, and this
# stage previously installed nothing, so the Git app failed on every operation
# in the shipped image while working in development on a glibc host.
RUN apk add --no-cache git
RUN deluser node 2>/dev/null || true; delgroup node 2>/dev/null || true; \
    addgroup -g 1000 imbatranim && adduser -D -u 1000 -G imbatranim imbatranim
WORKDIR /app
# Hoisted runtime deps + any backend-nested overrides (may be empty).
COPY --from=proddeps /app/node_modules ./node_modules
COPY --from=proddeps /app/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=builder /app/apps/backend/dist ./apps/backend/dist
COPY --from=builder /app/apps/core/dist ./public
COPY package.json ./
COPY apps/backend/package.json ./apps/backend/
COPY infrastructure/entrypoint.sh /entrypoint.sh
RUN chmod 0755 /entrypoint.sh \
 && mkdir -p /home/imbatranim \
 && chown -R imbatranim:imbatranim /home/imbatranim /app
USER imbatranim
ENV NODE_ENV=production \
    PORT=8080 \
    STATIC_ROOT=/app/public \
    FRONTEND_URL=http://localhost:8080 \
    DB_PATH=/home/imbatranim/.imbatranim/db.sqlite \
    NOTES_DIR=/home/imbatranim/notes \
    CONFIGS_DIR=/home/imbatranim/.imbatranim/configs \
    IMAGE_VERSION=1.0.0
VOLUME /home/imbatranim
EXPOSE 8080
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "apps/backend/dist/main"]

# ---------------------------------------------------------------------------
# dev — source-mounted development: `turbo dev` = Nest watch + Vite HMR
# (docker compose dev profile bind-mounts apps/ over this; node_modules stay
# from the image via anonymous volumes)
# ---------------------------------------------------------------------------
FROM deps AS dev
RUN deluser node 2>/dev/null || true; delgroup node 2>/dev/null || true; \
    addgroup -g 1000 imbatranim && adduser -D -u 1000 -G imbatranim imbatranim
WORKDIR /app
COPY apps ./apps
COPY infrastructure/entrypoint.sh /entrypoint.sh
RUN chmod 0755 /entrypoint.sh \
 && mkdir -p /home/imbatranim && chown -R imbatranim:imbatranim /home/imbatranim /app
USER imbatranim
ENV PORT=3001 \
    FRONTEND_URL=http://localhost:5173 \
    DB_PATH=/home/imbatranim/.imbatranim/db.sqlite \
    NOTES_DIR=/home/imbatranim/notes \
    CONFIGS_DIR=/home/imbatranim/.imbatranim/configs
EXPOSE 3001 5173
ENTRYPOINT ["/entrypoint.sh"]
CMD ["npx", "turbo", "dev"]
