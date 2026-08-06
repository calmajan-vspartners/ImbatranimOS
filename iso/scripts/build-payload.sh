#!/bin/bash
# Runs INSIDE the Alpine build container (as the unprivileged `build` user).
#
# Assembles the ImbatranimOS runtime payload and packages it into a signed
# `imbatranim-os` .apk in a local repo that run-mkimage.sh feeds to mkimage.
#
# The payload mirrors the Docker prod image layout (infrastructure/Dockerfile):
#   node_modules (prod-only, native addons compiled HERE for musl+this nodejs)
#   apps/backend/dist   the NestJS build
#   public              the core (React desktop) build
# All native addons (better-sqlite3, node-pty, argon2) are compiled against
# the same Alpine 3.22 nodejs-current (Node 24 series) the ISO ships, so the
# ABI matches at boot and the appliance meets the engines floor (node >=24).
#
# Env:
#   SCRIPTS  read-only mount of iso/scripts (rootfs/, apkbuild/, this file)
#   BUILD    writable scratch dir (NOT inside the repo)
#   SRC      a pristine HEAD snapshot of the repo (mounted read-only at /repo)
# Output: $BUILD/localrepo/x86_64/{*.apk,APKINDEX.tar.gz}  (signed)
set -euo pipefail

: "${SCRIPTS:=/work}"
: "${BUILD:=$HOME/b}"
: "${SRC:=/repo}"

REPO=$BUILD/src          # writable working copy of the snapshot
PROD=$BUILD/proddeps
STAGE=$BUILD/staging
LOCALREPO=$BUILD/localrepo
APP=$STAGE/usr/lib/imbatranim

echo "==> Copying HEAD snapshot into a writable tree"
rm -rf "$REPO"; mkdir -p "$REPO"
cp -a "$SRC"/. "$REPO"/

echo "==> Building the web app from source (npm ci + turbo build)"
( cd "$REPO" && npm ci && VITE_API_URL=/api npx turbo build )
for d in apps/backend/dist apps/core/dist; do
	[ -d "$REPO/$d" ] || { echo "FATAL: build produced no $d"; exit 1; }
done

echo "==> Assembling production node_modules (musl, native addons)"
rm -rf "$PROD"; mkdir -p "$PROD/apps/backend" "$PROD/apps/core"
# Manifests first (mirror the Dockerfile proddeps stage exactly).
cp "$REPO/package.json" "$REPO/package-lock.json" "$PROD/"
cp "$REPO/apps/backend/package.json" "$PROD/apps/backend/"
cp "$REPO/apps/core/package.json" "$PROD/apps/core/"
# Every workspace manifest must be present for `npm ci` to resolve the lockfile.
for pkg in "$REPO"/apps/add-ons/*/package.json; do
	sub="apps/add-ons/$(basename "$(dirname "$pkg")")"
	mkdir -p "$PROD/$sub"
	cp "$pkg" "$PROD/$sub/"
done
( cd "$PROD" && npm ci --omit=dev --workspace=backend )
# Strip native build intermediates now that the .node binaries are compiled.
# No `|| true`: under `set -e` a failed `cd` (e.g. proddeps never assembled)
# must abort the build, not silently skip the whole size-trim chain. rm -rf is
# already a no-op when a target is absent, so nothing here needs suppression.
# typescript is backend's devDep and leaks into the tree (~23MB) despite
# --omit=dev; drop it (mirrors the Dockerfile proddeps strip).
(
	cd "$PROD/node_modules"
	find . -name '*.o' -delete
	find . -type d -name obj.target -prune -exec rm -rf {} +
	rm -rf better-sqlite3/deps better-sqlite3/src node-pty/src node-pty/deps
	rm -rf typescript
)
# Drop foreign-arch prebuilt addons — dead weight on an x86_64 ISO (and they
# trip up binary tooling). Keep only linux-x64 (the musl build lives here too).
find "$PROD/node_modules" -type d -name prebuilds | while read -r pb; do
	for d in "$pb"/*; do
		case "$(basename "$d")" in
			linux-x64|linux-x64-musl) : ;;
			*) rm -rf "$d" ;;
		esac
	done
done

echo "==> Staging payload tree"
rm -rf "$STAGE"; mkdir -p "$APP/apps/backend"
cp -a "$PROD/node_modules" "$APP/node_modules"
mkdir -p "$APP/apps/backend/node_modules"
cp -a "$REPO/apps/backend/dist" "$APP/apps/backend/dist"
cp -a "$REPO/apps/core/dist" "$APP/public"
cp "$REPO/package.json" "$APP/package.json"
cp "$REPO/apps/backend/package.json" "$APP/apps/backend/package.json"

echo "==> Overlaying app service files (init script, greetd, kiosk launcher)"
cp -a "$SCRIPTS/rootfs/." "$STAGE/"
chmod +x "$STAGE/etc/init.d/imbatranim-backend" "$STAGE/usr/local/bin/imbatranim-kiosk"

echo "==> Building signed .apk with abuild"
BUILDDIR=$BUILD/apkbuild
rm -rf "$BUILDDIR"; mkdir -p "$BUILDDIR"
cp "$SCRIPTS/apkbuild/APKBUILD" "$SCRIPTS/apkbuild/imbatranim-os.post-install" "$BUILDDIR/"
export _stagingroot="$STAGE"
(
	cd "$BUILDDIR"
	# source="" -> nothing to fetch/checksum; package() copies $_stagingroot.
	abuild -F -d clean unpack prepare build rootpkg
)

echo "==> Publishing local repo"
rm -rf "$LOCALREPO"; mkdir -p "$LOCALREPO/x86_64"
find "$HOME/packages" -name 'imbatranim-os-*.apk' -exec cp {} "$LOCALREPO/x86_64/" \;
ls "$LOCALREPO/x86_64/"*.apk >/dev/null 2>&1 || { echo "FATAL: no apk produced"; exit 1; }
apk index -o "$LOCALREPO/x86_64/APKINDEX.tar.gz" "$LOCALREPO/x86_64/"*.apk
abuild-sign "$LOCALREPO/x86_64/APKINDEX.tar.gz"

echo "==> Payload apk ready:"
ls -la "$LOCALREPO/x86_64/"
