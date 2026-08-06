#!/bin/bash
# In-container entry point (run as the `build` user). Orchestrates the full
# ISO build UNPRIVILEGED via fakeroot:
#   1. build the signed imbatranim-os payload apk into a local repo
#   2. pin + fetch aports, drop in our profile + apkovl generator
#   3. run the official mkimage.sh against main + community + our local repo
#
# Mounts expected:
#   /repo   a pristine HEAD snapshot of the repo (the app is built from source)
#   /work   iso/scripts (read-only): rootfs/, apkbuild/, *.sh
#   /out    host output dir for the finished ISO
set -euo pipefail

: "${ISO_VERSION:=1.0.0}"
# aports pin. ISO_APORTS_REF is a branch (fallback, moves over time);
# ISO_APORTS_SHA, when set, pins an exact commit for byte-reproducible builds.
# Either way the resolved commit + resolved apk versions are written to the
# /out manifest so a given ISO can be reproduced.
: "${ISO_APORTS_REF:=3.22-stable}"
: "${ISO_APORTS_SHA:=}"
: "${ALPINE_MIRROR:=https://dl-cdn.alpinelinux.org/alpine}"
: "${ALPINE_BRANCH:=v3.22}"

export SCRIPTS=/work
export SRC=/repo
export BUILD="$HOME/b"
LOCALREPO="$BUILD/localrepo"
APORTS="$HOME/aports"
mkdir -p "$BUILD"

echo "############ 1/3  Build payload apk ############"
bash "$SCRIPTS/build-payload.sh"

echo "############ 2/3  Prepare aports (ref=$ISO_APORTS_REF sha=${ISO_APORTS_SHA:-branch-head}) ############"
if [ ! -d "$APORTS/.git" ]; then
	git clone --depth 1 --branch "$ISO_APORTS_REF" \
		https://gitlab.alpinelinux.org/alpine/aports.git "$APORTS"
fi
if [ -n "$ISO_APORTS_SHA" ]; then
	# Deepen just enough to materialise the pinned commit onto the shallow
	# branch clone, then detach onto it — reproducible regardless of where the
	# branch head has since moved.
	git -C "$APORTS" fetch --depth 1 origin "$ISO_APORTS_SHA"
	git -C "$APORTS" checkout --quiet --detach "$ISO_APORTS_SHA"
fi
APORTS_SHA="$(git -C "$APORTS" rev-parse HEAD)"
echo "aports commit: $APORTS_SHA"
cp "$SCRIPTS/mkimg.imbatranim.sh" "$SCRIPTS/genapkovl-imbatranim.sh" "$APORTS/scripts/"
# mkimage execs the apkovl generator via fakeroot; the read-only mount may not
# carry the exec bit, so set it on the copies.
chmod +x "$APORTS/scripts/genapkovl-imbatranim.sh"

echo "############ 3/3  Run mkimage (unprivileged, fakeroot) ############"
mkdir -p /out
cd "$APORTS/scripts"
sh mkimage.sh \
	--tag "$ISO_VERSION" \
	--outdir /out \
	--arch x86_64 \
	--repository "$ALPINE_MIRROR/$ALPINE_BRANCH/main" \
	--repository "$ALPINE_MIRROR/$ALPINE_BRANCH/community" \
	--repository "$LOCALREPO" \
	--profile imbatranim \
	--checksum

echo "############ Recording reproducibility manifest to /out ############"
# Pins that need no network — always recorded so any ISO can be traced back to
# its exact aports commit + repo coordinates.
MANIFEST="/out/imbatranimos-$ISO_VERSION.manifest.txt"
{
	echo "# ImbatranimOS ISO reproducibility manifest"
	echo "iso_version=$ISO_VERSION"
	echo "built_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
	echo "alpine_branch=$ALPINE_BRANCH"
	echo "alpine_mirror=$ALPINE_MIRROR"
	echo "aports_ref=$ISO_APORTS_REF"
	echo "aports_sha_requested=${ISO_APORTS_SHA:-(none; followed branch head)}"
	echo "aports_sha_resolved=$APORTS_SHA"
	echo ""
	echo "# Resolved apk versions for the ISO world (alpine-base + imbatranim-os):"
} > "$MANIFEST"
# Best-effort exact package versions: resolve the world against the same repos
# mkimage used (--simulate mutates nothing). Never fatal — a build that
# produced an ISO must not fail over its manifest addendum.
VERROOT="$(mktemp -d)"
if sudo apk --root "$VERROOT" --arch x86_64 --initdb --allow-untrusted \
		--repository "$ALPINE_MIRROR/$ALPINE_BRANCH/main" \
		--repository "$ALPINE_MIRROR/$ALPINE_BRANCH/community" \
		--repository "$LOCALREPO" \
		add --simulate alpine-base imbatranim-os >"$VERROOT/sim.log" 2>&1; then
	sed -n 's/.*Installing \([^ ]*\) (\([^)]*\)).*/\1=\2/p' "$VERROOT/sim.log" \
		| sort >> "$MANIFEST"
else
	echo "  (apk simulate failed; see build log)" >> "$MANIFEST"
fi
echo "manifest: $MANIFEST"

echo "############ Done ############"
ls -la /out/
