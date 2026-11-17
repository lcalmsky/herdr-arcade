#!/bin/sh
# check-vendor.sh — compare this repo's vendored copies with the vendor/herdr-shared submodule.
# Skips when the submodule is not initialized, since a plain clone has nothing to compare against.
set -eu

REPO=$(cd "$(dirname "$0")/.." && pwd)
SHARED=${HERDR_SHARED:-$REPO/vendor/herdr-shared}

if [ ! -f "$SHARED/tools/check-vendor.sh" ]; then
  echo "check-vendor.sh: no herdr-shared at $SHARED; run git submodule update --init, skipping the drift check" >&2
  exit 0
fi

exec sh "$SHARED/tools/check-vendor.sh" "$REPO"
